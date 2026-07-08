# Review-and-patch round (2026-07-07 ~01:00, commit `74afc87`)

Tam asked: "can you review the code that was made in the past couple of hours and make any adjustments patches as needed?" Scope: all four unpushed commits (`71cd9a2..HEAD`, 57 files, +3301/−818). Fan-out: three opus-4.8 specialist agents (general correctness ~131k tokens, silent-failure-hunter, pr-test-analyzer) + detached gpt-5.5 `codex review --base origin/main` (~25 min) + fable-5's own pass. Every finding was verified against the code before patching. 18 files, +631/−61; tests 79/16 → 95/24. Part of [project overview](2026-07-project-overview.md).

## Bugs that would have bitten users in production

1. **S3 media couldn't render at all** (codex): the frontend derives MIME/extension from `media.file || media.s3_file_key`, but `MediaSerializer` never sent `s3_file_key` — S3-backed posts had neither. Exposed the field.
2. **S3 images were CSP-blocked in prod** (codex): the R2 endpoint was in `media-src`/`connect-src` but not `img-src`; signed image URLs would render broken. Added.
3. **A broken ffprobe deleted user uploads** (silent-failure P1): an *environmental* probe failure (binary missing) was indistinguishable from an invalid file → the user's R2 object was deleted and their file blamed. Split into `probe_media_duration` raising `MediaProbeError` for infra failures (→ 500, object kept) vs None only when ffprobe genuinely rejected the bytes.
4. **Share copied the literal string "undefined"** (found by fable-5, independently confirmed by the correctness reviewer): only `getPosts` ran `revivePost` (which sets `post.url`); create/edit/transcribe responses never did, and their results overwrite the caches. All mutation responses now go through `revivePost`.
5. **Profile header stats wrong past 20 posts** (correctness reviewer): totals were reduced over loaded pages only. Added `GET /api/posts/stats/?author=` server aggregate feeding the header (loaded-pages fallback kept).

## Hardening on top

- Subquery count annotations (`Coalesce(Subquery(...Count('pk')...), 0)`) replaced joined `Count(distinct=True)` — the join version produced an L×C row fan-out per post (correct but expensive, and one refactor away from silently inflated counts); guarded by a test with likes *and* comments on one post. `.order_by()` needed to clear Comment's default ordering.
- Conditional DB unique constraint on non-empty `s3_file_key` (migration 0016) — closes the create-time `exists()` TOCTOU race where two posts sharing a key would delete each other's R2 object.
- Range handler rewritten on werkzeug's `range_for_length()` (semantics verified empirically): proper 206s for bounded/suffix/open-ended ranges, 416 + `bytes */N` when unsatisfiable; the mysterious legacy `== 2` special-case removed. Backed by a 5-test class asserting exact bytes and headers.
- `?author=<garbage>` → 400 (was silently serving the whole feed as "that author's posts"); `/p/<id>/` JSON path fixed (DRF `Response` from a plain view = guaranteed 500 → `JsonResponse`); leftover `print()` removed; signed-URL failures now logged; presign/PUT responses checked with `.ok`; failed likes now toast; tags cache no longer wiped to `[]` when mutating from Profile before Feed ever loaded.

## Deliberately deferred

A few low-severity edge cases were confirmed but deliberately deferred rather than patched in this round; they're tracked internally (see the trade-offs note in the [project overview](2026-07-project-overview.md)).

## Verification

95 backend / 24 frontend green, tsc + biome + `bun run build` clean, migration 0016 applied to the dev DB, and the complete diff read end-to-end as a final judge pass before committing.
