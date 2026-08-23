export type * from '@solidtv/solid/jsx-runtime';
export * from './core/index.js';
export type * from './core/index.js';
export type { KeyHandler, KeyMap } from './core/focusManager.js';
export { activeElement, setActiveElement } from './core/activeElement.js';
export { setActiveElementCore } from './core/focusManager.js';
export * from './utils.js';
export * from './render.js';
export * from './types.js';
// Solid 2.0 names. `Suspense`/`SuspenseList`/`ErrorBoundary` were renamed to
// `Loading`/`Reveal`/`Errored`, and `Index` folded into `<For keyed={false}>`.
// SolidTV tracks the new vocabulary rather than aliasing the old names.
export {
  For,
  Show,
  Switch,
  Match,
  Loading,
  Reveal,
  Errored,
  Repeat,
} from 'solid-js';
