# Test Coverage Analysis

## Current State

The project has **24 backend tests** and **10 frontend unit tests** (plus 4 E2E spec files). Overall coverage is low, with significant gaps in both backend and frontend.

### Backend: 24 tests across 3 files

| App | File | Tests | Status |
|-----|------|-------|--------|
| auth | `apps/auth/tests.py` | 5 | All pass |
| blogs | `apps/blogs/tests/test_models.py` | 11 | 10 pass, 1 error (missing ffmpeg) |
| blogs | `apps/blogs/tests/test_views.py` | 8 | All pass |
| users | `apps/users/tests.py` | 0 | Empty placeholder |
| website | `apps/website/tests.py` | 0 | Empty placeholder |
| uploads | (no test file) | 0 | No tests exist |

### Frontend: 10 unit tests across 3 files, 4 E2E spec files

| File | Tests | Status |
|------|-------|--------|
| `src/__tests__/lib/api/posts.test.ts` | 4 | Failing (`vi.mocked` incompatible with bun test) |
| `src/__tests__/components/Feed.test.tsx` | ~3 | Failing (missing react/jsx-dev-runtime) |
| `src/__tests__/hooks/usePosts.test.tsx` | ~3 | Failing (missing @testing-library/react) |
| `e2e/home.spec.ts` | - | E2E (Playwright, not runnable in unit test context) |
| `e2e/auth.spec.ts` | - | E2E |
| `e2e/navigation.spec.ts` | - | E2E |
| `e2e/ground-rules.spec.ts` | - | E2E |

**Note:** Frontend unit tests currently fail when run with `bun test` due to dependency resolution issues. They appear to be written for Vitest but are being run with bun's test runner.

---

## Gap Analysis

### Backend Gaps

#### 1. Auth App — Login, Logout, Status, CSRF endpoints (HIGH PRIORITY)

**What's missing:** `server/apps/auth/views.py` has 5 view functions but only `signup()` is tested. The `login()`, `logout()`, `status()`, and `csrf()` endpoints have zero test coverage.

**Why it matters:** Authentication is the most security-critical part of the application. Untested login logic could allow bypass of authentication, and untested logout could leave sessions dangling.

**Recommended tests:**
- `login()`: successful login, wrong password, nonexistent user, already-authenticated user, missing fields
- `logout()`: successful logout clears session, logout when not logged in
- `status()`: returns user data when authenticated, returns appropriate response when not authenticated
- `csrf()`: returns a valid CSRF token

#### 2. Blogs App — Media Streaming & Transcription (HIGH PRIORITY)

**What's missing:** `stream_post_media()` and `PostViewSet.transcribe()` in `server/apps/blogs/views.py` are completely untested.

**Why it matters:** Media streaming involves HTTP range request handling, which is tricky to get right and can expose security issues (path traversal, resource exhaustion). Transcription involves external API calls that should be tested with mocks.

**Recommended tests:**
- `stream_post_media()`: valid media request, range request headers, nonexistent post, unauthorized access
- `transcribe()`: successful transcription (mocked OpenAI), missing media, non-audio media, API error handling
- `get_post_media_mime_type()`: correct MIME type detection for various file types
- `post_detail()`: renders post detail page, handles nonexistent posts

#### 3. Uploads App — S3 Integration (HIGH PRIORITY)

**What's missing:** `server/apps/uploads/views.py` has 4 functions with zero tests. This includes presigned URL generation and S3 client initialization.

**Why it matters:** Incorrect presigned URL logic could expose private files or create security vulnerabilities. S3 misconfiguration could cause data loss.

**Recommended tests (using mocked boto3):**
- `get_presigned_url()`: generates valid URL for authenticated user, rejects unauthenticated requests
- `get_presigned_url_for_post()`: generates URL for post media, handles nonexistent posts
- `get_s3_client()`: correct configuration from environment variables

#### 4. Blogs Serializers (MEDIUM PRIORITY)

**What's missing:** `PostSerializer`, `PostCreateSerializer`, `MediaSerializer`, and `UserNameSerializer` in `server/apps/blogs/serializers.py` have no direct tests.

**Why it matters:** Serializers define the API contract. Untested serializers could silently expose sensitive fields or break the API response format.

**Recommended tests:**
- Verify serialized output matches expected format
- Verify read-only fields are enforced
- Verify nested serializer relationships (user in post, media in post)

#### 5. Blog Utility Functions (MEDIUM PRIORITY)

**What's missing:** `convert_to_mp3()` and `get_file_mime_type()` in `server/apps/blogs/utils/` are untested.

**Recommended tests:**
- `get_file_mime_type()`: various file types return correct MIME types
- `convert_to_mp3()`: test with mocked subprocess/ffmpeg calls

#### 6. Website App — Frontend Serving Views (LOW PRIORITY)

**What's missing:** `index()` and `local_dev_response_from_file_in_app_public_dir()` in `server/apps/website/views.py` are untested.

**Why it matters:** Less critical since these are simple template/file-serving views, but the dev file server could have path traversal issues.

**Recommended tests:**
- `index()`: returns 200 with correct template
- Dev file server: correct file serving, handles missing files, rejects path traversal attempts

---

### Frontend Gaps

#### 1. Fix Test Infrastructure (CRITICAL — PREREQUISITE)

**What's broken:** Unit tests use Vitest APIs (`vi.mocked`) but `bun test` does not provide Vitest globals. Tests also fail to resolve `react/jsx-dev-runtime` and `@testing-library/react`.

**Recommended fix:**
- Run tests with `bunx vitest` or `npx vitest` instead of `bun test`, since the project already has Vitest configured in `vitest.config.ts`
- Alternatively, update `package.json` test scripts to use vitest directly

#### 2. Auth Hooks & Components (HIGH PRIORITY)

**What's missing:** `useAuth` hook and `LoginModal`/`SignupModal` components have no unit tests.

**Why it matters:** Auth state management is critical. Bugs here could leave users stuck in logged-out states or expose authenticated features to unauthenticated users.

**Recommended tests:**
- `useAuth`: login/logout state transitions, session persistence, error handling
- `LoginModal`: form validation, submission, error display
- `SignupModal`: form validation, password matching, submission

#### 3. Post Components (HIGH PRIORITY)

**What's missing:** `Post.tsx`, `CreatePost.tsx`, and related components (`PostActions`, `PostContent`, `PostMedia`, etc.) have no unit tests.

**Why it matters:** These are the core UI components. Rendering bugs or broken interactions would directly impact the user experience.

**Recommended tests:**
- `Post`: renders text content, renders media, displays user info, handles actions
- `CreatePost`: form submission, media upload flow, character limits, error handling
- `PostMedia`: audio player rendering, image display, video display

#### 4. API Client Functions (HIGH PRIORITY)

**What's missing:** Only `getPosts` and `createPost` have (broken) tests. `deletePost`, `updatePost`, `transcribePost`, `getMediaUrl`, and all auth API functions are untested.

**Why it matters:** These functions handle all server communication. Bugs here silently corrupt data or fail operations.

**Recommended tests:**
- `deletePost()`: successful deletion, error handling
- `updatePost()`: successful update, validation errors
- `transcribePost()`: successful transcription, error handling
- `getMediaUrl()`: URL generation, signed URL caching
- Auth API (`signup`, `logout`): successful flows, error handling

#### 5. Utility Functions (MEDIUM PRIORITY)

**What's missing:** All utilities in `app/src/lib/` are untested: `fetch.ts` (CSRF), `audio.ts`, `file.ts`, `tags.ts`, `settings.ts`, `media.ts`.

**Why it matters:** These are pure functions that are easy to test and form the foundation for other features.

**Recommended tests:**
- `fetch.ts`: CSRF token fetching and caching
- `tags.ts`: hashtag parsing from post content
- `audio.ts`: audio conversion utilities
- `file.ts`: file type detection, size formatting

#### 6. Filter & Tag Hooks (MEDIUM PRIORITY)

**What's missing:** `usePostFilters` and `useTags` hooks have no tests.

**Recommended tests:**
- `usePostFilters`: add/remove/toggle filters, filter state management
- `useTags`: tag fetching, caching behavior

---

## Priority Summary

### Must-fix first
| # | Area | Effort | Impact |
|---|------|--------|--------|
| 1 | Fix frontend test infrastructure (vitest vs bun) | Low | Unblocks all frontend testing |

### High priority
| # | Area | Effort | Impact |
|---|------|--------|--------|
| 2 | Auth login/logout/status/csrf endpoints (backend) | Low | Security-critical |
| 3 | Media streaming & transcription views (backend) | Medium | Core feature, security |
| 4 | S3/uploads integration (backend, mocked) | Medium | Data integrity, security |
| 5 | Auth hooks & components (frontend) | Medium | Security-critical UX |
| 6 | Post components (frontend) | Medium | Core feature UX |
| 7 | API client functions (frontend) | Low | Data integrity |

### Medium priority
| # | Area | Effort | Impact |
|---|------|--------|--------|
| 8 | Blog serializers (backend) | Low | API contract |
| 9 | Blog utilities (backend) | Low | Correctness |
| 10 | Frontend utility functions | Low | Foundation code |
| 11 | Filter & tag hooks (frontend) | Low | Feature correctness |

### Low priority
| # | Area | Effort | Impact |
|---|------|--------|--------|
| 12 | Website app views (backend) | Low | Dev/deploy correctness |
| 13 | Admin customizations (backend) | Low | Admin UX |
