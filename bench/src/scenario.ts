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
  /**
   * Operations per cycle of the workload (one that returns the scene to its
   * start state). `--quick` rounds its warmup and measured counts up to
   * whole cycles, so that a warm-cache scenario stays warm.
   */
  cycle?: number;
  /**
   * A JSON-serializable snapshot of the scene's state (focus path, list
   * offsets, mounted counts). The runner records it after mount, after the
   * warmup and after the measured operations, and flags a run whose two
   * last snapshots differ (when `warmup` and `measured` are whole cycles,
   * they must match) and a scenario whose final state differs between arms.
   */
  probe?: () => unknown;
  /**
   * The kind of operation `i` (for example `'create'` or `'destroy'` in a
   * workload that alternates them). The summary reports each kind on its
   * own row as well as all of them together.
   */
  opKind?: (i: number) => string;
}
