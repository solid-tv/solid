import { core } from '../renderer.js';
import { isDev } from '../env.js';
import calculateFlex from '../flex.js';
import { onFontLoaded } from '../fontLoaded.js';
import { setActiveElementCore } from '../focusManager.js';
import { log } from '../utils.js';
import { NodeType } from '../nodeTypes.js';
import type { ElementNode, SolidNode } from './ElementNode.js';

// The post-mutation pass (1.8's elementNode.ts:60-430, spec 5.7 item 2).
// Three phases run in one microtask (or, for a `loaded` handler, in the
// core's update between its walks: schedulePostMutationInFrame):
//   1. delete-flush: destroy the nodes removed and not re-inserted
//   2. layout: measure the texts written since the last run (and those that
//      waited for a font), then recompute the flex layout of every dirty
//      subtree, deepest first
//   3. focus: resolve forwardFocus on a deferred element, then apply
//
// Order matters: layout reads the attached tree (so destroyed nodes must be
// gone), and focus reads the laid-out tree.
let postMutationQueued = false;
let postMutationInFrame = false;
let nextActiveElement: ElementNode | null = null;
let deferredFocusElement: ElementNode | null = null;
// Entries past elementDeleteCount are undefined; the array keeps its
// capacity between runs.
const elementDeleteQueue: Array<ElementNode | undefined> = [];
let elementDeleteCount = 0;

// The layout queue: containers bucketed by depth (the root's children are at
// depth 1), laid out deepest first, so a container runs after every queued
// container inside it. A node is in at most one bucket entry that counts
// (`_layoutQueued`); updateLayout() clears it, so a node laid out directly is
// skipped when its entry comes up. Buckets keep their capacity: no allocation
// per run once the tree's depth has been seen.
const layoutBuckets: Array<Array<ElementNode | undefined>> = [];
const layoutBucketSize: number[] = [];
let layoutMaxDepth = -1; // deepest bucket that may hold a node
let layoutSweepDepth = -1; // bucket the layout phase is on, -1 outside it
// A node was queued since the layout phase last ran to its end (one that
// threw leaves it set, so the entries it left run next time).
let layoutPending = false;

// Text measurement (spec 5.7 item 6): a `<text>` whose parent lays out is
// sized by the renderer's synchronous measure (`measureText()`) before the
// parent's flex, not by the walk and its `loaded` event. A write to a prop
// its layout reads queues it here (`textLayoutDirty`, `TextMeasure.due`); the
// layout phase measures the queue and queues the parent of a text whose
// size, as flex reads it, changed. Entries past textMeasureCount are
// undefined; the array keeps its capacity.
const textMeasureQueue: Array<ElementNode | undefined> = [];
let textMeasureCount = 0;
// Texts whose font's description was missing when measured (`waiting`):
// each hears `loaded` once (the walk lays it out when the font arrives), and
// loadFonts() tells when a font has loaded (fontLoaded.ts), for those no walk
// visits. Both set fontWaitingDue; the layout phase then measures them.
const fontWaiting: ElementNode[] = [];
let fontWaitingDue = false;
// Length at which the list is next swept of texts that no longer wait
// (destroyed: nothing else takes them off while their font never loads).
// Never while measureFontWaiting walks it (`measuringFontWaiting`).
let fontWaitingSweepAt = 64;
let measuringFontWaiting = false;
// Re-measures in one layout phase before the rest waits for its next change:
// a text whose size flex writes (flexGrow, flexShrink, minWidth) settles in
// one or two, so more means a layout that does not converge.
const MAX_TEXT_SWEEPS = 16;

/**
 * Count an insert (+1) or a removal (-1) of `node` in this pass: the delete
 * flush destroys it when the count is below 0. A `preserve`d node counts
 * from 0 and is never queued again.
 */
export function enqueueDelete(node: ElementNode, n: number): void {
  if (node._queueDelete === undefined) {
    node._queueDelete = n;
    elementDeleteQueue[elementDeleteCount++] = node;
    schedulePostMutation();
  } else {
    node._queueDelete += n;
  }
}

/** Run the pass once, in the next microtask. */
export function schedulePostMutation(): void {
  if (postMutationQueued) {
    return;
  }
  postMutationQueued = true;
  queueMicrotask(runPostMutation);
}

/**
 * Also runs the post-mutation pass inside the core's current or next update,
 * after its walk and before the draw, so what it writes is drawn in that
 * frame. For what the core raises inside its own frame: the handlers it
 * calls between its walks (`loaded`: an autosize node's, a text's while its
 * font loads) and the animation track's writes of a text's layout props
 * (`writeProp`, from `step()`, before the walk). App mutations stay
 * microtask-only. No core before createRenderer (a node built in a unit
 * test): the microtask alone runs it.
 */
export function schedulePostMutationInFrame(): void {
  schedulePostMutation();
  if (postMutationInFrame || core === undefined) {
    return;
  }
  postMutationInFrame = true;
  core.reprocessUpdates(runPostMutation);
}

function runPostMutation(): void {
  postMutationQueued = false;
  postMutationInFrame = false;

  // Phase 1: delete-flush (the count is read every time: a destroy can
  // queue more). An entry is cleared before its destroy, so one whose
  // onDestroy threw is not retried and the next run carries on after it.
  if (elementDeleteCount > 0) {
    for (let i = 0; i < elementDeleteCount; i++) {
      const el = elementDeleteQueue[i];
      elementDeleteQueue[i] = undefined;
      if (el === undefined) {
        continue;
      }
      const queued = el._queueDelete;
      el._queueDelete = undefined;
      if (queued !== undefined && queued < 0) {
        el.destroy();
      }
    }
    elementDeleteCount = 0;
  }

  // Phase 2: layout. Inline, not a function of its own: a module function
  // with one call site becomes a closure per call under terser's default
  // `reduce_funcs` (1.8).
  if (fontWaitingDue) {
    TextMeasure.measureFontWaiting();
  }
  if (layoutPending || textMeasureCount > 0) {
    measureQueuedTexts();
    // Start from the deepest bucket there is, so entries a run that threw
    // left behind are not stranded.
    layoutMaxDepth = layoutBuckets.length - 1;
    let textSweeps = 0;
    while (layoutMaxDepth >= 0) {
      let depth = layoutMaxDepth;
      layoutMaxDepth = -1;
      for (; depth >= 0; depth--) {
        layoutSweepDepth = depth;
        const bucket = layoutBuckets[depth]!;
        // Read the size every time: a run can queue more at this depth.
        for (let i = 0; i < layoutBucketSize[depth]!; i++) {
          const node = bucket[i];
          bucket[i] = undefined;
          if (node !== undefined && node._layoutQueued) {
            updateLayout(node);
          }
        }
        layoutBucketSize[depth] = 0;
      }
      layoutSweepDepth = -1;
      // Texts the sweep wrote (flex sizing a text, an onLayout): measured
      // now, so the container of one that resized runs again in another
      // sweep.
      if (textMeasureCount > 0 && textSweeps < MAX_TEXT_SWEEPS) {
        textSweeps++;
        measureQueuedTexts();
      }
    }
    if (textMeasureCount > 0) {
      // Not converging: drop the rest (each is measured again at its next
      // change), or the run its writes scheduled would start over.
      for (let i = 0; i < textMeasureCount; i++) {
        const t = textMeasureQueue[i];
        textMeasureQueue[i] = undefined;
        if (t !== undefined) {
          t._text!.due = false;
        }
      }
      textMeasureCount = 0;
      if (isDev) {
        console.warn(
          '[solid] Text sizes did not settle in ' +
            MAX_TEXT_SWEEPS +
            ' layout passes (a layout that changes the size of a text it lays out); the rest waits for its next change.',
        );
      }
    }
    layoutPending = false;
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

/**
 * Lay `node` out in the next run, in the bucket of its depth (the pass an
 * attach schedules: attach queues every attached node's parent that needs a
 * layout, then schedules once).
 */
export function enqueueLayout(node: ElementNode): void {
  if (node._layoutQueued) {
    return;
  }
  node._layoutQueued = true;
  layoutPending = true;
  // The depth in its tree: a removed node's tree ends at it.
  let depth = 0;
  for (
    let n: ElementNode = node, p = n.parent;
    !n._detached && p !== undefined;
    n = p, p = n.parent
  ) {
    depth++;
  }
  while (layoutBuckets.length <= depth) {
    layoutBuckets.push([]);
    layoutBucketSize.push(0);
  }
  const size = layoutBucketSize[depth]!;
  layoutBuckets[depth]![size] = node;
  layoutBucketSize[depth] = size + 1;
  // During a sweep, a node at the bucket being run or shallower is reached
  // by that sweep; a deeper one needs another.
  if (depth > layoutMaxDepth && depth > layoutSweepDepth) {
    layoutMaxDepth = depth;
  }
}

/**
 * Queue `node`'s layout (flex and `onLayout`) for the post-mutation pass.
 * Within one pass, containers run deepest first, each at most once unless a
 * child's size changed after its run.
 */
export function queueLayout(node: ElementNode): void {
  enqueueLayout(node);
  schedulePostMutation();
}

/**
 * Measures the texts written since the last call (`textLayoutDirty`) and
 * queues the parent of each whose size, as flex reads it, changed. A text
 * the parent's updateLayout() measured already is skipped.
 */
function measureQueuedTexts(): void {
  for (let i = 0; i < textMeasureCount; i++) {
    const t = textMeasureQueue[i];
    textMeasureQueue[i] = undefined;
    // Cleared by a run that threw part way (the count was not reset).
    if (t === undefined) {
      continue;
    }
    const m = t._text!;
    if (!m.due) {
      continue;
    }
    const parent = t.parent;
    if (parent === undefined || t._detached || !parent.requiresLayout()) {
      // Moved out, or the parent stopped laying out: nothing to size.
      m.due = false;
      m.w = NaN;
      continue;
    }
    if (measureText(t)) {
      enqueueLayout(parent);
    }
  }
  textMeasureCount = 0;
}

/**
 * A text that waited for its font heard `loaded`: the walk laid it out, as
 * the font's description arrived. Shared by every waiting text (no closure
 * per text); the layout phase, in this frame, measures them all.
 */
function fontWaitHeard(): void {
  fontWaitingDue = true;
  schedulePostMutationInFrame();
}

/** Drops the texts that no longer wait for a font (destroyed ones). */
function sweepFontWaiting(): void {
  let kept = 0;
  for (let i = 0; i < fontWaiting.length; i++) {
    const t = fontWaiting[i]!;
    if (t._text!.waiting && !t.destroyed) {
      fontWaiting[kept++] = t;
    }
  }
  fontWaiting.length = kept;
  fontWaitingSweepAt = kept * 2 > 64 ? kept * 2 : 64;
}

onFontLoaded(() => {
  if (fontWaiting.length > 0) {
    fontWaitingDue = true;
    schedulePostMutation();
  }
});

/**
 * What Solid knows of a node it sizes for its parent's layout
 * (`ElementNode._text`), made the first time: a `<text>` in a container that
 * lays out, and an autosize node (its size when its parent last saw it).
 * Its sizes start as doubles, so storing a measured size allocates nothing.
 */
export class TextMeasure {
  // `declare`d, assigned in the constructor: a class field would be emitted
  // as a native field that starts undefined (1.8's design 3.6.5).
  /** A prop its layout reads was written since it was last measured; queued. */
  declare due: boolean;
  /** Its font was missing when measured (`waitForFont`). */
  declare waiting: boolean;
  /** Width and height, as flex reads them, when last measured; NaN before. */
  declare w: number;
  declare h: number;

  constructor() {
    this.due = false;
    this.waiting = false;
    this.w = NaN;
    this.h = NaN;
  }

  /**
   * Measures the texts that waited for a font (`waitForFont`): one whose
   * font is there now stops waiting and, if its size changed, queues its
   * parent; one whose font is still missing waits again. A method, not a
   * module function: the post-mutation pass is its one caller (1.8), and its
   * try would keep that pass from being optimized.
   */
  static measureFontWaiting(): void {
    fontWaitingDue = false;
    const n = fontWaiting.length;
    // A text whose font is still missing is appended again (waitForFont),
    // which must not sweep the list under this loop.
    measuringFontWaiting = true;
    try {
      for (let i = 0; i < n; i++) {
        const t = fontWaiting[i]!;
        const m = t._text!;
        if (!m.waiting) {
          continue; // measured meanwhile
        }
        // Off first, so a measure now finds it listening no more.
        t.off('loaded', fontWaitHeard);
        m.waiting = false;
        if (t.destroyed) {
          continue;
        }
        const parent = t.parent;
        if (parent === undefined || t._detached || !parent.requiresLayout()) {
          m.w = NaN;
          continue;
        }
        // Waits again (appended past n) while the font is still missing.
        if (measureText(t)) {
          enqueueLayout(parent);
        }
      }
    } finally {
      measuringFontWaiting = false;
    }
    // Keep the entries appended meanwhile, without allocating.
    const length = fontWaiting.length;
    for (let i = n; i < length; i++) {
      fontWaiting[i - n] = fontWaiting[i]!;
    }
    fontWaiting.length = length - n;
  }
}

/**
 * A prop the text layout reads was written on `node` (textProps.ts: every
 * write that relays the text out; `width`/`height` on a text). A rendered
 * `<text>` whose parent lays out is measured again in the post-mutation
 * pass, and its parent laid out if its size changed. Anything else returns
 * at once.
 */
export function textLayoutDirty(node: ElementNode): void {
  if (!node.rendered || node._type !== NodeType.TextNode) {
    return;
  }
  let m = node._text;
  if (m !== undefined && m.due) {
    return;
  }
  const parent = node.parent;
  if (parent === undefined || node._detached || !parent.requiresLayout()) {
    // No layout reads it: a parent that lays it out later measures it
    // first (updateLayout), as one it never measured.
    if (m !== undefined) {
      m.w = NaN;
    }
    return;
  }
  if (m === undefined) {
    m = new TextMeasure();
    node._text = m;
  }
  m.due = true;
  textMeasureQueue[textMeasureCount++] = node;
  schedulePostMutation();
}

/**
 * Size the attached `<text>` `t` for its parent's layout now, with the
 * renderer's synchronous measure (the walk then reuses that layout). Returns
 * whether its width or height, as flex reads them (`maxWidth || width`,
 * `maxHeight || height`), changed since the last call. A text with both max
 * sizes is that large to flex whatever its layout: the walk lays it out.
 * While its font is missing it waits (`waitForFont`).
 */
function measureText(t: ElementNode): boolean {
  let m = t._text;
  if (m === undefined) {
    m = new TextMeasure();
    t._text = m;
  }
  m.due = false;
  if (t.destroyed) {
    return false; // in a subtree destroyed since it was written
  }
  if (!(t.maxWidth > 0 && t.maxHeight > 0)) {
    if (t.measureText()) {
      if (m.waiting) {
        // The font arrived: stop listening (the list entry goes at the
        // next measureFontWaiting).
        m.waiting = false;
        t.off('loaded', fontWaitHeard);
        fontWaitingDue = true;
      }
    } else if (!m.waiting) {
      // The font's description is missing (the one false on a live text): hear
      // `loaded` once, when the walk lays the text out (the core wakes the
      // nodes it parked), and wait for loadFonts() to say a font loaded
      // (for one no walk visits). Either way measureFontWaiting measures
      // it again.
      m.waiting = true;
      t.on('loaded', fontWaitHeard);
      if (!measuringFontWaiting && fontWaiting.length >= fontWaitingSweepAt) {
        sweepFontWaiting();
      }
      fontWaiting.push(t);
    }
  }
  // A text's width and height read `maxWidth || own size`.
  const w = t.width;
  const h = t.height;
  if (w === m.w && h === m.h) {
    return false;
  }
  m.w = w;
  m.h = h;
  return true;
}

/**
 * An autosize node's `loaded` (lifecycle.ts registers it at attach, in a
 * parent that lays out): the node takes its size from its texture. A load
 * that leaves the size the parent last saw needs no layout; a new one queues
 * the parent and runs the pass in the frame. Shared by every autosize node.
 */
export function autosizeLoaded(node: ElementNode): void {
  const m = node._text;
  if (m === undefined) {
    return;
  }
  const w = node.width;
  const h = node.height;
  if (w === m.w && h === m.h) {
    return;
  }
  // Recorded even while removed, as 1.8's closure did: a parent it joins
  // again compares with the size it has now.
  m.w = w;
  m.h = h;
  const parent = node.parent;
  if (parent === undefined || node._detached) {
    return;
  }
  enqueueLayout(parent);
  schedulePostMutationInFrame();
}

/** `autofocus`: focus `node` in the next pass, once its children attached. */
export function deferFocus(node: ElementNode): void {
  deferredFocusElement = node;
  schedulePostMutation();
}

/**
 * The last step of `setFocus()` (ElementNode): the node becomes the active
 * element in the next pass, so that its children attach first (Row and
 * Column).
 */
export function focusNext(node: ElementNode): void {
  nextActiveElement = node;
  schedulePostMutation();
}

/**
 * `updateLayout()`: the node's flex layout and `onLayout`, after measuring
 * its texts that need it; a change queues the parent's.
 */
export function updateLayout(node: ElementNode): void {
  node._layoutQueued = false;
  const children = node.children;
  const numChildren = children.length;
  if (numChildren === 0) {
    return;
  }
  if (isDev) {
    log('Layout: ', node);
  }

  const isFlex = node.display === 'flex';
  if (isFlex && node.flexGrow && node.width === 0) {
    return;
  }

  // Texts written since Solid last measured them (a direct updateLayout()
  // before the post-mutation pass), or never measured (this container lays
  // out only now): sized before the flex pass reads them.
  for (let i = 0; i < numChildren; i++) {
    const c = children[i]!;
    if (c._type === NodeType.TextNode && c.rendered) {
      const m = c._text;
      if (m === undefined || m.due || m.w !== m.w) {
        measureText(c);
      }
    }
  }

  let flexChanged = isFlex && calculateFlex(node);

  if (isFlex && node._containsFlexGrow === true) {
    // This pass changed its children's sizes: lay out the flex ones again,
    // directly, so they do not queue this container back through their
    // own size. If one of them resized, lay this container out once more.
    let childResized = false;
    for (let i = 0; i < numChildren; i++) {
      const c = children[i]!;
      // A TextNode may be a child (`children` types it out).
      if ((c as SolidNode)._type !== NodeType.Text && c.display === 'flex') {
        if (calculateFlex(c)) {
          childResized = true;
        }
        const childLayout = c.onLayout;
        if (typeof childLayout === 'function') {
          childLayout.call(c, c);
        }
      }
    }
    if (childResized && calculateFlex(node)) {
      flexChanged = true;
    }
    node._containsFlexGrow = null;
  }

  // One onLayout, after the final layout (the children's included).
  const onLayout = node.onLayout;
  // Truthy when it changed something: the parent is laid out too.
  const onLayoutChanged: unknown =
    typeof onLayout === 'function' && onLayout.call(node, node);

  // A container whose size changed queues its parent (one with nothing to
  // lay out would do nothing). A removed container keeps its parent link
  // but not its place.
  const parent = node._detached ? undefined : node.parent;
  if (
    (flexChanged || onLayoutChanged) &&
    parent !== undefined &&
    parent.requiresLayout()
  ) {
    queueLayout(parent);
  }
}
