# Link previews — implementation spec

Status: implemented 2026-07-09 (P3 of docs/feature-backlog.md). Two deviations found during
live verification, both fixed with regression coverage: (1) rebuilt httpx responses had to drop
the stale `content-encoding` header or every gzip-served page failed to parse; (2) the update
endpoint had to clear DRF's prefetch cache or PATCH responses returned stale previews. Plus the
YouTube iframe needs `referrerPolicy="strict-origin-when-cross-origin"` (player error 153).

URLs in a post's text get rendered as rich preview cards in the feed. Metadata is fetched
**server-side** (client-side is impossible: x.com/YouTube block cross-origin reads), stored per
post, and served through the existing post API. Three card kinds:

- `youtube` — video title, channel name, description, thumbnail, click-to-play embed.
- `twitter` — author name/handle + tweet text, quote-card style.
- `generic` — OpenGraph/meta card: site name, title, description, thumbnail.

Design principles pinned here are binding: strict SSRF guarding on every outbound fetch,
thumbnails re-hosted through our origin (the CSP `img-src` allowlist stays closed), graceful
degradation (a failed fetch means "no card", never an error surfaced to users), and cards styled
with the Echo Sphere semantic tokens (docs/design-system.md) so dark mode works by construction.

## API contract

`PostSerializer` gains a read-only `link_previews` array (only successfully fetched previews are
serialized; pending/failed rows are omitted):

```json
{
  "id": 12,
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "kind": "youtube",            // "youtube" | "twitter" | "generic"
  "title": "Video title",
  "description": "First lines of the video description…",
  "site_name": "YouTube",
  "author_name": "Channel Name",       // channel (youtube) / display name (twitter) / "" (generic)
  "author_handle": "rickastleyofficial", // twitter handle or youtube @handle path seg when known, else ""
  "embed_id": "dQw4w9WgXcQ",           // youtube video id, else ""
  "image": "http://localhost:8000/api/link-previews/12/image/"  // absolute URL or null
}
```

## Backend

### 1. Model — `server/apps/blogs/models.py`

```python
class LinkPreview(models.Model):
    KIND_CHOICES = [("youtube", "YouTube"), ("twitter", "Twitter/X"), ("generic", "Generic")]
    STATUS_CHOICES = [("pending", "Pending"), ("ok", "OK"), ("failed", "Failed")]

    created = models.DateTimeField(auto_now_add=True)
    modified = models.DateTimeField(auto_now=True)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="link_previews")
    url = models.URLField(max_length=2000)
    position = models.PositiveSmallIntegerField(default=0)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default="generic")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="pending", db_index=True)
    title = models.CharField(max_length=500, blank=True)
    description = models.TextField(blank=True)
    site_name = models.CharField(max_length=200, blank=True)
    author_name = models.CharField(max_length=200, blank=True)
    author_handle = models.CharField(max_length=100, blank=True)
    embed_id = models.CharField(max_length=100, blank=True)
    image = models.ImageField(upload_to="link_previews/%Y/%m/", blank=True)
    fetched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["position", "id"]
        constraints = [models.UniqueConstraint(fields=["post", "url"], name="unique_post_link_url")]
```

- `delete()` override: delete `self.image` from storage first (mirror `Media.delete()`), then super.
- `Post.delete()`: before the existing media cleanup, loop `self.link_previews.all()` calling each
  `preview.delete()` so image files are cleaned up (FK cascade would skip the override).
- Migration `0022_linkpreview` (makemigrations).

### 2. URL extraction + fetching — new module `server/apps/blogs/link_previews.py`

All pure logic lives here so tests can patch named functions (mirror `transcription.transcribe_audio`).
Module constants: `MAX_LINKS_PER_POST = 3`, `FETCH_TIMEOUT = 8.0` (seconds, total per request),
`MAX_HTML_BYTES = 2_000_000`, `MAX_IMAGE_BYTES = 5_000_000`, `MAX_REDIRECTS = 5`,
`USER_AGENT = "webframework-linkpreview/1.0 (+https://github.com/tam/webframework)"`.

**`extract_urls(text: str) -> list[str]`**
- Regex over `head + "\n" + body` text: match `https?://…` and bare `www.…` tokens
  (normalize `www.` matches by prefixing `https://`). Strip trailing punctuation
  (`.,;:!?"'`) and a trailing `)` when the URL contains no `(`.
- Deduplicate preserving first-seen order; return at most `MAX_LINKS_PER_POST`.

**Kind detection + provider parsing**
- `detect_kind(url) -> tuple[kind, embed_id]`:
  - YouTube hosts (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`,
    `music.youtube.com`) with a video id from `watch?v=`, `/shorts/<id>`, `/live/<id>`,
    `/embed/<id>`, or the `youtu.be/<id>` path → `("youtube", video_id)`. Validate id with
    `^[A-Za-z0-9_-]{6,20}$`.
  - `x.com` / `twitter.com` / `mobile.twitter.com` path matching `/<handle>/status/<digits>` →
    `("twitter", "")` (also capture the handle for `author_handle`).
  - Else `("generic", "")`.

**SSRF-guarded HTTP — `_safe_get(url, *, max_bytes) -> httpx.Response | None`**
This guard is mandatory for **every** outbound request, including the fixed oEmbed hosts.
- Scheme must be http/https; reject userinfo in netloc; reject non-default-port cleverness is not
  required but ports other than 80/443 are rejected.
- Resolve the hostname via `socket.getaddrinfo`; if **any** resolved address is non-global
  (`ipaddress.ip_address(a).is_private / is_loopback / is_link_local / is_multicast /
  is_reserved / is_unspecified`), refuse. Literal IP hostnames get the same check.
- Use `httpx.Client(follow_redirects=False, timeout=FETCH_TIMEOUT, headers={"User-Agent": USER_AGENT, "Accept-Language": "en"})`
  and follow redirects manually up to `MAX_REDIRECTS`, re-running the full host check on every hop.
- Stream the body; abort (return None) past `max_bytes`. Any exception → log at info, return None.

**Fetchers** (each returns a `dict` of preview fields or `None`; patchable by name):
- `fetch_youtube(url, video_id)`:
  1. oEmbed: `https://www.youtube.com/oembed?url=<quoted url>&format=json` → `title`,
     `author_name` (channel), `thumbnail_url`.
  2. Best effort: GET the watch page (`https://www.youtube.com/watch?v=<id>`) and parse
     `og:description` from the HTML for the video description; also `<link rel="canonical">`
     `@handle` if trivially available from `"ownerProfileUrl"` in the page source
     (regex `"ownerProfileUrl":"https?://www\.youtube\.com/@([^"]+)"`); both optional —
     failures leave those fields blank.
  3. `site_name="YouTube"`, `embed_id=video_id`, image from `thumbnail_url` falling back to
     `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.
  - Return None only if oEmbed fails AND the page yields no `og:title`.
- `fetch_twitter(url, handle)`:
  - oEmbed: `https://publish.twitter.com/oembed?url=<quoted url>&omit_script=true&dnt=true&hide_thread=true`
    → `author_name`; tweet text = text content of the `<p>` inside the returned blockquote
    `html` (strip tags, `html.unescape`); `description=tweet_text`, `author_handle=handle`,
    `site_name="X"`, `title=""`. No image (oEmbed doesn't provide one). None on failure.
- `fetch_generic(url)`:
  - GET the page (only parse when content-type contains `text/html`). Parse with a small
    stdlib `html.parser.HTMLParser` subclass collecting `<meta property=… content=…>` /
    `<meta name=…>` and `<title>`: `og:title` (fallback `twitter:title`, then `<title>`),
    `og:description` (fallback `twitter:description`, `meta[name=description]`),
    `og:site_name`, `og:image` (fallback `twitter:image`), resolving relative image URLs
    against the final response URL. Decode using the response charset with fallback utf-8/replace.
  - None when neither title nor description was found.

**`download_preview_image(preview, image_url)`**
- `_safe_get` with `max_bytes=MAX_IMAGE_BYTES`; content-type must start with `image/`.
- Validate + re-encode with Pillow: `Image.open` → `thumbnail((640, 640))` → save as JPEG
  quality 80 (convert to RGB; flatten alpha onto white). Save to `preview.image` as
  `<preview.pk>.jpg` via `ContentFile`. Any failure → leave `image` empty, preview still ok.

**`fetch_preview_for(preview)`** — orchestrator called by the task: dispatch on `preview.kind`,
apply the returned dict (truncate to field max_lengths), download image if the fetcher supplied
an `image_url`, set `status="ok"`/`"failed"`, `fetched_at=timezone.now()`, save.

### 3. Task — `server/apps/blogs/tasks.py`

```python
@task()
def fetch_link_previews(post_id: int) -> None:
    post = Post.objects.filter(pk=post_id).first()
    if post is None:
        return
    for preview in post.link_previews.filter(status="pending"):
        try:
            fetch_preview_for(preview)
        except Exception:
            logger.exception(...)
            preview.status = "failed"; preview.fetched_at = timezone.now()
            preview.save(update_fields=["status", "fetched_at"])
```

### 4. View hooks — `server/apps/blogs/views.py`

New helper `sync_link_previews(post)` (in `link_previews.py`, imported by views):
- `urls = extract_urls(f"{post.head}\n{post.body}")`.
- Delete `post.link_previews.exclude(url__in=urls)` (via per-object `.delete()` for file cleanup).
- Create missing rows with `kind`/`author_handle` from `detect_kind`, `position` = index in `urls`;
  update `position` on survivors. Returns True when any row is `status="pending"`.

Wire-up:
- In `PostViewSet.create()`, inside the existing `transaction.atomic()` block after the post
  exists: call `sync_link_previews(post)`; alongside the existing on-commit media enqueue, add
  `transaction.on_commit(lambda: _enqueue_fetch_link_previews(post.pk))` when there are pending
  rows (`_enqueue_...` wraps `.enqueue` in try/except exactly like `_enqueue_process_post_media`).
- In the update path (`update()` / `perform_update`), when `head` or `body` changed: same sync +
  conditional on-commit enqueue.

### 5. Serializer — `server/apps/blogs/serializers.py`

- `LinkPreviewSerializer(serializers.ModelSerializer)`: fields
  `["id", "url", "kind", "title", "description", "site_name", "author_name", "author_handle", "embed_id", "image"]`
  with `image = SerializerMethodField` →
  `request.build_absolute_uri(reverse("link-preview-image", args=[obj.pk]))` when `obj.image`
  else `None`.
- `PostSerializer`: `link_previews = SerializerMethodField` — filter
  `obj.link_previews.all()` in Python for `status == "ok"` (keeps the prefetch hot), serialize
  many with context. Add `"link_previews"` to `Meta.fields`.
- `PostViewSet.get_annotated_queryset()`: add `"link_previews"` to `prefetch_related`.

### 6. Image endpoint

- `server/apps/blogs/views.py`: `def link_preview_image(request, preview_id)`:
  - 404 if no such preview / empty image / **`not preview.post.is_visible_to(request.user, token=request.GET.get("token"))`** (private-post images must not leak).
  - `FileResponse(preview.image.open("rb"), content_type="image/jpeg")` with
    `Cache-Control: private, max-age=86400`. Works transparently for local and R2 storage.
- `server/config/urls.py`: `path("api/link-previews/<int:preview_id>/image/", link_preview_image, name="link-preview-image")`.

### 7. Settings — `server/config/settings.py`

- CSP: add `'frame-src': [SELF, "https://www.youtube-nocookie.com"]` to
  `CONTENT_SECURITY_POLICY_DIRECTIVES` (needed for click-to-play embeds; images need no change —
  they are served same-origin).
- `pyproject.toml`: `httpx` is being added as an explicit dependency (already transitively
  installed via openai).

## Frontend

### 8. Types + API — `app/src/types/post.ts`, `app/src/lib/api/posts.ts`

```ts
export type LinkPreviewKind = 'youtube' | 'twitter' | 'generic'
export interface LinkPreview {
  id: number
  url: string
  kind: LinkPreviewKind
  title: string
  description: string
  site_name: string
  author_name: string
  author_handle: string
  embed_id: string
  image: string | null
}
// Post gains:  link_previews?: LinkPreview[]
```
`revivePost` passes `link_previews` through unchanged (no dates); default to `[]` when absent.

### 9. `app/src/components/post/LinkPreviewCard.tsx` (default export)

`function LinkPreviewCard({ preview }: { preview: LinkPreview })` switching on `kind`; three
internal subcomponents in the same file. Shared rules: `mt-3` between text and card,
`space-y-2` when stacking multiple; semantic tokens only; every outbound anchor gets
`target="_blank" rel="noopener noreferrer"`; add `data-testid="link-preview-<kind>"`.

**YouTubeCard** — the hero treatment:
- Container: `overflow-hidden rounded-md border`.
- Media area: `aspect-video` (`relative bg-black`). Initially the thumbnail
  (`<img className="h-full w-full object-cover" loading="lazy">`, alt = title) with a centered
  play button reusing the VideoPlayer overlay pattern
  (`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/80 text-primary-foreground` with lucide `Play`,
  `aria-label="Play video"`). If `image` is null, show the play button on the black area alone.
- Clicking the media area (a `<button>`, not an anchor) swaps state to an iframe:
  `https://www.youtube-nocookie.com/embed/${embed_id}?autoplay=1` with
  `className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen title={title}`.
- Text block below, `p-3`, wrapped in an anchor to the video URL:
  title `text-sm font-medium leading-snug line-clamp-2`; meta line
  `mt-1 text-[13px] text-muted-foreground truncate` → `{author_name} · YouTube`;
  description (when present) `mt-1 text-[13px] text-muted-foreground line-clamp-2`.

**TweetCard** — quote-card, whole card is one anchor:
- `block rounded-md border p-3 transition-colors hover:border-primary/20 hover:bg-accent/30`.
- Header row: an inline 𝕏 logo SVG (`h-4 w-4 fill-current`, official simple X path, viewBox
  "0 0 24 24" — path `M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z`),
  then `author_name` `text-sm font-medium truncate`, then `@{author_handle}`
  `text-[13px] text-muted-foreground truncate` (skip when handle empty).
- Tweet text: `mt-2 text-sm leading-relaxed line-clamp-6 whitespace-pre-line` from `description`.

**GenericCard** — compact horizontal card, whole card is one anchor:
- `flex overflow-hidden rounded-md border transition-colors hover:border-primary/20 hover:bg-accent/30`.
- Left column `min-w-0 flex-1 p-3`: site line `text-[13px] text-muted-foreground truncate` →
  `site_name || hostname(url)` (strip `www.`); title `mt-0.5 text-sm font-medium leading-snug line-clamp-2`;
  description `mt-1 text-[13px] text-muted-foreground line-clamp-2`.
- Right: when `image`, `<img className="h-[88px] w-[88px] shrink-0 border-l object-cover" loading="lazy" alt="">`.

### 10. Wiring — `app/src/components/post/Post.tsx`

After the media block and before the transcript block:

```jsx
{post.link_previews && post.link_previews.length > 0 && (
  <div className="mt-3 space-y-2">
    {post.link_previews.map((preview) => (
      <LinkPreviewCard key={preview.id} preview={preview} />
    ))}
  </div>
)}
```

Inline URL linkification in `FormatText` stays as is (text link + card below, like every major
platform).

### 11. Mocks — `app/src/__tests__/data/mockPosts.ts`

`makePost` defaults `link_previews: []`; add `makeLinkPreview(overrides)` factory
(defaults: generic kind, title/description/site_name set, `image: null`).

## Tests

Backend — `server/apps/blogs/tests/test_link_previews.py` (use `BaseTestCase`/`ViewTestCase`;
patch fetchers by name, e.g. `mock.patch("apps.blogs.link_previews.fetch_generic", ...)` or
patch `fetch_preview_for` at the task's import site — never let tests hit the network; note the
immediate task backend runs enqueued tasks inline during API calls, so view tests MUST patch):
1. `extract_urls`: dedupe, order, cap at 3, trailing-punctuation stripping, `www.` normalization,
   URLs in `head` counted too.
2. `detect_kind`: all YouTube URL shapes → correct video id; x.com and twitter.com status URLs →
   twitter + handle; everything else generic.
3. SSRF guard: `http://localhost/…`, `http://127.0.0.1/…`, `http://169.254.169.254/…`,
   `ftp://…`, hostname resolving to 10.x (mock `socket.getaddrinfo`) all refuse; a public IP
   passes the resolution gate (mock the actual HTTP call).
4. `fetch_preview_for` with patched fetchers: ok path populates fields + status/fetched_at;
   fetcher returning None → `failed`; exception → `failed` (via task wrapper).
5. API: creating a post with a YouTube URL in body creates a LinkPreview row and the serialized
   post exposes `link_previews` with the mocked metadata; a post with no URLs has `[]`;
   pending/failed rows are omitted from the payload.
6. Update flow: editing body to remove URL deletes its row; adding a new URL creates + fetches.
7. Image endpoint: 404 for missing/empty image; 404 for a private post's preview when anonymous;
   200 + bytes for a public one (attach a tiny generated JPEG).
8. `Post.delete()` removes preview rows and their image files.

Frontend — `app/src/__tests__/components/LinkPreviewCard.test.tsx` + extend `Post.test.tsx`:
1. Generic: renders site name (hostname fallback), title, description, image when present;
   anchor has correct href/target/rel.
2. YouTube: renders thumbnail + channel + "YouTube" + description; clicking play swaps in an
   iframe whose src contains `youtube-nocookie.com/embed/<id>?autoplay=1`.
3. Twitter: renders author name, @handle, tweet text.
4. Post integration: post with `link_previews` renders the cards after media; post with `[]`
   renders none.

## Non-goals (v1)

- No refetch/staleness job (previews are fetched once at post time; edits re-fetch new URLs).
- No favicon fetching, no player embeds for X, no oEmbed for arbitrary providers.
- No admin registration, no per-user disable toggle.
- No URL-level dedupe across posts (each post owns its rows; simple cascade semantics win).
