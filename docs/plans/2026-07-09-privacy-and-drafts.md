# Post privacy + drafts — implementation spec

Status: implemented 2026-07-09 (P1 of docs/feature-backlog.md).

Per-post visibility (public / unlisted / private) with regeneratable share tokens, and
drafts as unpublished author-only posts with a drafts tab and publish flow. Drafts are a
lifecycle state orthogonal to visibility; both are enforced server-side on every surface
that serves post content (feed, detail API, comments, media streaming, mime-type, OG page,
stats).

## Vocabulary

- **public** — visible to everyone, everywhere (default; today's behavior).
- **unlisted** — "link-visible": hidden from other users' feeds and profiles; anyone
  holding the post's share token can open it by link. The author sees it in their own
  feed/profile as normal.
- **private** — author only (plus superuser on detail surfaces, consistent with existing
  admin edit/delete powers — but NOT in the superuser's feed).
- **draft** — `is_draft=True`; not published. Author-only regardless of `visibility`.
  Lives in a Drafts tab, not in any feed. Publishing sets `is_draft=False` and bumps
  `created` to now, so the post enters the feed at the top with its public timestamp
  being the publish time (this is deliberate: cursor pagination orders on
  `('-created', '-id')` and stays untouched; `auto_now_add` only applies on INSERT, so
  assigning `created` and saving with `update_fields` persists on UPDATE).

## Backend

### Model (`server/apps/blogs/models.py`)

```python
VISIBILITY_PUBLIC = 'public'
VISIBILITY_UNLISTED = 'unlisted'
VISIBILITY_PRIVATE = 'private'
VISIBILITY_CHOICES = [...]

def generate_share_token():
    return secrets.token_urlsafe(16)   # 22 chars

class Post:
    visibility = models.CharField(max_length=16, choices=VISIBILITY_CHOICES,
                                  default=VISIBILITY_PUBLIC, db_index=True)
    is_draft = models.BooleanField(default=False, db_index=True)
    share_token = models.CharField(max_length=32, default=generate_share_token)
```

- No unique constraint on `share_token`: it is only ever compared against a single post
  fetched by id, never used for lookup.
- New `PostQuerySet` with `visible_to(user)`: published posts only
  (`is_draft=False`), then `visibility='public' | author=user` for authenticated users,
  public-only for anonymous. **Superusers get the same feed as everyone else** (public +
  own) — moderation access is via detail, not via flooding the admin's feed.
- Object-level `Post.is_visible_to(user, token=None)`:
  author or superuser → True; drafts otherwise False; public → True; unlisted → True iff
  `token` matches via `django.utils.crypto.constant_time_compare`; else False.
- Migration: add the three fields, then a `RunPython` backfill generating a distinct
  token per existing row (the callable default would give migration-time rows one shared
  value only if added naively — loop and save per row).

### ViewSet (`server/apps/blogs/views.py`)

- `get_queryset()` keeps its annotations and gains scoping:
  - `?drafts=true` → authenticated only (anonymous gets `.none()`), returns **only the
    requester's drafts** (`author=user, is_draft=True`), ignore `author`/`liked` params.
    Cursor pagination already orders `-created`, which is right for drafts too.
  - otherwise → `.visible_to(request.user)` composed with the existing `author`/`liked`
    filters.
- Override `get_object()`: fetch by pk from the **annotated but visibility-unfiltered**
  queryset, then `is_visible_to(request.user, token=request.query_params.get('token'))`.
  Invisible → raise DRF `NotFound` (**404, not 403** — do not leak existence). Then
  `check_object_permissions` as usual. This gates retrieve, like, comments, transcribe,
  update, destroy uniformly (you can like/comment on an unlisted post you opened by
  token; you cannot interact with a post you cannot see).
- `create`: accept `visibility` and `is_draft`. If `visibility != 'public'` or
  `is_draft` truthy and the requester is **not authenticated** → 401 (anonymous posts
  stay public-published; a private/draft post owned by the shared `anonymous` user would
  be orphaned).
- New actions:
  - `POST /api/posts/<id>/publish/` — author or superuser (404 for others via
    get_object, then 403 check like update). If draft: `is_draft=False`,
    `created=timezone.now()`, save with `update_fields`. Idempotent: publishing a
    published post is a 200 no-op. Returns the full `PostSerializer` payload.
  - `POST /api/posts/<id>/share-token/` (action `regenerate_share_token`) — author or
    superuser. Sets a fresh `generate_share_token()`, returns full post payload (which
    includes the new token for the author).
- `stats`: replace `Post.objects.filter(author_id=…)` with
  `Post.objects.visible_to(request.user).filter(author_id=…)` and count likes on that
  same visible set (`Like.objects.filter(post__in=…)`).
- `stream_post_media` and `get_post_media_mime_type`: resolve the post, then
  `is_visible_to(request.user, request.GET.get('token'))` → 404 when invisible (this
  replaces the standing `# TODO: Restrict access` comments).
- `post_detail` (`/p/<id>/`): same check with `request.GET.get('token')` → `Http404`.
  For visible non-public posts pass `noindex=True` in context and render
  `<meta name="robots" content="noindex">` in `blogs/post_detail.html`. The JSON branch
  is covered by the same gate.

### Serializers (`server/apps/blogs/serializers.py`)

- `PostSerializer` gains:
  - `visibility` — writable (used by PATCH; author/admin gating already happens in
    `update`).
  - `is_draft` — **read-only** (publishing goes through the action; no un-publish).
  - `share_token` — `SerializerMethodField`: return the token only when the request user
    is the author or a superuser, else `None`. **Never leak tokens to other users.**
- `PostCreateSerializer` gains `visibility` and `is_draft` (both optional).
- `post_set` currently serializes hyperlinks to ALL child posts, which would leak
  private/draft children. The frontend ignores the field entirely (`app/src/types/post.ts`
  has no `post_set`). Replace it with a `SerializerMethodField` returning the ids of
  children visible to the request user (`[c.id for c in obj.post_set.all() if
  c.is_visible_to(user)]`, using the prefetched relation; treat missing request context
  as anonymous).

## Frontend (`app/`)

Types (`src/types/post.ts`): `PostVisibility = 'public' | 'unlisted' | 'private'`;
`Post` += `visibility: PostVisibility`, `is_draft: boolean`, `share_token?: string |
null`; `CreatePostRequest` += `visibility?`, `is_draft?`; `UpdatePostRequest` +=
`visibility?`.

API client (`src/lib/api/posts.ts`):
- `createPost`: append `visibility` (when not `'public'`) and `is_draft` (`'true'`) to
  the FormData in both the S3 and direct branches.
- `PostsQueryScope` += `drafts?: boolean` → `?drafts=true`.
- `publishPost(id)`, `regenerateShareToken(id)` (POST `/posts/<id>/share-token/`).
- `getShareUrl(post)`: `post.url` plus `?token=<share_token>` when the post is unlisted
  and the token is present. Use it everywhere a share link is built (PostActions copy,
  detail links). `getMediaUrl` also appends `?token=` for unlisted posts with a token so
  the streaming fallback works for token-holders.

`usePosts` (`src/hooks/usePosts.ts`):
- Scope normalization/keys understand `drafts`.
- `shouldPrependPostToScope`: draft posts prepend **only** to drafts-scoped caches;
  published posts never prepend to drafts scopes (existing author/liked logic otherwise
  unchanged).
- New `publishPost` mutation: on success remove the post from drafts-scoped caches,
  prepend the (re-timestamped) post to the unscoped feed and matching author scope, and
  refresh the tag cache.
- Share-token regeneration: update the post in place across caches.

Composer (`src/components/post/create/CreatePost.tsx`) — authenticated users only (use
`useAuth`; anonymous users see today's composer unchanged):
- **Visibility picker**: a small ghost icon button in the expanded toolbar row, left of
  the Post pill — icon reflects current choice (`Globe` public / `Link2` unlisted /
  `Lock` private, lucide, `h-4 w-4`, muted) — opening a `DropdownMenu` with three radio
  items, each icon + label + one-line muted description:
  - Public — "Anyone can see this post"
  - Link only — "Hidden from the feed; anyone with the link can see it"
  - Private — "Only you can see this post"
  Default public; resets to public after posting.
- **Save as draft**: a ghost `size="sm"` text button "Draft" immediately left of the
  Post pill, visible only when `expanded && canPost`. Tooltip "Save as draft". Submits
  the same payload with `is_draft: true`; success toast "Saved to drafts."; the regular
  Post success toast stays "Post created successfully!".

Post card:
- `PostHeader`: after the timestamp, for the author's non-public posts show a muted
  visibility glyph (`Lock` private / `Link2` unlisted, `h-3.5 w-3.5`) with a tooltip
  naming the state. Drafts show a small "Draft" chip (subtle border + muted foreground,
  the app's chip idiom — see tag chips) instead of the glyph.
- `PostActions`: drafts hide like/comment/share and instead show a compact primary
  "Publish" button (Send icon + label, `size="sm"`, rounded-full). Private posts hide
  the share button. Unlisted share copies `getShareUrl(post)` (token link).
- `PostMenu` (author/admin only), new items:
  - "Visibility" `DropdownMenuSub` with radio items (same three labels) → PATCH
    `{visibility}` through the existing edit pipeline; toast "Visibility updated."
  - Unlisted only: "Copy share link" and "Reset share link" (regenerates, then copies
    the new link; toast "New share link copied. Old links no longer work.")
  - Drafts only: "Publish".
- Wire handlers through `usePostHandlers` (publish, changeVisibility, copy/reset share
  link) next to the existing like/edit/delete handlers.

Profile (`src/components/Profile.tsx`): add a fourth tab **Drafts** (`usePostHandlers({
drafts: true })`, enabled when authenticated). Empty state: "No drafts yet. Drafts you
save from the composer land here." When >1 draft, a right-aligned ghost "Publish all"
button above the list with a confirmation dialog ("Publish N drafts?"); publishing loops
the publish mutation sequentially. Profile header post count remains published-only
(server stats already exclude drafts).

## Tests

Backend — new `server/apps/blogs/tests/test_privacy.py` covering at minimum:
feed matrix (anon / other user / author / superuser × public / unlisted / private /
draft), detail + token (valid, missing, wrong, draft-with-token → 404), media stream +
mime-type gating, `/p/<id>/` gating + noindex flag, stats visibility, share_token
serialization (author sees it, others get null), anonymous create restrictions (401),
publish (state flip, created bump, idempotency, permission), token regeneration
(rotation invalidates old link, permission), PATCH visibility, liked-feed and comments
composition with visibility. Update existing tests where payload shape changed
(`post_set`, new fields).

Frontend — extend `mockPosts` with the new fields; unit tests for the visibility picker,
draft submit, drafts tab + publish flow, `getShareUrl` token behavior.

Run: backend `uv run python server/manage.py test`, frontend `cd app && bunx tsc -b &&
bun test`, `bun run check` (Biome). E2E is run separately at review time.

## Security invariants (do not regress)

1. Invisible posts return **404** everywhere, never 403.
2. `share_token` is compared with `constant_time_compare` and never serialized to
   non-authors.
3. All gating is server-side; the client only decides what UI to show.
4. Anonymous requests can only create public, published posts.
