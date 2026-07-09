# Echo Sphere Design System

A lightweight system for keeping the product coherent as it grows. It exists to answer
"how should this look/move/read?" without re-deciding each time.

## Brand concept: the echo

The product is named for sound rippling outward, and the visual identity leans on one
motif — **concentric rings radiating from a source** — used sparingly:

- **Mark**: `EchoMark` (`app/src/components/EchoMark.tsx`) — a dot with two rings fading
  outward, stroked with the brand gradient. Same art as `app/public/echo.svg` (favicon)
  and the `echo-*.png` app icons.
- **Like ripple**: liking a post emits one expanding ring (`animate-echo-ring`).
- **Recorder meter**: the audio recorder's live level ring pulses outward from the mic.
- **Empty states**: a muted `EchoMark` anchors "nothing here yet" moments.

If a new surface needs decoration, reach for the ring motif before inventing a new one —
and if a ring doesn't fit, prefer no decoration.

## Color

Tokens live in `app/src/index.css` as HSL triplets consumed via `hsl(var(--token))`.
Always style with semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`),
never raw palette classes (`gray-100`, `blue-500`) — raw palette colors are the #1 cause
of dark-mode bugs here.

| Token | Role |
| --- | --- |
| `--primary` / `--ring` | Iris violet (256°). Actions, focus, selection. |
| `--brand-1` → `--brand-2` | Violet → sky gradient. Wordmark, share-page CTA, brand moments only — never for ordinary buttons. |
| `--background` / `--card` | Violet-tinted near-white / pure white (light); deep violet-navy / one visible step lighter (dark). Cards must be distinguishable from the page in both themes. |
| `--muted`, `--accent`, `--secondary` | Quiet surfaces. `accent` is the ghost-button hover wash. |
| `--destructive` | Errors and irreversible actions only. |

**Exception — expressive icon colors:** the composer media icons (mic red, video blue,
image emerald, upload violet) and the action-row hovers (like rose, comment sky) use raw
palette colors deliberately, always with a `dark:` variant or a shade that works in both
themes. Content-type color-coding is allowed; UI chrome color-coding is not.

**Identity hues:** every user gets a stable hue from `identityHue(username)`
(`app/src/lib/utils/identity.ts`), used for avatar fallbacks and profile banners via
`identityGradient`. Never hardcode avatar/banner colors.

## Typography

System font stack. Scale (already applied in `Post.tsx` / `PostHeader.tsx`):

- Post title: `text-[17px] font-semibold tracking-tight leading-snug`
- Post body: `text-[15px] leading-relaxed`
- Author name: `text-[15px] font-semibold`
- Meta (username, timestamps): `text-[13px] text-muted-foreground`
- Transcripts / quoted matter: `text-sm text-muted-foreground` behind a `border-l-2` rule

Timestamps use `formatShortTime` (`app/src/lib/utils/time.ts`): "just now", "5m", "3h",
"2d", then "Jul 9". Full dates belong in tooltips, not inline.

## Spacing, radius, elevation

- Radius: `--radius: 0.75rem`; cards `rounded-lg`, pills/inputs in the filter row and
  composer toolbar are `rounded-full`.
- Cards: `bg-card rounded-lg shadow-xs border`, `px-4 py-3`. Hover:
  `hover:border-primary/20 hover:shadow-sm` with a 200ms transition. No heavier shadows.
- The feed column is `max-w-lg`; don't widen individual cards.

## Motion

Defined in `index.css`, all disabled under `prefers-reduced-motion`:

- `animate-rise-in` — 300ms fade + 6px rise, `cubic-bezier(0.22,1,0.36,1)`. For content
  appearing: posts, comment sections, filter chips, empty states.
- `animate-heart-pop` + `animate-echo-ring` — the like moment (pop + one ripple).
- Button presses: `motion-safe:active:scale-[0.98]` lives in the Button base.
- Durations: 150–200ms for state changes, 300ms for entrances, ~500ms for one-off
  flourishes. Nothing loops except loading spinners.

**tailwind-merge caveat:** passing any `transition-*` utility via `className` REPLACES
the Button base's `transition-[color,background-color,border-color,box-shadow,transform]`
list and silently kills the press animation. Don't pass `transition-colors` to `Button`.

## Voice & copy

- Sentence case everywhere; no exclamation marks in chrome (toasts may keep one).
- Quietly warm, never corporate: "It's quiet in here", "Be the first to say something".
- Errors say what happened and what to do: "Sign-in failed — the server responded with
  an error (403). Please try again."
- Counts read "3 of 12 posts", not "Showing 3 posts (filtered)".

## Component rules

- **Composer** rests as one quiet line; it expands on focus or content. The Post button
  is disabled until there's something to post — a saturated primary button must never lie
  about being actionable.
- **Action rows** are icon + count, no labels; meaning goes in tooltips and `aria-label`s.
  Like = rose, comment = sky on hover/active; everything else stays primary.
- **Hashtags** render via `FormatText` as `.hashtag` chips; clickable (adds a feed filter)
  wherever a filter context exists, plain colored text elsewhere.
- **Touch-safe reveals**: anything hidden until hover must use the
  `md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100`
  pattern so touch and keyboard users aren't locked out.
- **Icons** are lucide, rendered at 16px inside `Button` (`[&_svg]:size-4` in the base
  out-specifies `h-5 w-5` on children — known quirk, don't fight it).
