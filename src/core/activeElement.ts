import { createSignal } from 'solid-js';
import type { ElementNode } from './elementNode.js';

/**
 * Generic active-element signal — intentionally decoupled from the focus
 * manager so consumers can drive focus from their own focus-management logic.
 *
 * `setActiveElement` is the *raw* signal setter: it only updates the reactive
 * value. It does NOT move focus state, fire `onFocus`/`onBlur`, or touch the
 * focus path — that is the focus manager's job (`setActiveElementCore` in
 * {@link ./focusManager.ts}).
 *
 * The built-in focus manager applies focus via `setActiveElementCore` and
 * publishes the result through `Config.setActiveElement`, which defaults to
 * this setter. A library shipping its own focus manager can read
 * {@link activeElement}, reassign `Config.setActiveElement` (e.g. to inject a
 * Solid owner context), or call `setActiveElement` directly — without depending
 * on `focusManager.ts`. Because it is a terminal signal write (it never calls
 * back into the focus manager), wiring it into `Config.setActiveElement` cannot
 * recurse.
 */
export const [activeElement, setActiveElement] = createSignal<
  ElementNode | undefined
>(undefined);
