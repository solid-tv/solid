import {
  NULL,
  createAnimation,
  type AnimateProps,
  type IAnimationController,
} from '@solidtv/renderer';
import { Config } from '../config.js';
import { isDev } from '../env.js';
import type { AnimationSettings } from '../intrinsicTypes.js';
import type {
  ElementNode,
  OnEventProp,
  TransitionSetting,
} from './ElementNode.js';
import type { StoreProp } from './defaults.js';

// Transitions, `animate`/`chain`/`start` and the `onEvent` prop (spec 5.5).
// A transitioned write (ElementNode `_animate`, a method so that a minifier
// never inlines it as a per-call closure) goes through the renderer's
// `animateSlotProp`, which keeps one controller per prop keyed by the
// settings object's identity: the same object again retargets and restarts
// it, so a repeated write allocates nothing. `onAnimation.stopped` fires
// from the controller's `onStop`, installed once per controller.

/**
 * The settings of a transition with none given and no default: one frozen
 * object, so the controller cache sees the same settings every write (`{}`
 * per write would stop and remake the controller each time).
 */
export const NO_SETTINGS: AnimationSettings = Object.freeze({});

/** What `animate` returns on a node that is not attached: does nothing. */
const INERT: IAnimationController = {
  state: 'stopped',
  start(): IAnimationController {
    return INERT;
  },
  stop(): IAnimationController {
    return INERT;
  },
  pause(): IAnimationController {
    return INERT;
  },
  restore(): IAnimationController {
    return INERT;
  },
  waitUntilStopped(): Promise<void> {
    return Promise.resolve();
  },
};

/**
 * The settings a transition animates a write of `name` with, or undefined
 * when the write lands at once: the node is not attached, animations are
 * off, or `transition` does not name the prop. `true` (all props, or this
 * one) takes the node's `animationSettings`, then `Config.animationSettings`,
 * then NO_SETTINGS; a settings object on the prop is used as given.
 */
export function transitionSettings(
  node: ElementNode,
  name: string,
): AnimationSettings | undefined {
  const transition = node._transition;
  if (
    transition === undefined ||
    transition === false ||
    !node.rendered ||
    !Config.animationsEnabled
  ) {
    return undefined;
  }
  const own = transition === true ? true : transition[name];
  if (own === undefined || own === false) {
    return undefined;
  }
  if (own === true) {
    return node._animationSettings || Config.animationSettings || NO_SETTINGS;
  }
  return own;
}

/**
 * `onAnimation.stopped` for the controller of `name`: made once per
 * controller (when the renderer makes one, ElementNode `_animate`), never
 * per write. It reports the prop's value as the animation left it: the
 * target on completion.
 */
export function stoppedHook(node: ElementNode, name: StoreProp): () => void {
  return () => {
    const handlers = node.onAnimation;
    if (handlers !== undefined && handlers.stopped !== undefined) {
      handlers.stopped.call(node, name, node[name]);
    }
  };
}

/**
 * `animate(props, settings)`: an unstarted controller over the renderer's
 * animation, with the given settings, else the node's, else Config's; an
 * inert one before attach.
 */
export function animateNode(
  node: ElementNode,
  props: AnimateProps,
  settings: AnimationSettings | undefined,
): IAnimationController {
  // Destroyed (slot NULL): inert too, so that a chain drains.
  if (!node.rendered || node.slot === NULL) {
    if (isDev) {
      console.log('NOT RENDERED! CANNOT ANIMATE');
    }
    return INERT;
  }
  return createAnimation(
    node.core,
    node,
    props,
    settings || node.animationSettings || NO_SETTINGS,
  );
}

/** `chain(props, settings)`: queue an animation for `start`. */
export function chainAnimation(
  node: ElementNode,
  props: AnimateProps,
  settings: AnimationSettings | undefined,
): void {
  if (node._animationRunning) {
    node._animationQueue = [];
    node._animationRunning = false;
  }
  if (settings) {
    node._animationQueueSettings = settings;
  } else if (!node._animationQueueSettings) {
    node._animationQueueSettings = node.animationSettings;
  }
  let queue = node._animationQueue;
  if (queue === undefined) {
    queue = [];
    node._animationQueue = queue;
  }
  queue.push({
    props,
    animationSettings: settings || node._animationQueueSettings,
  });
}

/**
 * `start()`: run the queued animations one after the other; resolves when
 * the queue is empty. Promise chaining, not `async` (spec 3).
 */
export function startChain(node: ElementNode): Promise<void> {
  const queue = node._animationQueue;
  const next = queue === undefined ? undefined : queue.shift();
  if (next === undefined) {
    node._animationRunning = false;
    node._animationQueueSettings = undefined;
    return Promise.resolve();
  }
  node._animationRunning = true;
  return animateNode(node, next.props, next.animationSettings)
    .start()
    .waitUntilStopped()
    .then(() => startChain(node));
}

/** Add (`on`) or remove (`off`) each handler of an `onEvent` object. */
function listen(node: ElementNode, events: OnEventProp, add: boolean): void {
  for (const name in events) {
    if (!Object.prototype.hasOwnProperty.call(events, name)) {
      continue;
    }
    const handler = events[name];
    if (handler === undefined) {
      continue;
    }
    if (add) {
      node.on(name, handler);
    } else {
      node.off(name, handler);
    }
  }
}

/**
 * The accessors of this module: `transition`, `animationSettings` and the
 * `onEvent` prop. `this: ElementNode` as in accessors.ts.
 */
export function installAnimationAccessors(proto: ElementNode): void {
  Object.defineProperties(proto, {
    transition: {
      get(this: ElementNode): TransitionSetting | undefined {
        return this._transition;
      },
      set(this: ElementNode, v: TransitionSetting | undefined) {
        this._transition = v;
      },
    },
    // Reads the node's settings, else Config's (1.x).
    animationSettings: {
      get(this: ElementNode): AnimationSettings | undefined {
        return this._animationSettings || Config.animationSettings;
      },
      set(this: ElementNode, v: AnimationSettings | undefined) {
        this._animationSettings = v;
      },
    },
    // `{ loaded: fn, ... }`: each key a listener (`on`). A new object
    // replaces the previous one's listeners, and only those.
    onEvent: {
      get(this: ElementNode): OnEventProp | undefined {
        return this._onEventProp;
      },
      set(this: ElementNode, v: OnEventProp | undefined) {
        const previous = this._onEventProp;
        if (previous === v) {
          return;
        }
        if (previous !== undefined) {
          listen(this, previous, false);
        }
        this._onEventProp = v;
        if (v !== undefined) {
          listen(this, v, true);
        }
      },
    },
  });
}
