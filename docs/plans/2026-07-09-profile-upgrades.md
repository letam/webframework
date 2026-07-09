# Profile upgrades — implementation spec

Status: implemented 2026-07-09 (P2 of docs/feature-backlog.md).

Three pieces: pinned posts, weekly/monthly time-bucketed views of a profile, and avatar
upload. Depends on the privacy phase (visible_to / drafts already exist).

## 1. Pinned posts

### Backend

- `Post.pinned_at = models.DateTimeField(null=True, blank=True)` (migration). Pinned =
  non-null. Max **3** pinned posts per author (400 with
  `{'error': 'You can pin up to 3 posts'}` beyond). Only published posts can be pinned
  (400 for drafts).
- `POST /api/posts/<id>/pin/` + `DELETE` on the same action (methods
  `['post', 'delete']`, like the `like` action). Author or superuser (same 401/403
  pattern as update). POST sets `pinned_at=now` (idempotent re-pin refreshes the
  timestamp), DELETE clears it. Returns the full `PostSerializer` payload.
- `?pinned=true` query param on the list endpoint: composes with `?author=` and
  `visible_to`, returns only pinned posts ordered `-pinned_at` (cursor pagination is
  fine — never more than 3 rows).
- `PostSerializer` += `pinned_at` (read-only).

### Frontend

- `Post` type += `pinned_at?: string | null`.
- API: `pinPost(id)` / `unpinPost(id)`; scope += `pinned?: boolean`.
- `PostMenu` (author, published posts only): "Pin to profile" / "Unpin from profile"
  (lucide `Pin` / `PinOff`). Cap error surfaces as a toast with the server message.
- Profile Posts tab: fetch `usePostHandlers({ author: userId, pinned: true })` and
  render those cards first under a muted "Pinned" micro-header (`Pin` icon +
  `text-xs uppercase tracking-wide text-muted-foreground`), then the regular list
  **excluding the pinned ids** (client-side dedupe). Pinned cards show a small muted
  `Pin` glyph next to the timestamp (PostHeader, same slot idiom as the visibility
  glyph).
- Cache updates: pin/unpin mutations update the post across caches and invalidate the
  pinned-scope query.

## 2. Weeklies / monthlies

Client-side grouping of the profile Posts tab — no backend.

- A compact segmented control at the top of the Posts tab (same pill idiom as the
  match-mode toggle in FilterControls): **All · Weeks · Months**. Default All.
- Weeks: group loaded posts by ISO-ish week (date-fns `startOfWeek`, weekStartsOn 1);
  header "Week of Jul 6, 2026" + muted count. Months: date-fns `format(date,
  'MMMM yyyy')` headers. Headers: `text-sm font-medium text-muted-foreground`, sticky
  not required. Groups build incrementally as infinite scroll loads more pages (the
  sentinel stays at the bottom).
- Pinned section renders only in the All view.
- Extract the grouping into a pure helper (`src/utils/postGroups.ts`) returning
  `{ label, posts }[]` — unit-test that, not the component.

## 3. Avatar upload

### Backend

- `User.avatar = models.ImageField(upload_to='avatars/', blank=True)` (users app
  migration).
- New `server/apps/users/views.py` + urls: `PUT/POST /api/users/me/avatar/` (multipart
  field `avatar`) and `DELETE` to remove. Authenticated only (401). Validation:
  ≤ 5 MB, must pass `is_valid_image` (reuse from blogs.utils). Processing with Pillow:
  EXIF-transpose, center-crop to square, resize to 512×512 LANCZOS, save as JPEG
  quality 85 (RGB; flatten alpha onto white). Replacing an avatar deletes the old
  stored file (storage.delete, exceptions logged). Response: `{'avatar': <url>}`.
- Serving: expose the URL via `storage.url()` (works for local MEDIA_URL and
  S3Boto3Storage presigned URLs alike).
- `UserNameSerializer` += `avatar` (SerializerMethodField → URL or null) so every post
  author payload carries it. `auth/status` response += `avatar` for the current user.

### Frontend

- `Author` type: `avatar` becomes `string | null` (drop the TODO comment).
- Avatar rendering: wherever `AvatarFallback` with `identityGradient` is used
  (PostHeader, Profile header, AuthorHoverCard, Navbar, comments), add `AvatarImage
  src` when the author has one; the gradient fallback stays for null/load-failure.
- Upload UI on the Profile header avatar: hover/focus overlay (semi-opaque scrim +
  `Camera` icon, rounded-full, only on own profile) opens a file picker; uploading
  shows a spinner overlay; success toast "Profile photo updated." A small "Remove
  photo" item appears in a dropdown when an avatar exists (confirm not needed —
  reversible by re-upload). After upload, refresh auth status/profile queries so the
  new URL propagates; posts' cached author avatars may lag until refetch — acceptable.
- `useAuth` exposes `avatar` from the status payload.

## Tests

Backend: pin/unpin permissions + cap + drafts rejection + ordering + `?pinned=true`
scoping with visibility; avatar upload happy path (dimensions 512², JPEG), oversize →
400, non-image → 400, unauthenticated → 401, replacement deletes old file (mock
storage), DELETE clears; serializers expose avatar + pinned_at.

Frontend: postGroups helper (week/month bucketing, empty input), pinned dedupe logic in
the Posts tab, PostMenu pin items visibility, avatar overlay renders only on own
profile (it always is, currently), upload flow mock.
