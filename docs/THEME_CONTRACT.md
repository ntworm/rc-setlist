# RC Setlist — Visual Design Contract

Replaces the previous version of this file, which prescribed a "premium Dark
Glassmorphism design system" and a palette (`#ff7700`, `#00d2ff`, `#00e676`,
`#0d0f12`) that existed in no shipped stylesheet. It was the first file any
retheming agent would read, and it pointed the wrong way.

Revised 2026-09-07, from measurement rather than taste.

---

## 1. The idea

**RC Setlist is an illuminated operator sheet: a monochrome instrument panel
where structure comes from rules, position and block inversion, and colour only
exists when it carries information.**

It is not an app. No cards, no diffuse shadows, no rounded corners, no
confirmation dialogs.

The corollary settles every ambiguous case: **black ground, expensive ink.**
Every lit pixel costs the player dark adaptation — rods take 20 to 40 minutes to
recover from a bright field — so the interface pays per lit pixel and each one
has to justify itself.

---

## 2. Contrast is measured in APCA Lc, not WCAG ratios

WCAG 2.x remains the legal floor. It is not the design guide, for three
structural reasons:

- It is symmetric in polarity, but human vision is not. Swapping text and
  background yields the same number and a different experience.
- It ignores size and weight, although spatial frequency is a primary driver of
  perceived contrast.
- It overstates contrast near black, to the point where 4.5:1 can be
  functionally unreadable when one colour is near black.

Budget, from the APCA tables:

| Use                                   | Target                    |
| ------------------------------------- | ------------------------- |
| Body text                             | Lc 90                     |
| Blocks of text                        | Lc 75 minimum             |
| Non-body content text                 | Lc 60 minimum             |
| Headings, large text, fine pictograms | Lc 45 minimum             |
| Placeholder, disabled, solid icons    | Lc 30 absolute floor      |
| Below Lc 15                           | Invisible. Dividers only. |

Lc 90 is the target, not the floor. The previous `#f7f7f8` on `#08090b`
measured Lc −102.5 against a theoretical maximum of −107.9: past the top, in
halation, not in legibility.

---

## 3. Tokens

Canonical source: `static/shared/ui-system.css`. Nothing outside that file
should define a colour, a radius, a type size or a spacing step. Known
leftovers from before the retheme, still literal on 2026-09-13: the
blue-tinted grounds and surfaces in `static/setlist/setlist.css` (`#08090b`,
`#101115`, `#15161a`, `#17181d`, `#1b1c21`, `#0d0e11`) and
`static/performance/performance.css` (`#08090b`), the status inks `#82eab0`,
`#8ceeb8`, `#a7c7ff`, `#ff929c`, `#f4cf70`, `#ffd4a1` in both, and `#252529`,
`#121214` plus the QR colours in `static/panel/index.html`. Retire them by
mapping to tokens, not by adding new literals.

### Ground and ink

`--ui-bg #0e0e0e` · `--ui-surface #141414` · `--ui-surface-raised #1a1a1a` ·
`--ui-surface-soft #222222`

`--ui-text #f2f2f2` · `--ui-text-display #e4e4e4` · `--ui-text-2 #a0a0a0` ·
`--ui-text-3 #636363`

`--ui-text-display` exists because halation scales with lit area: the ink cools
as the glyph grows. Applies at 2.5rem and above.

**`--ui-text-3` is panel-only.** It measures Lc −21.5, below the absolute floor
of 30. It survives a studio monitor in controlled light. It is banned from
`static/setlist/` and `static/performance/`.

### Rules, not borders

`--ui-rule #333333` · `--ui-rule-strong #444444`, both opaque.

A translucent white border composites to roughly 1.30:1 against its own surface
— far below the 3:1 that WCAG 1.4.11 asks for component boundaries — and
vanishes completely under veiling glare. Worse, it changes weight depending on
what sits behind it. On stage the line has to always be the same line.

### Semantic channels: fill / ink / soft

`--ui-accent #ffa133` · `--ui-success #30d158` · `--ui-danger #ff375f` ·
`--ui-info #0a84ff` · `--ui-loop #bf5af2`

Each has an `-ink` and a `-soft` variant, and the split is a hard rule:

- **fill** — block fills, borders of 3px or more, large glyphs. **Never text
  below 1rem.** `#0a84ff` on black measures Lc −38; as small text it is
  unreadable, as a filled block it is unmistakable.
- **ink** — text and fine glyphs. Targets Lc ≥ 60 on `--ui-bg`.
- **soft** — 12% wash. Never the sole carrier of anything.

The fill values are the RC Surface values exactly. That alignment is the family
signature; the `-ink` derivation is what keeps it readable.

### Geometry

`--ui-radius: 0`. Round survives only where the model is genuinely round: the
record dot and the hold progress ring, via `--ui-radius-round`.

There is no `--ui-shadow`. A diffuse shadow over a near-black ground is
invisible in the dark, invisible under wash, and the single clearest tell of a
SaaS card. If something needs to lift, use a zero-blur offset.

---

## 4. Typography

**Martian Mono**, variable, SIL OFL 1.1, self-hosted at `static/fonts/`, with
`OFL.txt` beside it.

Before this revision the product had no typeface at all: `--ui-font` listed
Inter and fell straight through to the operating system default. The same
player's phone and laptop rendered the same show in different fonts.

Rule for the suite: **one technical mono per product, served locally, licence
file alongside.** RC Surface ships Departure Mono; RC Setlist ships Martian
Mono. Same register, opposite construction — Departure is pixel bound to an
11px grid, Martian is a brutalist outline built for UI density. Family is a
method, not a shared file.

Banned as interface faces: Inter, Outfit, Poppins, Montserrat, Roboto,
JetBrains Mono, and any system-default fallback used as the actual identity.

Berkeley Mono is **closed**, not deferred. The US Graphics EULA (DX-200-09)
forbids sharing the file by public link, forbids redistribution and
sublicensing, and requires a separately purchased MX Module for `@font-face`.
Do not reopen without written permission from `legal@usgraphics.com`.

Three weight stops, not seven: `--ui-wght-body 400`, `--ui-wght-strong 600`,
`--ui-wght-display 800`. Three width stops: `--ui-wdth-dense 87.5` for lists,
labels and the panel; `--ui-wdth-base 100` for body and lyrics;
`--ui-wdth-display 112.5` for numeric readouts only.

Always declare `font-variation-settings` explicitly, but **only force the axis the font errs on**. Never set low-level `'wght'` in `font-variation-settings` on inherited elements (`body`, `html`), as doing so overrides and nullifies all downstream `font-weight` declarations across the application cascade. Express weight using standard CSS `font-weight`, and use `font-variation-settings` solely to constrain width (`'wdth' 75` or `'wdth' var(...)`).

Sung text (lyrics) uses **Barlow Semi Condensed** (SIL OFL 1.1, self-hosted at `static/fonts/`, weights 500 and 700, Latin-1 complete) via tokens `--ui-font-lyric` and `--t-stage-lyric`. While interface readouts stay strictly monospaced with Martian Mono (advance 0.70em/char), lyrics require a proportional condensed face (advance 0.471em/char) to prevent mid-verse truncation on mobile screens while maintaining complete diacritic clearance.

`letter-spacing` on uppercase is **zero**. Tracking is a landing-page tic and it
breaks the mono grid.

### Scale

Two regimes over one palette, in `ui-system.css`: `--t-panel-*` for the panel
inside Live, `--t-stage-*` for the phone and laptop on stage.

**Floor on the stage pages is `--t-stage-micro` (12px), uppercase only.** Before
this revision the click state rendered at 6.7px — execution information at five
arcminutes.

**`--t-stage-display` floors at 2.5rem (40px)** for the current song and
section. Derived from ANSI/HFS-100: 20 arcminutes at 600 mm is about 29px, at
800 mm about 39px, plus margin for a dilated pupil, a glance rather than a read,
and wash on the screen.

The song outranks the clock. Any layout where the timecode is set larger than
the song name is a defect.

---

## 5. State is never carried by colour alone

Under coloured stage wash, chromatic adaptation models fail to predict
appearance; `#ff375f` and `#ffa133` converge under red. Around 8% of men cannot
separate success from danger under any light.

Redundant channels, in order of strength:

1. **Fixed position.** A reserved announcer slot that never reflows, so the
   glance costs a rectangle rather than a read.
2. **Block inversion**, the Live idiom: active is a solid fill with `--ui-bg`
   text at weight 800; hovered-but-not-current is desaturated inversion; inert
   is a 1px rule and no fill.
3. **A 4px edge bar plus an uppercase word**: `NOW`, `ARMED`, `NEXT`, `ERR`,
   `NO LINK`.
4. **Luminance level within one hue**, the Elektron convention. A new hue only
   when the category is new.
5. **Pulse on the musical beat.** Halve above 180 BPM — on the quarter note that
   is exactly 3 Hz, the WCAG 2.3.1 limit — and keep the pulsing area small. It
   rides the rule, never a card fill.

---

## 6. Touch and irreversible actions

| Surface             | Minimum target | Primary action | Gap  |
| ------------------- | -------------- | -------------- | ---- |
| Stage (phone)       | 56px           | 64px           | 20px |
| Panel (Live, mouse) | 24px           | 28px           | 8px  |

44px satisfies WCAG AAA and is still 7.3 mm, below the 9.2 mm measured as the
one-handed thumb minimum. Two densities over one palette.

Activate on `pointerup`, cancellable by sliding off. Nothing executes on
`pointerdown`.

**Never resolve an irreversible action with a confirmation dialog.** A second
screen blows the two-second glance budget. Use the 500 ms hold gate in
`static/setlist/transport-runtime.js` instead — it handles pointer, touch,
keyboard, `blur`, `visibilitychange`, a 12px move tolerance and synthetic-click
suppression, and it is the best stage decision in the product.

Every control whose mistake is expensive is held, not tapped. That now includes
Stop, which halts the band mid-song and sits a thumb's width from Play.

Toggles must change more than colour. A glance has to answer "is click on?"
without a hue comparison.

---

## 7. The panel inside Live

The panel is a different design regime, not a smaller stage page. It shares
tokens and typeface; it does not share density or rules.

- Mouse density: 12px body, 11px labels, 24–28px controls. Never 44px targets,
  never a 40px readout.
- Surface elevation is allowed here and only here. The four-surface stack
  measures 1.12:1 to 1.43:1 between steps — it dies on stage and works on a
  studio monitor. `--ui-text-3` follows the same rule.
- One step darker and flatter than Live, with its **own 1px `--ui-rule` frame**.
  Live measures `Desktop #2a2a2a` and `SurfaceBackground #363636`. Do not copy
  Live's greys; that reads as a bad imitation. The frame is also what keeps the
  panel deliberate against a _light_ Live theme, which the SDK gives no way to
  detect.
- **Amber never marks a Live object as selected.** Live's own accent is
  `#ffad56` — six degrees of hue from ours — and to a Live user amber already
  means "this is the chosen item". Amber is RC focus only; object selection uses
  block inversion.

---

## 8. Never

- Never a red night mode. Aviation abandoned red: it distorts colour, demands
  more accommodation so near focus and perceived contrast both degrade, and in
  glass cockpits it interferes with discriminating the colours on the display
  itself.
- Never pure white on pure black, or anything near it. More contrast there is
  not more legibility; it is halation and ghosting while scrolling.
- Never colour as the sole channel on a stage page.
- Never small text in `--ui-danger`, `--ui-info` or `--ui-loop`. Use `-ink`.
- Never an alpha white border as a component boundary.
- Never `box-shadow` as hierarchy.
- Never large areas filled with solid light colour.
- Never assume haptics. On a mic stand or on the floor the vibration does not
  reach the player, and it becomes an audible buzz on stage. Haptics reinforce
  "received"; they never carry state.
- Never increase density. The portrait performance view already stacks two cards,
  three telemetry readouts and lyrics inside 400px. Every revision is a chance to
  remove.
- Never treat "readable in my office with the lights off" as validation. The test
  is stage wash on the screen, at the real distance and angle.

## 9. Never remove

`prefers-reduced-motion`, `env(safe-area-inset-*)` on all four sides,
`viewport-fit=cover`, `100dvh`, `:focus-visible`, `.sr-only`, `aria-live`,
`tabular-nums`, the three-level connection degradation
(`ok` / `.connection-stale` / `.connection-empty`), and the hold gate with its
`.hold-button`, `.hold-progress`, `.is-holding`, `.is-holding-section-ready`,
`.is-holding-song` and `.is-touch-holding` classes.

## 10. Known open items

- **Resolved**: The Unicode glyphs `↻`, `■`, `⏭` and `♩` were converted to inline `currentColor` SVG icons.
- **Resolved**: Font tokens `--ui-font-lyric` and `--t-stage-lyric` are connected to self-hosted Barlow Semi Condensed.
- **Resolved**: CSS drifts between `setlist.css` and `performance.css` (overlay dimensions, z-index, badge alpha borders) harmonized.
- **Deferred (Phase 5 Visual Direction)**: The fixed-position announcer, the 56/64px stage targets and a scroll-free `/performance` remain deferred per product decision.
