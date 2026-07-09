# Search & filter power tools — implementation spec

Status: implemented 2026-07-09 (P2 of docs/feature-backlog.md).

Extends the existing client-side filter system (usePostFilters over loaded posts) with
search operators, saved/recent filter sets, an operator hint, and a data-export button.
No backend changes except none — everything here operates on the already-fetched feed,
matching how filtering works today.

## 1. Search operators (`src/hooks/usePostFilters.ts` + `src/utils/`)

New token grammar, parsed by a `parseFilterToken(token)` helper (new file
`src/utils/filterQuery.ts`, unit-tested exhaustively):

| form | meaning |
|---|---|
| `word` | substring match across head/body/transcript/alt_text (today's behavior) |
| `#tag` | tag filter (today's behavior; matches the same fields) |
| `"a phrase"` | exact substring match including spaces |
| `author:name` | case-insensitive match on `post.author.username` |
| `-token` | exclusion — post must NOT match; composes with every form above (`-#tag`, `-author:x`, `-"a phrase"`) |

Parsed shape: `{ negated: boolean, kind: 'text' | 'tag' | 'author', value: string,
raw: string }`.

- **Tokenizer**: `sanitizeTokens` currently splits on whitespace; replace with a
  quote-aware tokenizer (`splitFilterInput`) that keeps `"quoted strings"` (and
  `-"quoted"`) as single tokens, strips empty tokens, dedupes case-insensitively by raw
  form. Unbalanced quotes: treat the trailing fragment as a plain token.
- **Matching semantics**: match mode (All/Any) applies to the **positive** filters
  only. Exclusions are always conjunctive — any matching exclusion drops the post,
  regardless of mode. A filter set with only exclusions shows all posts except matches.
- Chips (`ActiveFiltersList`) render the raw token (`-author:maya`, `"deep work"`), so
  users see exactly what's applied; no chip redesign needed.
- `tagFilters`/`applyTagFilters` (the #Tags popover sync) operate on **positive** tag
  filters only; negative tags are ordinary filters the popover ignores.

## 2. Operator hint

A one-line muted hint below the search input, visible only while the input is focused
(and not while `filters.length > 0` already shows the match-mode row — stack them if
both apply, hint first):

```
Filter tricks: "exact phrase" · author:name · -exclude · #tag
```

Style: `text-xs text-muted-foreground`, `animate-rise-in` like the match-mode row.
Focus tracking via the input's onFocus/onBlur (delay hiding ~150ms so a click inside
the hint doesn't flash).

## 3. Saved + recent filter sets (`src/lib/utils/filterSets.ts`, localStorage)

- Storage key `app-filter-sets`: `{ saved: NamedFilterSet[], recent: FilterSetSnapshot[] }`
  where a snapshot is `{ tokens: string[], matchMode: MatchMode }` and a named set adds
  `name` and `createdAt`.
- **Recent**: whenever the active filter set changes to a non-empty set, push a
  snapshot (dedupe by token-set equality, most recent first, cap 5). Never store empty
  sets.
- **Saved**: user-named, cap 20.
- UI: a `Bookmark` icon button (ghost, `h-9 w-9`, rounded-full) between the search pill
  and the #Tags button, opening a Popover (same idiom as TagFilterPopover):
  - "Saved" section: each row = name (click applies: replaces filters + matchMode) +
    a small `X` to delete. Empty state: "No saved filters yet."
  - "Recent" section: rows show the tokens joined by spaces (truncate with ellipsis),
    click applies.
  - When filters are active: a "Save current filters" row at the top with an inline
    name input + Save button.
- Applying a set REPLACES current filters (all enabled) — not merges.

## 4. Export my data (Settings page)

A "Data" section on `src/components/settings/SettingsPage.tsx` with an "Export my
posts" button (authenticated users only; hidden otherwise):

- Pages through the user's posts via the existing API (`getPosts({ author: userId })`
  following `next` cursors, plus `getPosts({ drafts: true })`), assembles
  `{ exported_at, username, posts: [...] }` with the raw API payloads (media metadata
  included; media files themselves are NOT downloaded — the export notes their URLs),
  and downloads it as `echosphere-export-<username>-<yyyy-MM-dd>.json` via a Blob link.
- Button shows a spinner + "Exporting…" while paging; toast on failure. Include a muted
  caption: "JSON of all your posts and drafts. Media files are linked, not included."

## Tests

- `filterQuery` unit tests: tokenizer (quotes, negation, unbalanced quote, dedupe),
  parser (all forms), matcher semantics (AND/OR positives, exclusions always AND,
  author case-insensitivity, phrase with spaces, `-#tag`).
- usePostFilters integration: filtering posts with mixed operators; popover tag sync
  ignores negative tags.
- filterSets: save/apply/delete, recent dedupe + cap, empty-set never recorded.
- Settings export: pages through cursors, produces one JSON blob (mock fetch + verify
  anchor download triggered), hidden when anonymous.
