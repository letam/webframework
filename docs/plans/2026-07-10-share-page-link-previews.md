# Share-page link-preview cards (`/p/<id>`)

**Status:** implemented 2026-07-10 (codex at xhigh — CLI default resolved to gpt-5.6-terra — judged
by fable-5, no defects found). Live-verified on /p/23 (HN/Reddit/ChatGPT) and /p/18
(YouTube/X/generic) in light and dark themes. The stale CSP style hash below was confirmed and
fixed; `test_csp_hashes.py` now guards all four production templates.
**Date:** 2026-07-10
**Prior art:** `docs/plans/2026-07-09-link-previews.md`, `docs/plans/2026-07-10-link-preview-sources.md`

## Goal

The server-rendered post share page (`/p/<id>`, `server/apps/blogs/templates/blogs/post_detail.html`)
has never rendered link-preview cards for any kind — they are a feed-only affordance today. Add
server-rendered cards for **all six kinds** (youtube, twitter, hackernews, reddit, chatgpt,
generic), visually and textually matching the React feed cards
(`app/src/components/post/LinkPreviewCard.tsx`), which remain the copy/design source of truth.

## Critical pre-existing bug this work must fix

Production CSP allowlists inline `<style>`/`<script>` blocks **by sha256 hash**
(`server/config/settings.py`, `CONTENT_SECURITY_POLICY_DIRECTIVES`, non-DEBUG branch). The current
hash of `post_detail.html`'s style block is `sha256-GFgBgS655ypyq1rQgRdrzLNnoMWjE48nf4JkepDZQao=`
— **absent** from `style-src`. A past template edit didn't recompute it, so in production the share
page renders **unstyled** (dev masks this: DEBUG CSP has `unsafe-inline`). The stale entry is
`'sha256-JayKhsDueQH1eSiZMpD2bwcA5rUMPYRclFLcblDmxvU='` in the "Hashes for styles in Django HTML
templates" group (the other two in that group are base.html = `GWweo…` and header.html = `c2svK…`,
both verified current).

This feature edits that same style block, so: after finalizing the template, recompute the hash and
**replace the `JayKh…` entry** with the new one, commenting which template it covers. Then add the
regression test below so this can never silently break again.

Hash computation (content between `<style>` and `</style>`, exact bytes):

```bash
python3 - <<'EOF'
import base64, hashlib, re
html = open('server/apps/blogs/templates/blogs/post_detail.html').read()
css = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
print("'sha256-" + base64.b64encode(hashlib.sha256(css.encode()).digest()).decode() + "='")
EOF
```

**Constraint:** the style block must stay free of Django template syntax (`{{ }}`/`{% %}`), so
source bytes == rendered bytes and the hash is computable from the file. This already holds; keep
it true.

## Design decisions (pinned — do not deviate)

1. **Copy parity with the feed.** Every card shows exactly the same text as its React counterpart:
   same meta-line ordering, same `·` separators, same pluralization (`1 point`, `2 points`), same
   date format (`Oct 9, 2006`). Django date format string: `'M j, Y'` (equivalent to date-fns
   `'MMM d, yyyy'`).
2. **Meta lines are assembled in the view, not the template.** Django templates are bad at
   conditional joins; a small helper builds the muted meta string per kind. Twitter (name +
   @handle header, date below) and Reddit (`u/author` line) keep their pieces in the template
   since they're separately styled.
3. **YouTube is a static card that links out** — thumbnail (16:9, black letterbox) with a centered
   play badge, whole card links to the video URL in a new tab. No iframe, no click-to-play JS: the
   share page is a zero-JS content page (only base.html's theme script), and adding an inline
   script would mean another CSP hash to maintain. `frame-src` already allows
   `youtube-nocookie.com` if we ever upgrade this — noted as a non-goal.
4. **Gating mirrors the API serializer:** cards render only when `post.link_previews_enabled` and
   only previews with `status == 'ok'`, in model ordering (`position, id`). The reader-side
   "show link previews" toggle is a client-app concept and does not apply here.
5. **Preview thumbnails go through the gated image endpoint** (`link-preview-image`), like post
   media goes through `stream_post_media`. For **unlisted** posts append `?token={share_token}` —
   same pattern as `media_url` in `post_detail`.
6. **Placement:** after the transcript block, before `.post-engagement`.
7. **Styling** uses the existing shadcn HSL custom properties (`hsl(var(--border))` etc.) so light
   and dark themes both work; card chrome matches the feed (1px border, radius
   `calc(var(--radius) - 2px)`, 12px padding, subtle hover).
8. **SVG brand paths are copied verbatim** from `app/src/components/post/LinkPreviewCard.tsx`
   (`X_LOGO_PATH`, `HN_LOGO_PATH`, `REDDIT_LOGO_PATH`, `OPENAI_LOGO_PATH`) — do not re-fetch or
   re-type them. HN Y is `#ff6600`; Snoo, OpenAI knot, and X are `currentColor`.
9. **Escaping:** all preview fields (titles, descriptions, author names) are attacker-influenced
   remote content. Everything renders through `{{ }}` autoescaping. No `|safe` anywhere.

## View changes (`server/apps/blogs/views.py`)

Add module-level helpers (imports: `from urllib.parse import urlsplit`,
`from django.utils.dateformat import format as format_date`):

```python
def _format_preview_date(published_at):
    return format_date(published_at, 'M j, Y') if published_at else ''


def _preview_count(value, unit):
    number = value or 0
    return f'{number} {unit}' if number == 1 else f'{number} {unit}s'


def _link_preview_meta(preview):
    """Muted meta line for a share-page preview card; mirrors LinkPreviewCard.tsx copy."""
    date_str = _format_preview_date(preview.published_at)
    if preview.kind == 'youtube':
        parts = [preview.author_name, 'YouTube', date_str]
    elif preview.kind == 'hackernews':
        if preview.extra.get('is_comment'):
            author = preview.author_name
            parts = [f'Comment by {author}' if author else 'Comment', date_str]
        else:
            parts = [
                _preview_count(preview.extra.get('score'), 'point'),
                _preview_count(preview.extra.get('comments'), 'comment'),
                f'by {preview.author_name}' if preview.author_name else '',
                date_str,
            ]
    elif preview.kind == 'chatgpt':
        parts = ['Shared conversation', date_str]
    elif preview.kind == 'generic':
        hostname = (urlsplit(preview.url).hostname or '').removeprefix('www.')
        parts = [preview.site_name or hostname or preview.url, date_str]
    else:  # twitter and reddit style their pieces in the template
        parts = [date_str] if preview.kind == 'twitter' else []
    return ' · '.join(part for part in parts if part)
```

In `post_detail`, after `media_url` is built:

```python
    link_previews = []
    if post.link_previews_enabled:
        for preview in post.link_previews.all():
            if preview.status != 'ok':
                continue
            image_url = None
            if preview.image:
                image_url = reverse('link-preview-image', args=[preview.id])
                if post.visibility == VISIBILITY_UNLISTED:
                    image_url = f'{image_url}?token={post.share_token}'
            link_previews.append(
                {'preview': preview, 'image_url': image_url, 'meta': _link_preview_meta(preview)}
            )
```

and add `'link_previews': link_previews` to the context dict.

## Template changes (`post_detail.html`)

### Markup — insert after the transcript `{% endif %}`, before `.post-engagement`

```html
  {% if link_previews %}
  <div class="link-previews">
    {% for item in link_previews %}
    {% with preview=item.preview %}
    {% if preview.kind == 'youtube' %}
    <a class="lp-card lp-card-youtube" href="{{ preview.url }}" target="_blank" rel="noopener noreferrer">
      <div class="lp-yt-thumb">
        {% if item.image_url %}<img src="{{ item.image_url }}" alt="" loading="lazy" />{% endif %}
        <span class="lp-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg></span>
      </div>
      <div class="lp-yt-body">
        <div class="lp-title">{{ preview.title }}</div>
        {% if item.meta %}<div class="lp-muted lp-meta">{{ item.meta }}</div>{% endif %}
        {% if preview.description %}<div class="lp-muted lp-desc lp-clamp-2">{{ preview.description }}</div>{% endif %}
      </div>
    </a>
    {% elif preview.kind == 'twitter' %}
    <a class="lp-card" href="{{ preview.url }}" target="_blank" rel="noopener noreferrer">
      <div class="lp-header">
        <svg class="lp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="<X_LOGO_PATH>" /></svg>
        <div class="lp-source">{{ preview.author_name }}</div>
        {% if preview.author_handle %}<div class="lp-muted lp-ellipsis">@{{ preview.author_handle }}</div>{% endif %}
      </div>
      <div class="lp-tweet-text lp-clamp-6">{{ preview.description }}</div>
      {% if item.meta %}<div class="lp-muted lp-meta">{{ item.meta }}</div>{% endif %}
    </a>
    {% elif preview.kind == 'hackernews' %}
    <a class="lp-card" href="{{ preview.url }}" target="_blank" rel="noopener noreferrer">
      <div class="lp-header">
        <svg class="lp-icon lp-icon-hn" viewBox="0 0 24 24" aria-hidden="true"><path d="<HN_LOGO_PATH>" /></svg>
        <div class="lp-source">Hacker News</div>
        {% if preview.extra.domain %}<div class="lp-muted lp-ellipsis">{{ preview.extra.domain }}</div>{% endif %}
      </div>
      {% if preview.title %}<div class="lp-title">{{ preview.title }}</div>{% endif %}
      {% if preview.description %}<div class="lp-muted lp-desc lp-clamp-3">{{ preview.description }}</div>{% endif %}
      {% if item.meta %}<div class="lp-muted lp-meta">{{ item.meta }}</div>{% endif %}
    </a>
    {% elif preview.kind == 'reddit' %}
    <a class="lp-card" href="{{ preview.url }}" target="_blank" rel="noopener noreferrer">
      <div class="lp-header">
        <svg class="lp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="<REDDIT_LOGO_PATH>" /></svg>
        {% if preview.extra.subreddit %}
        <div class="lp-source">r/{{ preview.extra.subreddit }}</div>
        <div class="lp-muted lp-ellipsis">Reddit</div>
        {% else %}
        <div class="lp-source">Reddit</div>
        {% endif %}
      </div>
      <div class="lp-title">{{ preview.title }}</div>
      {% if preview.author_name %}<div class="lp-muted lp-meta">u/{{ preview.author_name }}</div>{% endif %}
    </a>
    {% elif preview.kind == 'chatgpt' %}
    <a class="lp-card" href="{{ preview.url }}" target="_blank" rel="noopener noreferrer">
      <div class="lp-header">
        <svg class="lp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="<OPENAI_LOGO_PATH>" /></svg>
        <div class="lp-source">ChatGPT</div>
      </div>
      <div class="lp-title">{{ preview.title }}</div>
      {% if item.meta %}<div class="lp-muted lp-meta">{{ item.meta }}</div>{% endif %}
    </a>
    {% else %}
    <a class="lp-card lp-card-generic" href="{{ preview.url }}" target="_blank" rel="noopener noreferrer">
      <div class="lp-gen-body">
        {% if item.meta %}<div class="lp-muted lp-ellipsis">{{ item.meta }}</div>{% endif %}
        <div class="lp-title lp-title-generic">{{ preview.title }}</div>
        {% if preview.description %}<div class="lp-muted lp-desc lp-clamp-2">{{ preview.description }}</div>{% endif %}
      </div>
      {% if item.image_url %}
      <div class="lp-gen-thumb"><img src="{{ item.image_url }}" alt="" loading="lazy" /></div>
      {% endif %}
    </a>
    {% endif %}
    {% endwith %}
    {% endfor %}
  </div>
  {% endif %}
```

`<X_LOGO_PATH>` etc. are placeholders — substitute the verbatim path strings from
`LinkPreviewCard.tsx`.

### CSS — append inside the existing `<style>` block, before the responsive `@media` rule

```css
  /* Link preview cards (mirrors app/src/components/post/LinkPreviewCard.tsx) */
  .link-previews {
    margin: 24px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .lp-card {
    display: block;
    border: 1px solid hsl(var(--border));
    border-radius: calc(var(--radius) - 2px);
    padding: 12px;
    color: hsl(var(--foreground));
    text-decoration: none;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .lp-card:hover {
    background-color: hsl(var(--accent) / 0.3);
    border-color: hsl(var(--primary) / 0.2);
  }

  .lp-header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .lp-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    fill: currentColor;
  }

  .lp-icon-hn {
    fill: #ff6600;
  }

  .lp-source {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lp-muted {
    color: hsl(var(--muted-foreground));
    font-size: 13px;
  }

  .lp-ellipsis {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lp-title {
    margin-top: 8px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.375;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .lp-desc {
    margin-top: 4px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .lp-clamp-2 { -webkit-line-clamp: 2; }
  .lp-clamp-3 { -webkit-line-clamp: 3; }
  .lp-clamp-6 { -webkit-line-clamp: 6; }

  .lp-meta {
    margin-top: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lp-tweet-text {
    margin-top: 8px;
    font-size: 14px;
    line-height: 1.625;
    white-space: pre-line;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .lp-card-youtube {
    padding: 0;
    overflow: hidden;
  }

  .lp-yt-thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #000;
  }

  .lp-yt-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 0;
    box-shadow: none;
  }

  .lp-play {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 48px;
    height: 48px;
    border-radius: 9999px;
    background: hsl(var(--primary) / 0.8);
    color: hsl(var(--primary-foreground));
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lp-play svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
  }

  .lp-yt-body {
    padding: 12px;
  }

  .lp-yt-body .lp-title,
  .lp-title-generic {
    margin-top: 0;
  }

  .lp-yt-body .lp-meta,
  .lp-yt-body .lp-desc {
    margin-top: 4px;
  }

  .lp-title-generic {
    margin-top: 2px;
  }

  .lp-card-generic {
    display: flex;
    padding: 0;
    overflow: hidden;
  }

  .lp-gen-body {
    flex: 1;
    min-width: 0;
    padding: 12px;
  }

  .lp-gen-thumb {
    position: relative;
    width: 88px;
    min-height: 88px;
    flex-shrink: 0;
    border-left: 1px solid hsl(var(--border));
  }

  .lp-gen-thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 0;
    box-shadow: none;
  }
```

Note: `.post-media img` styles don't apply here (cards aren't inside `.post-media`), but the
explicit `border-radius: 0; box-shadow: none;` on card images guards against future global img
styles.

## Settings change (`server/config/settings.py`)

In the non-DEBUG `style-src` list, replace
`'sha256-JayKhsDueQH1eSiZMpD2bwcA5rUMPYRclFLcblDmxvU='` with the newly computed hash of the final
template's style block, with a trailing comment `# blogs/post_detail.html`. While there, add
`# shared/base.html` and `# shared/header.html` comments to `GWweo…` and `c2svK…` in the same
group. Do not touch the first (frontend) hash group or `script-src`.

## Tests

### New: `server/apps/blogs/tests/test_csp_hashes.py`

Regression test that every inline `<style>`/`<script>` block in production-rendered Django
templates is hash-allowlisted in the prod CSP config:

- Templates checked: `templates/shared/base.html`, `templates/shared/header.html`,
  `apps/blogs/templates/blogs/post_detail.html`, `apps/website/templates/website/index.html`
  (all relative to `settings.BASE_DIR`). `shared/debug_panel.html` is excluded — it renders only
  when `settings.DEBUG`, where CSP has `unsafe-inline`.
- Extract blocks with `re.findall(r'<style>(.*?)</style>', html, re.S)` (same for `<script>` —
  attribute-less tags only; `<script src=…>` and `<script type="module">` are external/handled
  elsewhere).
- Assert each block contains no `{{` / `{%` (source bytes must equal rendered bytes for
  source-computed hashes to be valid), then assert
  `f"'sha256-{base64.b64encode(hashlib.sha256(block.encode()).digest()).decode()}='"` is present
  in the **prod** directive list. Since tests run with DEBUG-ish settings, don't read
  `settings.CONTENT_SECURITY_POLICY_DIRECTIVES` at runtime — instead parse the hashes out of
  `server/config/settings.py`'s source with a regex for `'sha256-[A-Za-z0-9+/=]+'` and assert
  membership in that set. Simple and immune to settings-mode differences.

This test fails on today's tree (post_detail hash missing) and passes once settings.py is updated
— include it in the same commit.

### Extend `server/apps/blogs/tests/test_link_previews.py` (share-page section)

Use the existing factory helpers in that file for posts/previews (previews can be created directly
via `LinkPreview.objects.create(post=…, url=…, kind=…, status='ok', …)`; no network). Fetch
`/p/<id>/` with the Django test client (HTML path, no JSON Accept header) and assert on
`response.content`:

1. **Each kind renders its card copy** (six tests or one parameterized):
   - youtube: title, `Rick Astley · YouTube · Oct 25, 2009`-style meta, play-badge markup present.
   - twitter: author name, `@handle`, tweet text, date.
   - hackernews story: `57 points · 3 comments · by pg · Oct 9, 2006` (build extra
     `{'score': 57, 'comments': 3, 'domain': 'ycombinator.com'}`), domain in header.
   - hackernews comment: `Comment by sama · Oct 9, 2006` (extra `{'is_comment': True}`).
   - reddit: `r/programming`, `Reddit`, title, `u/ChemicalRascal`.
   - chatgpt: `ChatGPT`, title, `Shared conversation · Dec 22, 2024`.
   - generic: site label · date, title, description.
2. **Singular pluralization**: HN story with score=1, comments=1 → `1 point · 1 comment`.
3. **Gating**: `status='pending'`/`'failed'` previews don't render; `link_previews_enabled=False`
   → no `.link-previews` container.
4. **Unlisted token**: unlisted post + preview with an image → the rendered `img src` contains
   `/api/link-previews/<id>/image/?token=<share_token>` (use the ImageField trick already used in
   this test file for preview images, or `SimpleUploadedFile` with a 1×1 GIF).
5. **Escaping**: preview with `title='<script>alert(1)</script>'` → response contains
   `&lt;script&gt;` and does NOT contain the raw `<script>alert(1)</script>` bytes.
6. **Generic hostname fallback**: `site_name=''`, url `https://www.example.com/a` → meta shows
   `example.com`.

## Gates

- `uv run python server/manage.py test` (expect 187 existing + new, all green)
- `ruff check server/ && ruff format --check server/`
- No frontend changes → no frontend gates beyond confirming no app/ diffs.

## Non-goals

- Click-to-play YouTube iframe on the share page (needs inline JS + another CSP hash; `frame-src`
  already permits it if wanted later).
- Reader-side "show link previews" preference (client-app concept; share-page visitors are
  anonymous).
- Pruning the other possibly-stale CSP hashes in the frontend group (can't be verified from
  source; left as-is).
- Any change to fetchers, models, serializers, or the React app.
