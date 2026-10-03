// Shared fixtures for the contract-focus and contract-keys tests.
//
// Vitest runs with `isolate: false`, so the focus manager's module state
// (focus path, active element, key map, last key) is shared with every other
// test file in the worker, and some of those leave listeners on `document`.
// These helpers keep a test's key events off `document`: each mount gets its
// own KeyTarget, and only the focus manager mounted with it hears its events.
import * as v from 'vitest';
import type { JSX } from 'solid-js';
import type { ElementNode } from '@solidtv/solid';
import {
  useFocusManager,
  type KeyEventLike,
  type KeyEventTarget,
  type KeyMap,
} from '@solidtv/solid/primitives';
import { renderer } from './setup.js';

type KeyEventType = 'keydown' | 'keyup';
type Listener = (event: KeyEventLike) => void;

export interface TestKeyEvent extends KeyEventLike {
  preventDefault: v.Mock<() => void>;
}

export interface KeyOptions {
  keyCode?: number;
  repeat?: boolean;
}

/** A key-event host only one focus manager listens on. */
export class KeyTarget implements KeyEventTarget {
  listeners: Record<KeyEventType, Listener[]> = { keydown: [], keyup: [] };

  addEventListener(type: KeyEventType, listener: Listener) {
    this.listeners[type].push(listener);
  }

  removeEventListener(type: KeyEventType, listener: Listener) {
    const list = this.listeners[type];
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
  }

  fire(type: KeyEventType, key: string, opts: KeyOptions = {}): TestKeyEvent {
    const event: TestKeyEvent = {
      key,
      keyCode: opts.keyCode ?? 0,
      repeat: opts.repeat ?? false,
      preventDefault: v.vi.fn<() => void>(),
    };
    for (const listener of this.listeners[type].slice()) listener(event);
    return event;
  }

  down(key: string, opts?: KeyOptions) {
    return this.fire('keydown', key, opts);
  }

  up(key: string, opts?: KeyOptions) {
    return this.fire('keyup', key, opts);
  }
}

/** Lets queued post-mutation work (layout, then focus) run. */
export const flush = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Renders `view` under a focus manager bound to a fresh KeyTarget. */
export async function mount(
  view: () => JSX.Element,
  keyMap?: Partial<KeyMap>,
): Promise<{ target: KeyTarget; dispose: () => void }> {
  const target = new KeyTarget();
  const dispose = renderer.render(() => {
    useFocusManager(keyMap, target);
    return view();
  }) as unknown as () => void;
  await flush();
  return { target, dispose };
}

export interface HandlerCall {
  /** `id` of the node the handler was called on (read from `this`). */
  node: string | undefined;
  /** `id` of the node the handler was set on, when given to `handler`. */
  owner: string | undefined;
  handler: string;
  self: ElementNode;
  args: unknown[];
}

/**
 * Records handler calls in order. `handler(name, ret, owner)` returns a plain
 * function (not an arrow, so `this` is the node) that logs and returns `ret`.
 * Pass `owner` (the id of the node it is set on) to check the `this` binding.
 */
export function recorder() {
  const calls: HandlerCall[] = [];
  // Typed loosely (any) so one recorder fits every handler prop's signature.
  const handler = (name: string, ret?: unknown, owner?: string) =>
    function (this: ElementNode, ...args: any[]): any {
      calls.push({ node: this.id, owner, handler: name, self: this, args });
      return ret;
    };
  const order = () => calls.map((c) => `${c.node}.${c.handler}`);
  const clear = () => {
    calls.length = 0;
  };
  return { calls, handler, order, clear };
}
