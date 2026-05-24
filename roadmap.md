# Roadmap

## 1.3 (in progress on `1.3` branch)

### Make the new flex engine the default

The legacy `src/core/flex.ts` has been removed. The previously opt-in engine
(`flexLayout.ts`) is now the single implementation at `src/core/flex.ts`. No
fallback env var ships in 1.3 — the engines diverged enough that maintaining
both was the bigger risk.

#### Completed on this branch

- [x] Removed `src/core/flex.ts` (legacy engine).
- [x] Renamed `src/core/flexLayout.ts` → `src/core/flex.ts`.
- [x] Dropped the `VITE_USE_NEW_FLEX` toggle from `src/core/elementNode.ts`
      and `vite-env.d.ts`.
- [x] Updated `CLAUDE.md`: removed the "Only single `padding` number" rule,
      updated the architecture note to reflect a single engine.
- [x] Updated `docs/flow/layout.md`: removed the toggle section, added a
      1.2 → 1.3 upgrade pointer.
- [x] Updated `tests/flex.spec.ts`: dropped the assertion on the removed
      "No available space for flex-grow items to expand" warning.

#### Still TODO before tagging 1.3

- [ ] Fix `flexWrap: 'wrap-reverse'` regression — the wrap branch checks only
      `flexWrap === 'wrap'`, so wrap-reverse falls through to the non-wrap
      branch and does not wrap. Should match old behavior:
      `flexWrap === 'wrap' || isWrapReverse`.
- [ ] Add tests covering new behaviors (per-side padding, `margin` array,
      `flexBasis`, `flexShrink`, wrap with cross-axis padding).
- [ ] Bump version in `package.json` to `1.3.0`.
- [ ] Land migration notes (below) in the changelog.

#### Migration notes (for CHANGELOG / release notes)

The flex engine has been replaced. Most layouts will render identically, but
the new engine adds CSS-spec behavior that was previously ignored, and a few
edge cases shift. Audit the items below before upgrading.

**New capabilities (additive — won't break existing code on their own)**

- **Per-side padding** — `paddingTop`, `paddingRight`, `paddingBottom`,
  `paddingLeft` are now honored. `padding` also accepts an array using
  CSS shorthand: `[all]`, `[v, h]`, `[t, h, b]`, `[t, r, b, l]`.
- **`margin` array shorthand** — same shorthand semantics as `padding`.
  Per-side `marginLeft`/`Right`/`Top`/`Bottom` still work and take precedence.
- **`flexBasis`** — accepts a number or `'auto'`. When set, it becomes the
  base main-axis size for grow/shrink calculations instead of `width`/`height`.
- **`flexShrink`** — when items overflow, they now shrink proportionally to
  `flexShrink * baseSize`, clamped to `minWidth`/`minHeight`. Previously
  overflowing items just overflowed.

**Behavioral changes (may break existing layouts)**

1. **`padding` now applies to all four sides.** The old engine applied a
   scalar `padding` only to the start of the main axis. Layouts that used
   `padding` to inset from one side will now also see cross-axis insets equal
   to that value. Switch to explicit `paddingLeft` / `paddingTop` etc. if you
   need the old single-sided behavior.

2. **`margin` is now a reserved layout property.** If any code passes a
   `margin` prop for unrelated reasons, it will be interpreted as a margin
   shorthand. Rename non-layout uses.

3. **`flexBasis` and `flexShrink` are now load-bearing.** Any value set
   "just in case" under the old engine had no effect; under the new engine
   it changes sizing. Audit for stale values.

4. **Wrap containers grow on the cross axis by `paddingCrossEnd`.** Auto-sized
   wrap containers will be larger on the cross axis when cross-axis padding is
   set. Adjust container sizes or remove cross-axis padding if this is
   unwanted.

5. **`spaceBetween` / `spaceAround` / `spaceEvenly` use `paddingStart + paddingEnd`**
   instead of `padding * 2`. Identical for symmetric scalar padding; different
   (and now correct) for asymmetric per-side padding.

6. **`flex-grow` no longer logs a warning** when there is no space available.
   Remove any log assertions that depended on this.

**Removed warnings**

- `"No available space for flex-grow items to expand, or items overflow."`

#### Rollback

Set `VITE_USE_OLD_FLEX=true` to fall back to the legacy engine for the duration
of this minor. The legacy engine is removed in the next minor release after
this one.
