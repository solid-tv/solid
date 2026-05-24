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
- [x] Added the new key-handler consume contract (see "Key-handler consume
      contract" section below). `e.stopPropagation()` is the new way to
      consume a key event; legacy `return true` still works with a dev warn.

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

**Key-handler consume signal (deprecated, not breaking in 1.3)**

Key handlers (`onEnter`, `onUp`/`Down`/`Left`/`Right`, `onKeyPress`,
`onKeyHold`, `on${MappedKey}`, capture-phase equivalents) should now call
`e.stopPropagation()` to consume the event and stop focus-path bubbling.
Returning `true` continues to work in 1.3 with a one-time dev-mode warning
per handler, and is removed in 1.4.

Before:

```tsx
onEnter={() => { doThing(); return true; }}
```

After:

```tsx
onEnter={(e) => { doThing(); e.stopPropagation(); }}
```

Handlers that don't consume the event need no changes — observation-only
handlers (logging, analytics) continue to bubble as before.

#### Rollback

There is no rollback flag in 1.3 — the legacy engine has been deleted. Apps
that need the old behavior should pin to `1.2.x` until they migrate.

---

### Key-handler consume contract: prefer `e.stopPropagation()`

**Status:** shipped on the `1.3` branch via Option A (additive). Legacy
`return true` continues to work in 1.3 with a one-time dev warning per
handler. Removal scheduled for 1.4.

**Today** (`src/core/focusManager.ts`):

- A focus-path handler (`onEnter`, `onUp`, `onKeyPress`, `on${Mapped}`, etc.)
  is checked with `handler.call(...) === true`.
- Strict `true` consumes the event and stops traversal up the focus path.
- Anything else (`undefined`, `false`, `null`, void) lets the event bubble to
  the next ancestor.

**Proposed:**

- If a handler function exists on a focus-path node, the event is consumed by
  default (traversal stops).
- To let the event continue bubbling, the handler must explicitly
  `return false`.

**Migration impact:**

- Every existing handler that did _not_ `return true` (the common case — most
  handlers don't bother) is unchanged in observable behavior: they were the
  end of bubbling anyway because the parent rarely had a competing handler.
- Handlers that intentionally observed-but-passed-through (logging, analytics,
  debug overlays, instrumentation wrappers, `onKeyPress` on a parent that
  watches all keys) silently start swallowing events. **This is the dangerous
  class.** There is no compile error; the app just stops reacting at a parent.
- The handler signature does not change, so no TypeScript surfaces the break.

**Pros of flipping:**

- Matches the 90% case — most TV handlers do consume.
- Less boilerplate; no trailing `return true;` on every handler.
- Forgetting to `return true` today is a quiet double-handling bug. Forgetting
  `return false` under the new contract is a loud "parent stopped firing" bug,
  which is easier to notice.

**Cons of flipping:**

- Pure semantic break with no compiler signal. Worst kind of migration.
- Composition hazard: any wrapper / decorator / HOC handler that observes
  without consuming becomes a focus trap.
- Diverges from DOM / React / Solid synthetic-event convention, where handlers
  do _not_ consume by default and you call `e.stopPropagation()`.
- Conflates "is bound" with "consumed." `undefined` is a natural "I didn't
  decide" return; the new contract removes that affordance.

**What landed on `1.3`:**

- Both `runCapturePhase` and `runBubblePhase` in `src/core/focusManager.ts`
  now consume the event when either signal is present:
  - **Modern:** the handler called `e.stopPropagation()` (sets `cancelBubble`
    on the native `KeyboardEvent`).
  - **Legacy:** the handler returned `true`. Emits a one-time dev-mode
    warning per handler function, then consumes. WeakSet-keyed so the
    warning fires once per handler over the app lifetime, not per keypress.
- Consume check is factored into `_isHandlerConsumed` (exported as `@internal`
  for tests) — single source of truth for both phases.
- `KeyHandlerReturn` in `src/core/focusKeyTypes.ts` is marked `@deprecated`
  for the boolean case via JSDoc — surfaces as a strikethrough on `return true`
  in IDEs.
- `tests/focusManager.keyhandler.spec.ts` covers: `stopPropagation` consume,
  `return true` consume + warn, no return → bubble, `return false` → bubble,
  warn-once per handler, distinct handlers warn separately, both signals
  together (no warn), sticky `cancelBubble` across the focus path.

**What's deferred to 1.4:**

- Remove the `result === true` shim from `_isHandlerConsumed`.
- Delete `warnDeprecatedReturnTrue` and the WeakSet.
- Narrow `KeyHandlerReturn` to `void`.
- Drop the legacy-path tests.

**Why Option A over flipping the default:**

A silent default-flip ("auto-consume if a handler exists, return false to
bubble") has no compiler signal, no runtime signal for the dangerous case
(observation-only handlers silently swallow events), and conflates "is bound"
with "consumed." `e.stopPropagation()` matches DOM/React/Solid idiom and is
explicit at the call site. The shim lets every existing handler keep working
unchanged through 1.3 while pushing new code toward the explicit signal.
