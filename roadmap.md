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
- [x] Flipped the key-handler consume default — a handler that runs now
      consumes the event by default; `return false` to bubble. See
      "Key-handler consume contract" section below. **Silent breaking
      change for observation-only handlers — audit before upgrading.**

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

**Key-handler consume default flipped (breaking, silent)**

The default behavior for focus-path key handlers (`onEnter`, `onUp`/`Down`/
`Left`/`Right`, `onKeyPress`, `onKeyHold`, `on${MappedKey}`, capture-phase
equivalents) is inverted in 1.3:

|                                           | 1.2      | 1.3          |
| ----------------------------------------- | -------- | ------------ |
| Handler returns `true`                    | consumed | consumed     |
| Handler returns `false`                   | bubbles  | bubbles      |
| Handler returns `undefined` / no `return` | bubbles  | **consumed** |

In practice this means: **if you bind a key handler in 1.3, it consumes the
event by default.** Return `false` explicitly if you want the event to
continue bubbling up the focus path.

Existing `return true` handlers continue to work unchanged. Existing
`return false` handlers continue to work unchanged. **The migration risk
is observation-only handlers** — anything like

```tsx
onEnter={() => analytics.track('enter pressed')}
onKeyPress={(e) => console.log(e.key)}
```

These used to be transparent (the event continued bubbling to ancestors).
In 1.3 they silently consume. If an ancestor was relying on receiving the
same event, it will stop firing. To preserve 1.2 behavior, change them to:

```tsx
onEnter={() => { analytics.track('enter pressed'); return false; }}
onKeyPress={(e) => { console.log(e.key); return false; }}
```

There is no compiler signal and no runtime warning for this change. Audit
every key handler in the app for observation-without-consume patterns
before upgrading. A search for `onEnter|onUp|onDown|onLeft|onRight|onKeyPress|onKeyHold`
across the codebase is the recommended starting point.

#### Rollback

There is no rollback flag in 1.3 — the legacy engine has been deleted. Apps
that need the old behavior should pin to `1.2.x` until they migrate.

---

### Key-handler consume contract: flip the default

**Status:** shipped on the `1.3` branch. Default-flip with no warning shim.

**Old contract (1.2):**

- `runBubblePhase` / `runCapturePhase` in `src/core/focusManager.ts` consumed
  the event only when the handler returned strict `true`.
- `undefined`, `false`, `null`, and void all bubbled to the next ancestor.

**New contract (1.3):**

- A focus-path handler that runs is considered to have consumed the event.
- `return false` is the only way to opt back into bubbling.
- All other return values (`undefined`, `true`, void, non-boolean) consume.

**Implementation:**

- Consume check centralized in `_isHandlerConsumed(result)` — returns
  `result !== false`. Exported `@internal` for tests.
- Both `runCapturePhase` and `runBubblePhase` call into the helper as the
  single source of truth for the consume signal.
- `KeyHandlerReturn` in `focusKeyTypes.ts` JSDoc documents the new contract
  on hover. Type remains `boolean | void` — `false` is the meaningful return.
- Tests in `tests/focusManager.keyhandler.spec.ts` verify each return-value
  case (`false`, `undefined`, `true`, void, non-boolean).

**Migration risk (documented in the changelog migration notes above):**

This is a silent semantic flip. Observation-only handlers (logging,
analytics, instrumentation) that previously transparently bubbled now
consume by default. There is no compile error and no runtime warning.
Apps upgrading from 1.2 must audit every focus-path handler for the
"observe but don't act" pattern and add an explicit `return false` to
preserve 1.2 behavior.

The reasoning for accepting this risk: the consume-by-default case is the
overwhelming majority of handler bodies, and the boilerplate of an
explicit `return true` on every handler outweighed the migration cost of
the rare observation-only case.
