# Link previews: Hacker News, Reddit, and ChatGPT share cards — implementation spec

Status: implemented 2026-07-10 (fable-5 spec → codex gpt-5.5 → fable-5 judge + live-verify).
One judge-round fix: a Hacker News item with no `time` field now yields `published_at=None`
instead of the 1970 epoch date. Live verification passed all probes against the real network
(story + comment cards with the Firebase parent walk, Reddit oEmbed card, ChatGPT share card
with the UUID-derived date, dead share id → no card). Note: the server-rendered `/p/<id>` share
page has never rendered preview cards for any kind — feed-only, unchanged by this work.

Follow-up to docs/plans/2026-07-09-link-previews.md and
docs/plans/2026-07-09-link-preview-refresh-and-toggle.md — read both first; this reuses their
machinery (SSRF-guarded `_safe_get`, `fetch_preview_for` dispatch, refresh command, cards file).

Three new preview kinds, each replacing today's broken/mediocre generic behavior:

- `hackernews` — HN item pages have no OpenGraph at all; the official Firebase API
  (`https://hacker-news.firebaseio.com/v0/item/<id>.json`, no auth) returns
  `{by, descendants, score, time, title, type, url}`. Card shows title, points, comment count,
  author, date, and the story's outbound domain. Comment links work too (`text` + parent walk).
- `reddit` — Reddit 403s its `.json` API for non-browser UAs and serves post pages as a
  bot-verification interstitial (today's generic fetcher stores the junk title
  "Reddit - Please wait for verification"). The one unauthenticated door is oEmbed
  (`https://www.reddit.com/oembed?url=…`) which returns `title` + `author_name`. Card shows
  subreddit, title, author. No score/thumbnail (that would need OAuth — non-goal).
- `chatgpt` — share pages (`chatgpt.com/share/<uuid>`) are served with the chat title in
  `og:title` ("ChatGPT - <chat title>"). The generic fetcher mishandles them today: the page
  repeats `og:description`/`og:url` with app-level marketing values and our last-wins
  MetadataParser keeps the junk. Dedicated fetcher takes the FIRST `og:title`, strips the
  prefix, and renders a branded card. Dead share ids serve a shell with no `og:title` → clean
  failure, no card.

Empirical notes that pin the design (probed 2026-07-10 with the production User-Agent):
Firebase returns literal `null` for missing items; deleted/dead items carry `deleted`/`dead`
flags. Reddit oEmbed 400s on `redd.it` short links. chatgpt.com returns 403 for malformed share
ids and 200-with-bare-shell for well-formed-but-nonexistent ones; the conversation content is
NOT server-embedded (no snippet possible), but the share UUID's first hex segment is the
conversation's unix creation time (`67681bfe` → 2024-12-22, matches that chat's content) —
use it for `published_at` behind a sanity clamp so the trick can only fail closed.

## Backend

### 1. Model — `server/apps/blogs/models.py`

- `LinkPreview.extra = models.JSONField(default=dict, blank=True)` — provider-specific
  metadata; do NOT overload author_handle/embed_id for it. Contents by kind:
  - hackernews story/job/poll: `{"score": int, "comments": int}` plus `"domain": str` when the
    story links out (hostname, `www.` stripped).
  - hackernews comment: `{"is_comment": true}`.
  - reddit: `{"subreddit": str}`.
  - youtube/twitter/chatgpt/generic: `{}` (leave untouched).
- `KIND_CHOICES` += `("hackernews", "Hacker News"), ("reddit", "Reddit"), ("chatgpt", "ChatGPT")`
  (`kind` is max_length=16 — "hackernews" fits).
- One migration (`makemigrations`, expect `0025_*`). No data migration for pre-existing rows:
  they upgrade via the sync re-detect below on next edit; a one-off backfill is
  `for p in LinkPreview.objects.filter(kind='generic'): …` in shell_plus if ever wanted.

### 2. Detection — `link_previews.py`

Module-level regexes:

```python
REDDIT_POST_RE = re.compile(r'^/r/([^/]+)/comments/[a-z0-9]+', re.IGNORECASE)
CHATGPT_SHARE_RE = re.compile(r'^/share/(?:e/)?([0-9a-fA-F-]{8,})/?$')
```

`detect_kind(url)` gains three branches between the twitter check and the generic fallthrough:

- `news.ycombinator.com` with path `/item` and a digits-only `id` query param →
  `("hackernews", item_id)`.
- hostname in `{reddit.com, www.reddit.com, old.reddit.com, np.reddit.com, new.reddit.com,
  m.reddit.com}` and `REDDIT_POST_RE` matches path → `("reddit", "")` (the fetcher re-parses
  the subreddit from the URL with the same regex; don't thread it through).
- hostname in `{chatgpt.com, chat.openai.com}` and `CHATGPT_SHARE_RE` matches path →
  `("chatgpt", "")`.

Out of scope (stay generic, i.e. fail with no card, same as today): `redd.it` short links,
`/r/<sub>/s/<token>` share links (both need a redirect resolve through the bot wall),
HN front/user pages, non-share ChatGPT URLs.

`sync_link_previews` changes:
- store `embed_id` for hackernews like youtube: `if kind in {"youtube", "hackernews"}:
  create_kwargs["embed_id"] = provider_id`.
- **Re-detect on kept rows**: for each surviving preview, run `detect_kind(preview.url)`; when
  the detected kind differs from the stored one, set `kind`, `embed_id` (for
  youtube/hackernews), and `status="pending"`, save. This upgrades pre-existing generic rows
  (e.g. Reddit junk-title cards) the next time their post is edited.

### 3. HTML fragment helper

HN `text` fields (Ask HN bodies, comments) contain entities and `<p>`/`<i>`/`<a>`/`<pre>` tags.
Add `HtmlTextParser(HTMLParser)` beside `ParagraphTextParser`: `convert_charrefs=True`, collects
all character data, inserts a single space on `<p>`/`<br>` start tags; `text` property returns
the whitespace-collapsed join. Wrap in `_strip_html_fragment(fragment: str) -> str`.

### 4. Fetchers (same contract as the existing three: dict or None, patchable by name)

**`fetch_hackernews(url, item_id)`**
1. `_safe_get(f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json", max_bytes=MAX_HTML_BYTES)`
   (the SSRF guard runs on every outbound URL, fixed hosts included — same rule as oEmbed).
   None / non-2xx / body `null` / unparseable / `deleted` / `dead` → return None.
2. `type` in `{"story", "job", "poll"}`:
   - `title` required (else None); `description = _strip_html_fragment(item.get("text", ""))`.
   - `extra = {"score": int(item.get("score") or 0), "comments": int(item.get("descendants") or 0)}`;
     when `item.get("url")` is truthy add `extra["domain"]` = its hostname minus a `www.` prefix.
   - `author_name = by`, `published_at = datetime.fromtimestamp(time, tz=UTC).date()`,
     `site_name = "Hacker News"`, `embed_id = item_id`, no `image_url`.
3. `type == "comment"`:
   - `description = _strip_html_fragment(text)` — required (else None); `author_name = by`;
     `published_at` from `time`; `extra = {"is_comment": True}`.
   - Walk `parent` ids with further Firebase gets (cap: 8 hops) until `type == "story"` →
     `title` = story title; cap exceeded or a hop fails → `title = ""` (card copes).
4. Any other `type` → None.

**`fetch_reddit(url)`**
1. Subreddit + path via `REDDIT_POST_RE` on `urlparse(url).path` (no match → None).
2. Normalize before embedding: `canonical = f"https://www.reddit.com{path}"` (drops
   old./np./query noise — oEmbed was only verified against www).
3. `_safe_get(f"https://www.reddit.com/oembed?url={quote(canonical, safe='')}", …)`;
   None / non-2xx / bad JSON / missing `title` → None.
4. Return `title`, `author_name = data.get("author_name", "")`, `site_name = "Reddit"`,
   `extra = {"subreddit": subreddit}`, `published_at = None`, no image.

**`fetch_chatgpt(url)`**
1. `_safe_get(url, …)`; None / non-2xx / content-type without `text/html` → None.
2. First-occurrence meta regex (attribute order tolerant, `html.unescape` the value):
   `_first_meta_content(text, "og:title")` matching
   `<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']` and the
   content-before-property variant, taking whichever appears earliest.
3. Title must start with `"ChatGPT - "`; strip that prefix; empty remainder or no match →
   None. (Dead shares have no `og:title`; the marketing block's plain "ChatGPT" also fails —
   both are correct no-card outcomes.)
4. `published_at`: take the first 8 hex chars of the share UUID (`CHATGPT_SHARE_RE` group),
   parse as unix seconds; accept only if between 2022-11-30 and tomorrow (UTC), else None.
5. `description = ""`, `site_name = "ChatGPT"`, author fields `""`, `embed_id = ""`,
   `extra = {}`, no image.

**`fetch_preview_for`** — add the three dispatch branches
(`hackernews → fetch_hackernews(preview.url, preview.embed_id)`, reddit/chatgpt by url);
apply `preview.extra = data.get("extra") or {}` and add `"extra"` to `update_fields`.

### 5. Serializer — `serializers.py`

`LinkPreviewSerializer.Meta.fields` += `"extra"`. Nothing else changes (the refresh command and
task dispatch on `kind` and need no edits).

## Frontend

### 6. Types — `app/src/types/post.ts`, `app/src/lib/api/posts.ts`, mocks

```ts
export type LinkPreviewKind = 'youtube' | 'twitter' | 'hackernews' | 'reddit' | 'chatgpt' | 'generic'
export interface LinkPreviewExtra {
  score?: number
  comments?: number
  domain?: string
  subreddit?: string
  is_comment?: boolean
}
// LinkPreview gains:  extra: LinkPreviewExtra
```

`revivePost`: default `extra` to `{}` when absent on each preview (older cached payloads).
`makeLinkPreview` in mockPosts.ts: default `extra: {}`.

### 7. Cards — `app/src/components/post/LinkPreviewCard.tsx`

Three new subcomponents in the same file, mirroring TweetCard's shape exactly: the whole card is
one anchor `block rounded-md border p-3 transition-colors hover:border-primary/20
hover:bg-accent/30` with `target="_blank" rel="noopener noreferrer"` and
`data-testid="link-preview-<kind>"`. Dispatch: add the three kind branches before the generic
fallback. Post.tsx needs no changes (kind dispatch + the reader-side `showLinkPreviews` gate
already wrap this component).

Header rows follow the TweetCard pattern: `flex min-w-0 items-center gap-2`, icon `h-4 w-4`,
name `text-sm font-medium`, secondary text `text-[13px] text-muted-foreground truncate`.
Title lines: `mt-2 line-clamp-2 text-sm font-medium leading-snug`. Meta lines:
`mt-2 truncate text-[13px] text-muted-foreground`, parts joined with `' · '` and empties
filtered — reuse the existing `formatPublishedDate` for dates. Local helper for counts:
`const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`` (proper
singulars: "1 point", "1 comment").

**HackerNewsCard**
- Icon: Y Combinator mark, `#ff6600` in both themes (`<svg viewBox="0 0 24 24"
  className="h-4 w-4 shrink-0 fill-[#ff6600]" aria-hidden="true">` — path constant
  `HN_LOGO_PATH` verbatim:
  `M0 24V0h24v24H0zM6.951 5.896l4.112 7.708v5.064h1.583v-4.972l4.148-7.799h-1.749l-2.457 4.875c-.372.745-.688 1.434-.688 1.434s-.297-.708-.651-1.434L8.831 5.896h-1.88z`).
- Header: icon, `Hacker News`, then `extra.domain` as the secondary text when present.
- Title (skip the element when title is empty — comment fallback).
- Description when present (Ask HN text / comment text):
  `mt-1 line-clamp-3 text-[13px] text-muted-foreground`.
- Meta: stories → `count(extra.score ?? 0, 'point')`, `count(extra.comments ?? 0, 'comment')`,
  `by {author_name}` (only when author_name), date. Comments (`extra.is_comment`) →
  `Comment by {author_name}`, date.

**RedditCard**
- Icon: Snoo-in-circle, monochrome `fill-current` (theme-proof, matches the X card treatment) —
  path constant `REDDIT_LOGO_PATH` verbatim:
  `M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z`
- Header: icon, `r/{extra.subreddit}` (fall back to `Reddit` when subreddit missing), then
  `Reddit` as secondary text (only when the subreddit rendered).
- Title. No description (oEmbed has none).
- Meta: `u/{author_name}` when present.

**ChatGPTCard**
- Icon: OpenAI knot, monochrome `fill-current` — path constant `OPENAI_LOGO_PATH` verbatim:
  `M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z`
- Header: icon, `ChatGPT`.
- Title.
- Meta: `Shared conversation`, date.

## Tests

Backend — extend `server/apps/blogs/tests/test_link_previews.py`; NO network (patch `_safe_get`
or the fetcher names; view tests patch `fetch_preview_for` — the immediate task backend runs
inline). Google docstrings everywhere (ruff D rules).

1. `detect_kind`: `news.ycombinator.com/item?id=123` (also with extra query params) →
   `("hackernews", "123")`; `/newest` and `/user?id=x` → generic. www/old/np/bare reddit
   comments URLs → reddit; `/r/x/s/token` and `redd.it/abc` → generic.
   `chatgpt.com/share/<uuid>`, `chatgpt.com/share/e/<uuid>`, `chat.openai.com/share/<uuid>` →
   chatgpt; `chatgpt.com/g/foo` → generic.
2. `fetch_hackernews`: story JSON → full dict (score/comments/domain/author/date); Ask HN
   `text` with `<p>`/entities → clean description, no `domain` key; `null` body, `deleted`,
   `dead`, unknown type → None; comment → parent-walked story title + `is_comment`; walk
   capped at 8 → `title == ""`.
3. `fetch_reddit`: oEmbed JSON → dict with subreddit extra; assert the oEmbed request URL uses
   the www-canonicalized post URL when fed an old.reddit link; 400/None/missing-title → None.
4. `fetch_chatgpt`: HTML containing the share `og:title` FOLLOWED BY the app-level marketing
   `og:title`-less duplicates (mirror the real page) → prefix-stripped title, uuid-derived
   `published_at`; shell with no `og:title` → None; `og:title` without the `"ChatGPT - "`
   prefix → None; uuid prefix `00000000` → `published_at is None`, still ok.
5. `fetch_preview_for` dispatch: three kinds route to the right fetcher (patch by name) and
   `extra` persists + serializes through the post API.
6. `sync_link_previews` re-detect: a `kind="generic"` row whose URL is a reddit post →
   after sync, `kind == "reddit"` and `status == "pending"`.

Frontend — extend `app/src/__tests__/components/LinkPreviewCard.test.tsx` (run `bun run test`,
NOT bare `bun test`):

1. hackernews story: header "Hacker News" + domain, title, description, meta
   "57 points · 3 comments · by pg · Oct 9, 2006"; anchor href/target/rel; testid.
2. hackernews singulars: score 1 / comments 1 → "1 point · 1 comment".
3. hackernews comment: no title element when title empty, "Comment by sama" meta,
   comment text rendered.
4. reddit: "r/programming" + "Reddit" header, title, "u/ChemicalRascal" meta; testid.
5. chatgpt: "ChatGPT" header, title, "Shared conversation · Dec 22, 2024" meta; testid.

## Gates (run all before finishing)

- `uvx ruff check server/` and `uvx ruff format --check server/` (pyproject sets fix=true —
  bare `check` may mutate, that's fine).
- `uv run python server/manage.py test apps`
- `cd app && bun run test && bunx tsc --noEmit && bun run check && bun run format:check`

## Non-goals

- Reddit score/comment-count/thumbnail (OAuth-only), `redd.it` short links, `/r/…/s/…`
  share-link resolution.
- ChatGPT first-message snippet (conversation content is not server-rendered) and
  `chatgpt.com/c/…` private chat URLs (auth-walled; correctly stay generic → no card).
- HN non-item pages; fetching HN story thumbnails (items have none).
- Backfill data migration for pre-existing generic rows (they upgrade on next post edit via the
  sync re-detect).
