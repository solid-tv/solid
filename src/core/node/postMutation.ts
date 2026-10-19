import { core } from '../renderer.js';
import { isDev } from '../env.js';
import calculateFlex from '../flex.js';
import { setActiveElementCore } from '../focusManager.js';
import { log } from '../utils.js';
import { NodeType } from '../nodeTypes.js';
import type { ElementNode, SolidNode } from './ElementNode.js';

// The post-mutation pass (elementNode.ts:60-138 before 2.0; the 1.8 queues
// come with Task 10). Three phases run in one microtask, or in the core's
// next update (reprocessUpdates), whichever is first:
//   1. delete-flush: destroy the nodes removed and not re-inserted
//   2. layout: recompute the flex layout of every dirty subtree
//   3. focus: resolve forwardFocus on a deferred element, then apply
//
// Order matters: layout reads the attached tree (so destroyed nodes must be
// gone), and focus reads the laid-out tree.
let postMutationQueued = false;
let nextActiveElement: ElementNode | null = null;
let deferredFocusElement: ElementNode | null = null;
const layoutQueue = new Set<ElementNode>();
const elementDeleteQueue: ElementNode[] = [];

/**
 * Count an insert (+1) or a removal (-1) of `node` in this pass: the delete
 * flush destroys it when the count is below 0. A `preserve`d node counts
 * from 0 and is never queued again.
 */
export function enqueueDelete(node: ElementNode, n: number): void {
  if (node._queueDelete === undefined) {
    node._queueDelete = n;
    if (elementDeleteQueue.push(node) === 1) {
      schedulePostMutation();
    }
  } else {
    node._queueDelete += n;
  }
}

/** Run the pass once, in the next microtask or the core's next update. */
export function schedulePostMutation(): void {
  if (postMutationQueued) {
    return;
  }
  postMutationQueued = true;
  // No core before createRenderer (a node built in a unit test): the
  // microtask alone runs the pass.
  if (core !== undefined) {
    core.reprocessUpdates(runPostMutation);
  }
  queueMicrotask(runPostMutation);
}

function runPostMutation(): void {
  postMutationQueued = false;

  // Phase 1: delete-flush
  if (elementDeleteQueue.length > 0) {
    for (let i = 0; i < elementDeleteQueue.length; i++) {
      const el = elementDeleteQueue[i]!;
      if (el._queueDelete !== undefined && el._queueDelete < 0) {
        el.destroy();
      }
      el._queueDelete = undefined;
    }
    elementDeleteQueue.length = 0;
  }

  // Phase 2: layout
  while (layoutQueue.size > 0) {
    const queue: ElementNode[] = [];
    layoutQueue.forEach((node) => {
      queue.push(node);
    });
    layoutQueue.clear();
    for (let i = queue.length - 1; i >= 0; i--) {
      queue[i]!.updateLayout();
    }
  }

  // Phase 3: focus. setFocus() may have evaluated forwardFocus before attach
  // (when no children existed yet); deferredFocusElement re-runs setFocus
  // here once the subtree is attached, then setActiveElementCore is applied.
  if (deferredFocusElement !== null) {
    const el = deferredFocusElement;
    deferredFocusElement = null;
    el.setFocus();
  } else if (nextActiveElement !== null) {
    const element = nextActiveElement;
    nextActiveElement = null;
    setActiveElementCore(element);
  }
}

/** Lay `node` out in the next pass. */
export function queueLayout(node: ElementNode): void {
  layoutQueue.add(node);
  schedulePostMutation();
}

/**
 * Lay `node` out in the pass an attach schedules (attach adds every
 * attached node's parent that needs a layout, then schedules once).
 */
export function addToLayoutQueue(node: ElementNode): void {
  layoutQueue.add(node);
}

/** `autofocus`: focus `node` in the next pass, once its children attached. */
export function deferFocus(node: ElementNode): void {
  deferredFocusElement = node;
  schedulePostMutation();
}

/**
 * `setFocus()`: forwardFocus first (a handler, or a child index); else the
 * node becomes the active element in the next pass, so that its children
 * attach first (Row and Column). Before attach it only marks the node, and
 * attach focuses it.
 */
export function setFocus(node: ElementNode): void {
  if (!node.rendered) {
    node._autofocus = true;
    return;
  }
  const forwardFocus = node.forwardFocus;
  // can be 0
  if (forwardFocus !== undefined) {
    if (typeof forwardFocus === 'function') {
      if (forwardFocus.call(node, node) !== false) {
        return;
      }
    } else {
      const nodes = node.children;
      if (forwardFocus < nodes.length) {
        const child = nodes[forwardFocus]!;
        // A TextNode may be a child (`children` types it out).
        if ((child as SolidNode)._type !== NodeType.Text) {
          child.setFocus();
        }
        return;
      }
    }
  }
  nextActiveElement = node;
  schedulePostMutation();
}

/**
 * `updateLayout()`: the node's flex layout and `onLayout`; a change queues
 * the parent's.
 */
export function updateLayout(node: ElementNode): void {
  const children = node.children;
  if (children.length === 0) {
    return;
  }
  if (isDev) {
    log('Layout: ', node);
  }

  if (node.display === 'flex' && node.flexGrow && node.width === 0) {
    return;
  }

  const flexChanged = node.display === 'flex' && calculateFlex(node);
  layoutQueue.delete(node);
  const onLayout = node.onLayout;
  // Truthy when it changed something: the parent is laid out too.
  const onLayoutChanged: unknown =
    typeof onLayout === 'function' && onLayout.call(node, node);

  if ((flexChanged || onLayoutChanged) && node.parent !== undefined) {
    queueLayout(node.parent);
  }

  if (node._containsFlexGrow === true) {
    // Need to reprocess children
    for (let i = 0; i < children.length; i++) {
      const c = children[i]!;
      // A TextNode may be a child (`children` types it out).
      if ((c as SolidNode)._type !== NodeType.Text && c.display === 'flex') {
        // calculating directly to prevent infinite loops recalculating parents
        calculateFlex(c);
        const childLayout = c.onLayout;
        if (typeof childLayout === 'function') {
          childLayout.call(c, c);
        }
        queueLayout(node);
      }
    }
  }
}
