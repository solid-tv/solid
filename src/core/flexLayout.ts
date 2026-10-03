import { type ElementNode } from './elementNode.js';
import { isTextNode, isElementText } from './utils.js';

// One flex pass over one container. It allocates nothing in the steady
// state: the per-child values live in module-level typed arrays that grow on
// demand and are reused by every pass, and the children are reached through
// an index array (`order`), sorted by `flexOrder` only when a child has one.
// A prop is written only when its value changes, so a relayout that moves
// nothing writes nothing (and starts no transition).

/** Slot flags. */
const FROM_RECORD = 1; // the main size came from the flexGrow record (B8)
const GROWN = 2;
const SHRUNK = 4;

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
}

function getArrayValue(
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

function setSize(c: ElementNode, isWidth: boolean, v: number): void {
  if (isWidth) {
    c.width = v;
  } else {
    c.height = v;
  }
}

function setPos(c: ElementNode, isX: boolean, v: number): void {
  if (isX) {
    if (c.x !== v) c.x = v;
  } else if (c.y !== v) {
    c.y = v;
  }
}

/**
 * Places child `c` (slot `k`) on the cross axis of a line that starts at
 * `start` and is `size` long.
 */
function alignCross(
  c: ElementNode,
  k: number,
  isRow: boolean,
  align: string | undefined,
  start: number,
  size: number,
): void {
  const alignSelf = c.alignSelf || align;
  if (alignSelf === 'flexStart') {
    setPos(c, !isRow, start + marginCrossStart[k]!);
  } else if (alignSelf === 'center') {
    setPos(
      c,
      !isRow,
      start + (size - crossSize[k]!) / 2 + marginCrossStart[k]!,
    );
  } else if (alignSelf === 'flexEnd') {
    setPos(c, !isRow, start + size - crossSize[k]! - marginCrossEnd[k]!);
  }
}

/**
 * Lays out the children of a `display: 'flex'` container. Returns true when
 * the container's own size changed, so its parent must be laid out again.
 */
export default function (node: ElementNode): boolean {
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
    // (anything but the grown one) is the new own size.
    const read = main || 0;
    let own = read;
    let flag = 0;
    const grown = c._flexGrown;
    if (grown !== undefined) {
      if (grow > 0 && read === grown) {
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
  const flexWrap = node.flexWrap;
  const isWrapReverse = flexWrap === 'wrap-reverse';
  // B10: wrap-reverse wraps too.
  const wrapping = flexWrap === 'wrap' || isWrapReverse;
  const gap = node.gap || 0;
  const justify = node.justifyContent || 'flexStart';
  const align = node.alignItems || (flexWrap ? 'flexStart' : undefined);
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
      node._containsFlexGrow = node._containsFlexGrow ? null : true;
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
      node._containsFlexGrow = node._containsFlexGrow ? null : true;
    } else if (node._containsFlexGrow) {
      node._containsFlexGrow = null;
    }
  }

  if (sizeWork) {
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      const flag = flags[k]!;
      if (flag === 0) {
        continue;
      }
      const c = children[childIndex[k]!] as ElementNode;
      if ((flag & GROWN) !== 0) {
        const size = mainSize[k]!;
        if (size !== mainRead[k]) setSize(c, isRow, size);
        c._flexBase = ownSize[k];
        c._flexGrown = size;
      } else if ((flag & SHRUNK) !== 0) {
        const size = mainSize[k]!;
        if (size !== mainRead[k]) setSize(c, isRow, size);
        if ((flag & FROM_RECORD) !== 0) c._flexGrown = undefined;
      } else {
        // B8: grown by an earlier pass, not by this one: back to its own size.
        const size = ownSize[k]!;
        if (size !== mainRead[k]) setSize(c, isRow, size);
        c._flexGrown = undefined;
      }
    }
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
    if (newHeight !== nodeHeight) {
      containerUpdated = true;
      node.height = containerCrossSize = newHeight;
    }
  }

  // B7: center and flexEnd align inside the padded box, not the full size.
  const crossBox = containerCrossSize - paddingCrossStart - paddingCrossEnd;

  let currentPos = paddingStart;
  if (justify === 'flexStart') {
    if (wrapping) {
      const lineSize = crossSize[order[0]!]!;
      const crossGap = isRow ? (node.columnGap ?? gap) : (node.rowGap ?? gap);
      let line = paddingCrossStart;

      for (let p = 0; p < n; p++) {
        const k = order[p]!;
        if (
          currentPos + totalMain[k]! > containerSize &&
          currentPos > paddingStart
        ) {
          currentPos = paddingStart;
          line += lineSize + crossGap;
        }
        setPos(
          children[childIndex[k]!] as ElementNode,
          isRow,
          currentPos + marginStart[k]!,
        );
        currentPos += totalMain[k]! + gap;
        lineStart[k] = line;
      }

      // B9: items are placed on their line even when the container has no
      // cross size. B7: center and flexEnd align inside the line. B10:
      // wrap-reverse mirrors the lines, so the first one is at the end.
      for (let p = 0; p < n; p++) {
        const k = order[p]!;
        alignCross(
          children[childIndex[k]!] as ElementNode,
          k,
          isRow,
          align,
          isWrapReverse
            ? line + paddingCrossStart - lineStart[k]!
            : lineStart[k]!,
          lineSize,
        );
      }

      const finalCrossSize = line + lineSize + paddingCrossEnd;
      if (isRow) {
        const height = node.height;
        if (height !== finalCrossSize) {
          node.preFlexheight = height;
          node.height = finalCrossSize;
          containerUpdated = true;
        }
      } else {
        const width = node.width;
        if (width !== finalCrossSize) {
          node.preFlexwidth = width;
          node.width = finalCrossSize;
          containerUpdated = true;
        }
      }
    } else {
      for (let p = 0; p < n; p++) {
        const k = order[p]!;
        const c = children[childIndex[k]!] as ElementNode;
        setPos(c, isRow, currentPos + marginStart[k]!);
        currentPos += totalMain[k]! + gap;
        if (crossAlign) {
          alignCross(c, k, isRow, align, paddingCrossStart, crossBox);
        }
      }
    }

    // Update container size
    if (node.flexBoundary !== 'fixed' && !wrapping) {
      let calculatedSize = currentPos - gap + paddingEnd;
      const minSize = (isRow ? node.minWidth : node.minHeight) || 0;
      if (calculatedSize < minSize) {
        calculatedSize = minSize;
      }
      if (calculatedSize !== (nodeMain || 0)) {
        if (isRow) {
          node.preFlexwidth = containerSize;
        } else {
          node.preFlexheight = containerSize;
        }
        setSize(node, isRow, calculatedSize);
        return true;
      }
    }
  } else if (justify === 'flexEnd') {
    currentPos = containerSize - paddingEnd;
    for (let p = n - 1; p >= 0; p--) {
      const k = order[p]!;
      const c = children[childIndex[k]!] as ElementNode;
      setPos(c, isRow, currentPos - mainSize[k]! - marginEnd[k]!);
      currentPos -= totalMain[k]! + gap;
      if (crossAlign) {
        alignCross(c, k, isRow, align, paddingCrossStart, crossBox);
      }
    }
  } else if (justify === 'center') {
    // B6: centred inside the padded box.
    currentPos =
      (containerSize -
        paddingStart -
        paddingEnd -
        (totalItemSize + gap * (n - 1))) /
        2 +
      paddingStart;
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      const c = children[childIndex[k]!] as ElementNode;
      setPos(c, isRow, currentPos + marginStart[k]!);
      currentPos += totalMain[k]! + gap;
      if (crossAlign) {
        alignCross(c, k, isRow, align, paddingCrossStart, crossBox);
      }
    }
  } else if (justify === 'spaceBetween') {
    const spaceBetween =
      n > 1 ? (containerSize - totalItemSize - nodePaddingTotal) / (n - 1) : 0;
    currentPos = paddingStart;
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      const c = children[childIndex[k]!] as ElementNode;
      setPos(c, isRow, currentPos + marginStart[k]!);
      currentPos += totalMain[k]! + spaceBetween;
      if (crossAlign) {
        alignCross(c, k, isRow, align, paddingCrossStart, crossBox);
      }
    }
  } else if (justify === 'spaceAround') {
    const spaceAround = (containerSize - totalItemSize - nodePaddingTotal) / n;
    currentPos = paddingStart + spaceAround / 2;
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      const c = children[childIndex[k]!] as ElementNode;
      setPos(c, isRow, currentPos + marginStart[k]!);
      currentPos += totalMain[k]! + spaceAround;
      if (crossAlign) {
        alignCross(c, k, isRow, align, paddingCrossStart, crossBox);
      }
    }
  } else if (justify === 'spaceEvenly') {
    const spaceEvenly =
      (containerSize - totalItemSize - nodePaddingTotal) / (n + 1);
    currentPos = spaceEvenly + paddingStart;
    for (let p = 0; p < n; p++) {
      const k = order[p]!;
      const c = children[childIndex[k]!] as ElementNode;
      setPos(c, isRow, currentPos + marginStart[k]!);
      currentPos += totalMain[k]! + spaceEvenly;
      if (crossAlign) {
        alignCross(c, k, isRow, align, paddingCrossStart, crossBox);
      }
    }
  }

  return containerUpdated;
}
