import { type ElementNode } from './elementNode.js';
import { Config } from './config.js';
import { isTextNode, isElementText } from './utils.js';

// One flex pass over one container. It allocates nothing in the steady
// state: the per-child values live in module-level typed arrays that grow on
// demand and are reused by every pass, and the children are reached through
// an index array (`order`), sorted by `flexOrder` only when a child has one.
// A prop is written only when it must be, so a relayout that moves nothing
// writes nothing (and starts no transition). A prop with a transition reads
// back its current, animated value, not its target, so for those the last
// value this engine wrote is kept on the node (`_flexX`, `_flexY`, `_flexW`,
// `_flexH`) and the write is skipped only when both match.

/** Slot flags. */
const FROM_RECORD = 1; // the main size came from the flexGrow record (B8)
const GROWN = 2;
const SHRUNK = 4;

/** A child's resolved `alignSelf || alignItems`. */
const ALIGN_NONE = 0;
const ALIGN_START = 1;
const ALIGN_CENTER = 2;
const ALIGN_END = 3;

let capacity = 0;
let childIndex = new Int32Array(0); // slot -> index in node.children
let order = new Int32Array(0); // layout position -> slot
let flags = new Uint8Array(0);
let mainSize = new Float64Array(0);
let mainRead = new Float64Array(0); // the main size read from the child
let ownSize = new Float64Array(0); // the size before flexGrow (B8)
let marginStart = new Float64Array(0);
let marginEnd = new Float64Array(0);
let totalMain = new Float64Array(0);
let crossSize = new Float64Array(0);
let marginCrossStart = new Float64Array(0);
let marginCrossEnd = new Float64Array(0);
let growFactor = new Float64Array(0);
let shrinkFactor = new Float64Array(0);
let orderKey = new Float64Array(0);
let lineStart = new Float64Array(0);
let mainPos = new Float64Array(0);
let alignCode = new Uint8Array(0);

function ensureCapacity(n: number): void {
  if (n <= capacity) {
    return;
  }
  let c = capacity * 2;
  if (c < n) {
    c = n < 16 ? 16 : n;
  }
  capacity = c;
  childIndex = new Int32Array(c);
  order = new Int32Array(c);
  flags = new Uint8Array(c);
  mainSize = new Float64Array(c);
  mainRead = new Float64Array(c);
  ownSize = new Float64Array(c);
  marginStart = new Float64Array(c);
  marginEnd = new Float64Array(c);
  totalMain = new Float64Array(c);
  crossSize = new Float64Array(c);
  marginCrossStart = new Float64Array(c);
  marginCrossEnd = new Float64Array(c);
  growFactor = new Float64Array(c);
  shrinkFactor = new Float64Array(c);
  orderKey = new Float64Array(c);
  lineStart = new Float64Array(c);
  mainPos = new Float64Array(c);
  alignCode = new Uint8Array(c);
}

/** A `padding`/`margin` side from a number or a 2-4 value array. */
export function getArrayValue(
  val: number | number[] | undefined,
  index: number,
  defaultValue: number = 0,
): number {
  if (val === undefined) return defaultValue;
  if (typeof val === 'number') return val;

  const len = val.length;
  let result;
  if (len === 2) {
    result = index % 2 === 0 ? val[0] : val[1];
  } else if (len === 3) {
    result = index === 0 ? val[0] : index === 2 ? val[2] : val[1];
  } else {
    result = val[index];
  }
  return result ?? defaultValue;
}

/**
 * Whether a write of `name` (or its alias) on `c` starts a transition, as
 * ElementNode's animatable setter decides it.
 */
function animates(c: ElementNode, name: string, alias: string): boolean {
  const t = c.transition;
  if (!t || c.rendered !== true || !Config.animationsEnabled) {
    return false;
  }
  return t === true || !!t[name] || !!t[alias];
}

function setSize(c: ElementNode, isWidth: boolean, v: number): void {
  if (isWidth) {
    c.width = v;
  } else {
    c.height = v;
  }
}

/**
 * Writes a size the engine computed, unless `current` (read from the node)
 * is already `v` and, with a transition on it (`current` is then the
 * animated value), `v` is also what this engine last wrote. Returns whether
 * it wrote. Callers test `current !== v || c.transition` first, so the
 * common no-write case passes no doubles to a call.
 */
function writeSize(
  c: ElementNode,
  isWidth: boolean,
  current: number,
  v: number,
): boolean {
  const animated = c.transition
    ? isWidth
      ? animates(c, 'w', 'width')
      : animates(c, 'h', 'height')
    : false;
  if (current === v && (!animated || (isWidth ? c._flexW : c._flexH) === v)) {
    return false;
  }
  if (animated) {
    if (isWidth) {
      c._flexW = v;
    } else {
      c._flexH = v;
    }
  }
  setSize(c, isWidth, v);
  return true;
}

/** Writes x or y as writeSize writes a size. */
function setPos(c: ElementNode, isX: boolean, v: number): void {
  if (isX) {
    const animated = c.transition ? animates(c, 'x', 'x') : false;
    if (c.x === v && (!animated || c._flexX === v)) return;
    if (animated) c._flexX = v;
    c.x = v;
  } else {
    const animated = c.transition ? animates(c, 'y', 'y') : false;
    if (c.y === v && (!animated || c._flexY === v)) return;
    if (animated) c._flexY = v;
    c.y = v;
  }
}

let passDepth = 0;

/**
 * Lays out the children of a `display: 'flex'` container. Returns true when
 * the container's own size changed, so its parent must be laid out again.
 */
export default function (node: ElementNode): boolean {
  if (passDepth === 0) {
    passDepth = 1;
    try {
      return layout(node);
    } finally {
      passDepth = 0;
    }
  }
  return nestedLayout(node);
}

/**
 * A pass started while another runs (from an app callback a write fired,
 * such as onAnimation calling updateLayout): it gets its own scratch, so
 * the outer pass's is intact when it resumes. Allocates; not the hot path.
 */
function nestedLayout(node: ElementNode): boolean {
  const sCapacity = capacity;
  const sChildIndex = childIndex;
  const sOrder = order;
  const sFlags = flags;
  const sMainSize = mainSize;
  const sMainRead = mainRead;
  const sOwnSize = ownSize;
  const sMarginStart = marginStart;
  const sMarginEnd = marginEnd;
  const sTotalMain = totalMain;
  const sCrossSize = crossSize;
  const sMarginCrossStart = marginCrossStart;
  const sMarginCrossEnd = marginCrossEnd;
  const sGrowFactor = growFactor;
  const sShrinkFactor = shrinkFactor;
  const sOrderKey = orderKey;
  const sLineStart = lineStart;
  const sMainPos = mainPos;
  const sAlignCode = alignCode;
  capacity = 0;
  passDepth++;
  try {
    return layout(node);
  } finally {
    passDepth--;
    capacity = sCapacity;
    childIndex = sChildIndex;
    order = sOrder;
    flags = sFlags;
    mainSize = sMainSize;
    mainRead = sMainRead;
    ownSize = sOwnSize;
    marginStart = sMarginStart;
    marginEnd = sMarginEnd;
    totalMain = sTotalMain;
    crossSize = sCrossSize;
    marginCrossStart = sMarginCrossStart;
    marginCrossEnd = sMarginCrossEnd;
    growFactor = sGrowFactor;
    shrinkFactor = sShrinkFactor;
    orderKey = sOrderKey;
    lineStart = sLineStart;
    mainPos = sMainPos;
    alignCode = sAlignCode;
  }
}

function layout(node: ElementNode): boolean {
  const children = node.children;
  const numChildren = children.length;

  if (numChildren === 0) {
    return false;
  }

  const direction = node.flexDirection || 'row';
  const isRow = direction === 'row' || direction === 'row-reverse';
  const isReverse =
    direction === 'row-reverse' || direction === 'column-reverse';

  // padding order: Top, Right, Bottom, Left
  const nodePadding = node.padding;
  const paddingTop = node.paddingTop ?? getArrayValue(nodePadding, 0);
  const paddingRight = node.paddingRight ?? getArrayValue(nodePadding, 1);
  const paddingBottom = node.paddingBottom ?? getArrayValue(nodePadding, 2);
  const paddingLeft = node.paddingLeft ?? getArrayValue(nodePadding, 3);

  const paddingStart = isRow ? paddingLeft : paddingTop;
  const paddingEnd = isRow ? paddingRight : paddingBottom;
  const paddingCrossStart = isRow ? paddingTop : paddingLeft;
  const paddingCrossEnd = isRow ? paddingBottom : paddingRight;
  const nodePaddingTotal = paddingStart + paddingEnd;

  const flexWrap = node.flexWrap;
  const isWrapReverse = flexWrap === 'wrap-reverse';
  // B10: wrap-reverse wraps too.
  const wrapping = flexWrap === 'wrap' || isWrapReverse;
  const align = node.alignItems || (flexWrap ? 'flexStart' : undefined);

  ensureCapacity(numChildren);

  let n = 0;
  let hasOrder = false;
  let totalFlexGrow = 0;
  let totalFlexShrink = 0;
  let sizeWork = false;

  for (let i = 0; i < numChildren; i++) {
    const c = children[i]!;

    // B5: a child that is not a flex item is skipped before the text check,
    // so an unsized text with flexItem={false} does not block the pass.
    if (isTextNode(c) || c.flexItem === false) {
      continue;
    }

    const w = c.width;
    const h = c.height;
    if (isElementText(c) && c.text && !(w || h)) {
      return false; // specific text layout constraint
    }

    const flexOrder = c.flexOrder;
    if (flexOrder !== undefined) {
      hasOrder = true;
    }

    const flexGrow = c.flexGrow;
    const grow = flexGrow !== undefined && flexGrow > 0 ? flexGrow : 0;
    totalFlexGrow += grow;

    const flexShrink = c.flexShrink;
    if (flexShrink !== undefined && flexShrink > 0) {
      totalFlexShrink += flexShrink;
    }

    let main = isRow ? w : h;
    let cross = isRow ? h : w;
    const minMain = isRow ? c.minWidth : c.minHeight;
    if (minMain && (main || 0) < minMain) {
      setSize(c as ElementNode, isRow, minMain);
      main = isRow ? c.width : c.height;
    }
    const minCross = isRow ? c.minHeight : c.minWidth;
    if (minCross && (cross || 0) < minCross) {
      setSize(c as ElementNode, !isRow, minCross);
      cross = isRow ? c.height : c.width;
    }

    // B8: flexGrow starts from the item's own size, not from the size the
    // last pass grew it to. The record holds both; a size written since
    // (anything but the grown one) is the new own size. With a transition
    // the read is the animated value, so the record is kept as it is.
    const read = main || 0;
    let own = read;
    let flag = 0;
    const grown = c._flexGrown;
    if (grown !== undefined) {
      if (
        grow > 0 &&
        (read === grown ||
          (isRow
            ? animates(c as ElementNode, 'w', 'width')
            : animates(c as ElementNode, 'h', 'height')))
      ) {
        own = c._flexBase!;
        flag = FROM_RECORD;
        sizeWork = true;
      } else {
        c._flexGrown = undefined;
      }
    }

    const flexBasis = c.flexBasis;
    const base =
      flexBasis === undefined || flexBasis === 'auto'
        ? own
        : Math.max(flexBasis as number, minMain || 0);

    // index mappings for margins: Top: 0, Right: 1, Bottom: 2, Left: 3
    const margin = c.margin;
    let mStart: number;
    let mEnd: number;
    let mCrossStart: number;
    let mCrossEnd: number;
    if (isRow) {
      mStart = c.marginLeft || getArrayValue(margin, 3);
      mEnd = c.marginRight || getArrayValue(margin, 1);
      mCrossStart = c.marginTop || getArrayValue(margin, 0);
      mCrossEnd = c.marginBottom || getArrayValue(margin, 2);
    } else {
      mStart = c.marginTop || getArrayValue(margin, 0);
      mEnd = c.marginBottom || getArrayValue(margin, 2);
      mCrossStart = c.marginLeft || getArrayValue(margin, 3);
      mCrossEnd = c.marginRight || getArrayValue(margin, 1);
    }

    const k = n++;
    childIndex[k] = i;
    flags[k] = flag;
    mainSize[k] = base;
    mainRead[k] = read;
    ownSize[k] = own;
    marginStart[k] = mStart;
    marginEnd[k] = mEnd;
    totalMain[k] = base + mStart + mEnd;
    crossSize[k] = cross || 0;
    marginCrossStart[k] = mCrossStart;
    marginCrossEnd[k] = mCrossEnd;
    growFactor[k] = grow;
    shrinkFactor[k] = flexShrink || 0;
    orderKey[k] = flexOrder || 0;
    const alignSelf = c.alignSelf || align;
    alignCode[k] =
      alignSelf === 'flexStart'
        ? ALIGN_START
        : alignSelf === 'center'
          ? ALIGN_CENTER
          : alignSelf === 'flexEnd'
            ? ALIGN_END
            : ALIGN_NONE;
  }

  if (n === 0) {
    return false;
  }

  for (let p = 0; p < n; p++) {
    order[p] = p;
  }
  if (hasOrder) {
    // Stable insertion sort by flexOrder (a missing one counts as 0).
    for (let p = 1; p < n; p++) {
      const k = order[p]!;
      const key = orderKey[k]!;
      let q = p - 1;
      while (q >= 0 && orderKey[order[q]!]! > key) {
        order[q + 1] = order[q]!;
        q--;
      }
      order[q + 1] = k;
    }
  }
  // Apply reverse layout ordering
  if (isReverse || node.direction === 'rtl') {
    for (let lo = 0, hi = n - 1; lo < hi; lo++, hi--) {
      const t = order[lo]!;
      order[lo] = order[hi]!;
      order[hi] = t;
    }
  }

  const nodeWidth = node.width;
  const nodeHeight = node.height;
  const nodeMain = isRow ? nodeWidth : nodeHeight;
  const containerSize = Math.max(
    nodeMain || 0,
    (isRow ? node.minWidth : node.minHeight) || 0,
    0,
  );
  let containerCrossSize = Math.max(
    (isRow ? nodeHeight : nodeWidth) || 0,
    (isRow ? node.minHeight : node.minWidth) || 0,
    0,
  );
  const gap = node.gap || 0;
  const justify = node.justifyContent || 'flexStart';
  let containerUpdated = false;

  let sumOfFlexBaseSizesWithMargins = 0;
  for (let p = 0; p < n; p++) {
    sumOfFlexBaseSizesWithMargins += totalMain[order[p]!]!;
  }

  if ((totalFlexGrow > 0 || totalFlexShrink > 0) && n > 1) {
    if (!node.flexBoundary) {
      node.flexBoundary = 'fixed';
    }

    const availableSpace =
      containerSize - sumOfFlexBaseSizesWithMargins - gap * (n - 1);

    if (availableSpace > 0 && totalFlexGrow > 0) {
      for (let p = 0; p < n; p++) {
        const k = order[p]!;
        const grow = growFactor[k]!;
        if (grow > 0) {
          const newMainSize =
            mainSize[k]! + (grow / totalFlexGrow) * availableSpace;
          mainSize[k] = newMainSize;
          totalMain[k] = newMainSize + marginStart[k]! + marginEnd[k]!;
          flags[k] = flags[k]! | GROWN;
        }
      }
      sizeWork = true;
    } else if (availableSpace < 0 && totalFlexShrink > 0) {
      // Flex Shrink Phase
      let totalScaledShrinkFactor = 0;
      for (let p = 0; p < n; p++) {
        const k = order[p]!;
        totalScaledShrinkFactor += shrinkFactor[k]! * mainSize[k]!;
      }

      if (totalScaledShrinkFactor > 0) {
        for (let p = 0; p < n; p++) {
          const k = order[p]!;
          const shrink = shrinkFactor[k]!;
          if (shrink > 0) {
            const shrinkRatio =
              (shrink * mainSize[k]!) / totalScaledShrinkFactor;
            let newMainSize =
              mainSize[k]! - shrinkRatio * Math.abs(availableSpace);

            // Constrain by min width/height
            const c = children[childIndex[k]!] as ElementNode;
            const minBound = (isRow ? c.minWidth : c.minHeight) || 0;
            if (newMainSize < minBound) {
              newMainSize = minBound;
            }

            mainSize[k] = newMainSize;
            totalMain[k] = newMainSize + marginStart[k]! + marginEnd[k]!;
            flags[k] = flags[k]! | SHRUNK;
            sizeWork = true;
          }
        }
      }
    }
  }

  // Whether this pass changed a child's size: updateLayout then lays the
  // flex ones out again (`_containsFlexGrow`). A relayout that changes none
  // asks for nothing, so a grown child that sizes itself to its content is
  // not shrunk and regrown on every relayout.
  let resized = false;
  if (sizeWork) {
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      const flag = flags[k]!;
      if (flag === 0) {
        continue;
      }
      const c = children[childIndex[k]!] as ElementNode;
      const read = mainRead[k]!;
      if ((flag & GROWN) !== 0) {
        const size = mainSize[k]!;
        if (
          (size !== read || c.transition) &&
          writeSize(c, isRow, read, size)
        ) {
          resized = true;
        }
        const own = ownSize[k]!;
        if (c._flexBase !== own) c._flexBase = own;
        if (c._flexGrown !== size) c._flexGrown = size;
      } else if ((flag & SHRUNK) !== 0) {
        const size = mainSize[k]!;
        if (
          (size !== read || c.transition) &&
          writeSize(c, isRow, read, size)
        ) {
          resized = true;
        }
        if ((flag & FROM_RECORD) !== 0) c._flexGrown = undefined;
      } else {
        // B8: grown by an earlier pass, not by this one: back to its own size.
        const size = ownSize[k]!;
        if (
          (size !== read || c.transition) &&
          writeSize(c, isRow, read, size)
        ) {
          resized = true;
        }
        c._flexGrown = undefined;
      }
    }
  }
  if (resized) {
    node._containsFlexGrow = true;
  } else if (node._containsFlexGrow) {
    node._containsFlexGrow = null;
  }

  let totalItemSize = 0;
  if (
    justify === 'center' ||
    justify === 'spaceBetween' ||
    justify === 'spaceEvenly' ||
    justify === 'spaceAround'
  ) {
    for (let p = 0; p < n; p++) {
      totalItemSize += totalMain[order[p]!]!;
    }
  }

  // Decided before the row's height is fitted below (as before 1.7).
  const crossAlign = containerCrossSize > 0;

  if (isRow && node._calcHeight && !node.flexCrossBoundary) {
    let maxHeight = 0;
    for (let p = 0; p < n; p++) {
      const size = crossSize[order[p]!]!;
      if (size > maxHeight) maxHeight = size;
    }
    const newHeight = maxHeight || nodeHeight;
    if (
      (newHeight !== nodeHeight || node.transition) &&
      writeSize(node, false, nodeHeight, newHeight)
    ) {
      containerUpdated = true;
      containerCrossSize = newHeight;
    }
  }

  // B7: center and flexEnd align inside the padded box, not the full size.
  const crossBox = containerCrossSize - paddingCrossStart - paddingCrossEnd;

  // Main-axis positions go to mainPos; one loop below writes them with the
  // cross-axis ones.
  const wrapped = justify === 'flexStart' && wrapping;
  let placed = true;
  let currentPos = paddingStart;
  let line = paddingCrossStart; // wrap: the start of the last line
  let lineSize = 0;
  if (wrapped) {
    lineSize = crossSize[order[0]!]!;
    const crossGap = isRow ? (node.columnGap ?? gap) : (node.rowGap ?? gap);
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      if (
        currentPos + totalMain[k]! > containerSize &&
        currentPos > paddingStart
      ) {
        currentPos = paddingStart;
        line += lineSize + crossGap;
      }
      mainPos[k] = currentPos + marginStart[k]!;
      currentPos += totalMain[k]! + gap;
      lineStart[k] = line;
    }
  } else if (justify === 'flexStart') {
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      mainPos[k] = currentPos + marginStart[k]!;
      currentPos += totalMain[k]! + gap;
    }
  } else if (justify === 'flexEnd') {
    currentPos = containerSize - paddingEnd;
    for (let p = n - 1; p >= 0; p--) {
      const k = order[p]!;
      mainPos[k] = currentPos - mainSize[k]! - marginEnd[k]!;
      currentPos -= totalMain[k]! + gap;
    }
  } else if (
    justify === 'center' ||
    justify === 'spaceBetween' ||
    justify === 'spaceAround' ||
    justify === 'spaceEvenly'
  ) {
    let space = gap;
    if (justify === 'center') {
      // B6: centred inside the padded box.
      currentPos =
        (containerSize -
          paddingStart -
          paddingEnd -
          (totalItemSize + gap * (n - 1))) /
          2 +
        paddingStart;
    } else if (justify === 'spaceBetween') {
      space =
        n > 1
          ? (containerSize - totalItemSize - nodePaddingTotal) / (n - 1)
          : 0;
    } else if (justify === 'spaceAround') {
      space = (containerSize - totalItemSize - nodePaddingTotal) / n;
      currentPos = paddingStart + space / 2;
    } else {
      space = (containerSize - totalItemSize - nodePaddingTotal) / (n + 1);
      currentPos = space + paddingStart;
    }
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      mainPos[k] = currentPos + marginStart[k]!;
      currentPos += totalMain[k]! + space;
    }
  } else {
    placed = false; // an unknown justifyContent places nothing
  }

  if (placed) {
    // Cross axis. Wrapped: from each item's line start (B9: also when the
    // container has no cross size, then against the line; B10: lines
    // mirrored for wrap-reverse), center and flexEnd against the cross
    // size less its padding (B7), as before 1.7. Otherwise from the cross
    // padding, only when the container had a cross size.
    const alignAll = wrapped || crossAlign;
    const alignSize = wrapped && !crossAlign ? lineSize : crossBox;
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      const c = children[childIndex[k]!] as ElementNode;
      setPos(c, isRow, mainPos[k]!);
      const a = alignCode[k]!;
      if (alignAll && a !== ALIGN_NONE) {
        const start = wrapped
          ? isWrapReverse
            ? line + paddingCrossStart - lineStart[k]!
            : lineStart[k]!
          : paddingCrossStart;
        setPos(
          c,
          !isRow,
          a === ALIGN_START
            ? start + marginCrossStart[k]!
            : a === ALIGN_CENTER
              ? start + (alignSize - crossSize[k]!) / 2 + marginCrossStart[k]!
              : start + alignSize - crossSize[k]! - marginCrossEnd[k]!,
        );
      }
    }
  }

  if (wrapped) {
    const finalCrossSize = line + lineSize + paddingCrossEnd;
    if (isRow) {
      const height = node.height;
      if (
        (height !== finalCrossSize || node.transition) &&
        writeSize(node, false, height, finalCrossSize)
      ) {
        node.preFlexheight = height;
        containerUpdated = true;
      }
    } else {
      const width = node.width;
      if (
        (width !== finalCrossSize || node.transition) &&
        writeSize(node, true, width, finalCrossSize)
      ) {
        node.preFlexwidth = width;
        containerUpdated = true;
      }
    }
  } else if (justify === 'flexStart' && node.flexBoundary !== 'fixed') {
    // Update container size
    let calculatedSize = currentPos - gap + paddingEnd;
    const minSize = (isRow ? node.minWidth : node.minHeight) || 0;
    if (calculatedSize < minSize) {
      calculatedSize = minSize;
    }
    const current = nodeMain || 0;
    if (
      (calculatedSize !== current || node.transition) &&
      writeSize(node, isRow, current, calculatedSize)
    ) {
      if (isRow) {
        node.preFlexwidth = containerSize;
      } else {
        node.preFlexheight = containerSize;
      }
      return true;
    }
  }

  return containerUpdated;
}
