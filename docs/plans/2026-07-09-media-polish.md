# Media polish — implementation spec

Status: implemented 2026-07-09 (P2 of docs/feature-backlog.md).

Three pieces sharing one background-processing pipeline: video thumbnails, audio
waveforms, and compressed image renditions. The recording-side items from the backlog
(30/60s shorts cap, iPhone re-encode, cross-browser volume normalization) are
**deferred** — they need device testing that can't be done here.

## Shared pipeline

New `process_post_media(media_id)` django-task (same framework as
`transcribe_post_media`; immediate backend in dev/tests, db_worker in prod):

- video → capture a poster frame into `Media.thumbnail`.
- audio → compute waveform peaks into a new `Media.waveform` JSONField.
- image → generate a compressed rendition into `Media.thumbnail`.

Enqueue it in `PostViewSet.create` right after the post+media commit (both the direct
and the S3 branches — use `transaction.on_commit`). Failures log and leave the fields
empty; the UI degrades to today's behavior. The task uses `media.local_copy()` so both
storage backends work.

## 1. Video thumbnails

- Generation: `ffmpeg -ss 0.5 -i <in> -frames:v 1 -vf "scale='min(1280,iw)':-2" -q:v 3
  <out>.jpg` (fall back to `-ss 0` if the first attempt produces nothing, e.g. clips
  shorter than 0.5s). Save via the ImageField so storage handles local vs R2.
- Serving: `MediaSerializer` already includes `thumbnail`; make it a
  `SerializerMethodField` returning `storage.url()` (presigned for R2, MEDIA_URL
  locally) or null — the raw field value is a storage-relative name the frontend can't
  use under S3.
- Frontend: `<video>` in MediaPlayer gets `poster={post.media.thumbnail}` when present,
  and `preload="none"` when a poster exists (feed no longer pulls video bytes for
  paint).
- Custom poster ("replace with an image I choose"): `EditPostModal` gains, for video
  posts, a "Poster image" file row (choose file → PATCH as multipart field
  `thumbnail`). Backend `update()` accepts an uploaded `thumbnail` for the post's
  media: validate with `is_valid_image`, ≤ 5 MB, process like a generated poster
  (max 1280 wide), delete the previously stored thumbnail file.

## 2. Audio waveform player

### Backend

- `Media.waveform = models.JSONField(null=True, blank=True)` (migration): a list of
  ~120 integers 0–100 (per-bucket peak amplitude, normalized to the loudest bucket).
- Generation: decode to mono 8kHz 16-bit PCM via
  `ffmpeg -i <in> -ac 1 -ar 8000 -f s16le -` (subprocess, capture stdout), read as
  int16, split into 120 equal buckets, take `max(abs)` per bucket, normalize to 0–100.
  Silence/failure → leave null.
- `MediaSerializer` += `waveform`.

### Frontend

- `Media` type += `waveform?: number[] | null`.
- MediaPlayer audio: when `waveform` is present, render a SoundCloud-style bar strip as
  the seek control (replacing the plain progress bar for that case): ~120 1.5px-rounded
  bars, height scaled by peak, gap-px, in a `h-12` row. Played portion uses the brand
  gradient/primary color; the rest `bg-muted-foreground/30`. Click or drag on the strip
  seeks proportionally (pointer events on the container, not per-bar). Keyboard: the
  existing seek buttons/arrow-key handling keeps working unchanged. Respect
  `prefers-reduced-motion` for any transition on the played edge.
- Lazy audio load: with a waveform present, do not mount the `<audio>` `src` (or set
  `preload="none"`) until the first play interaction — duration comes from
  `media.duration`, the shape from the waveform. Current-time display keeps using the
  audio element once playing.

## 3. Photo optimization

- Rendition: for images, generate into `Media.thumbnail` with Pillow: EXIF-transpose,
  resize longest edge to ≤ 1600 (never upscale), JPEG quality 80 (flatten alpha onto
  white). Skip generation when the original is already ≤ 1600px AND ≤ 300 KB (the
  original is small enough to serve directly).
- Frontend: feed `<img>` uses the rendition (`thumbnail`) when present, else the
  original. Clicking the image opens a Dialog (shadcn, `max-w-4xl`, media-only, dark
  scrim) showing the rendition large with a ghost "View original" button
  (opens `getMediaUrl(post)` in a new tab) and the alt text as caption when present.
  Keep the existing alt attribute behavior.

## Tests

Backend (follow test_media_pipeline.py's fixture/mocking patterns; mock subprocess
where real ffmpeg output isn't needed): task routes by media_type; video gets a
thumbnail (real ffmpeg on a tiny fixture, as existing duration tests do); waveform has
≤ 120 buckets, values 0–100, null on decode failure; image rendition capped at 1600
and skipped for small originals; PATCH custom poster (validation, old-file cleanup,
permissions); serializer returns thumbnail as a URL and includes waveform; create
enqueues the task exactly once for media posts and never for text posts.

Frontend: waveform seek math (click position → seek fraction), lazy-load (no audio
request before play — assert no `src` prerender), poster/preload attributes, image
dialog open + "View original" href.
