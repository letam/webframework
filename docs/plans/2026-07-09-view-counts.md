# View counts — implementation spec

Status: implemented 2026-07-09 (P2 of docs/feature-backlog.md).

Per-post unique view counts, recorded server-side when a post is actually seen (feed
card dwell or detail page), deduplicated per viewer. Richer reactions are deliberately
**not** built: the notes never specified them and the action row stays uncluttered.

Depends on the privacy phase (docs/plans/2026-07-09-privacy-and-drafts.md): views are
recorded and shown only for posts visible to the viewer; drafts never accrue views.

## Semantics

- A "view" = one unique viewer per post, forever (not per-session repeats). Viewer
  identity: authenticated user id, or the anonymous session (hashed).
- The author's own views of their post do not count (server- and client-enforced).
- View counts are public on every published post (like like_count).

## Backend

### Model (`server/apps/blogs/models.py`)

```python
class PostView(models.Model):
    created = models.DateTimeField(auto_now_add=True)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='views')
    viewer_key = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['post', 'viewer_key'], name='unique_post_viewer'),
        ]
```

- `viewer_key`: `f'u:{user.id}'` for authenticated users; for anonymous,
  `f's:{sha256(f"{settings.SECRET_KEY}:{session_key}").hexdigest()[:40]}'`.
  **Never store the raw session key** — it is an authentication credential.
- No `user` FK: the key is enough, and rows should survive user deletion semantics
  independently (counts are content stats, not user data).

### Endpoint

`POST /api/posts/views/` (DRF list-route action on PostViewSet, `url_path='views'`):

- Body: JSON `{"post_ids": [1, 2, ...]}`, max 50 ids per call (400 above, 400 for
  malformed/non-int ids).
- Anonymous callers: create the session if it has no key yet (`request.session.save()`)
  so the viewer key is stable for the browser session.
- Server filters the ids to posts that are published and `visible_to(request.user)`,
  excludes posts authored by the requester, then `bulk_create` `PostView` rows with
  `ignore_conflicts=True` (the unique constraint is the dedupe).
- Returns 204. Throttled via a `ScopedRateThrottle` scope `views` (covers anon + auth),
  rate `120/min`, added to `DEFAULT_THROTTLE_RATES`.

### Read path

- `get_queryset()` annotates `view_count=_related_count(PostView)` alongside
  like/comment counts.
- `PostSerializer` gains `view_count` (SerializerMethodField with the same
  annotation-or-query fallback pattern as `like_count`).
- `post_detail` (`/p/<id>/`): pass `view_count` to the template; render it with the
  like/comment counts on the share page. Rendering the detail page (HTML branch) also
  records a view for non-author viewers, same dedupe.

## Frontend

- `Post` type += `view_count: number`.
- `src/lib/api/posts.ts`: `recordPostViews(ids: number[])` — `fetch` with
  `keepalive: true` and the usual CSRF options; fire-and-forget (errors logged, never
  toasted).
- New `src/lib/viewTracking.ts`, a module-level singleton batcher:
  - `markPostViewed(id)`: adds to a pending Set unless already reported this page
    lifetime; flushes the batch after 4s of quiet or immediately on
    `visibilitychange → hidden` (keepalive request survives navigation).
  - Keeps a `reported` Set so each post beacons at most once per page load; the server
    dedupes across loads.
- Post card (`Post.tsx`): an `IntersectionObserver` effect — when the card is ≥50%
  visible for 1 continuous second, call `markPostViewed(post.id)`. Skip when the post
  is a draft or authored by the current user (`useAuth().userId`). Disconnect on
  unmount.
- Display: in `PostActions`, right side of the action row, a non-interactive muted
  counter — `Eye` icon (`h-4 w-4`) + count — shown only when `view_count > 0`.
  Tooltip: "N views". It must read as a stat, not a button: no hover background, no
  cursor-pointer. Hidden entirely on drafts.
- No optimistic updates: your own views never count, so the number only moves on
  refetch.

## Tests

Backend (`server/apps/blogs/tests/test_views_counts.py`): dedupe per viewer (same user
twice → 1), separate viewers accumulate, author's own view ignored, anonymous session
viewer counted once across calls, invisible ids silently skipped (private/unlisted
without access, drafts), max-50 and malformed payload → 400, annotation returned in
feed + detail serialization, detail HTML page records a view for a non-author.

Frontend: viewTracking batcher (dedupe, flush timing with fake timers), PostActions
renders count when > 0 and hides at 0/drafts, observer effect marks after dwell
(mock IntersectionObserver).
