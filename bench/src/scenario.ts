import type { JSX } from 'solid-js';

/**
 * One benchmark scenario. A scenario is a scene plus a workload: the runner
 * mounts `App` once per page load, waits for `ready`, then calls `step` for
 * `warmup` operations and then for `measured` operations, timing each one.
 *
 * Scenarios must be arm-agnostic: they use only the public `@solidtv/solid`
 * API that solid 1.6.4 (arm A) and 1.7 (arms B, C) share, never the renderer
 * directly.
 */
export interface Scenario {
  /** Stable kebab-case id, used in URLs (`?scenario=`) and result files. */
  id: string;
  /** One line for the report. */
  title: string;
  /** A text scenario: the runner also records the text metrics. */
  text?: boolean;
  /** The scene, rendered once per page load under the root node. */
  App: () => JSX.Element;
  /**
   * Resolves when the scene is mounted, its fonts are loaded and its first
   * layout is done. Default: the runner waits for the renderer to go idle.
   */
  ready?: () => Promise<void>;
  /**
   * One operation of the workload, `i` counting from 0 across warmup and
   * measured operations. A key-press workload returns the key name
   * (`'ArrowRight'`, `'Enter'`, ...) and the runner dispatches it as a
   * keydown/keyup pair on `document`. Any other workload (node creation, a
   * state toggle, a text change) does its work synchronously inside `step`
   * and returns null.
   */
  step: (i: number) => string | null;
  /** Operations before measuring. Default 30. */
  warmup?: number;
  /** Operations measured. Default 60. */
  measured?: number;
}
