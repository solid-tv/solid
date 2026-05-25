import { type ElementNode } from './elementNode.js';

let processableChildrenIndices = new Int32Array(256);
let childMainSizes = new Float32Array(256);
let childMarginStarts = new Float32Array(256);
let childMarginEnds = new Float32Array(256);
let childTotalMainSizes = new Float32Array(256);
let childCrossSizes = new Float32Array(256);
let childMarginCrossStarts = new Float32Array(256);
let childMarginCrossEnds = new Float32Array(256);

function ensureCapacity(size: number) {
  const newSize = Math.max(processableChildrenIndices.length * 2, size);
  processableChildrenIndices = new Int32Array(newSize);
  childMainSizes = new Float32Array(newSize);
  childMarginStarts = new Float32Array(newSize);
  childMarginEnds = new Float32Array(newSize);
  childTotalMainSizes = new Float32Array(newSize);
  childCrossSizes = new Float32Array(newSize);
  childMarginCrossStarts = new Float32Array(newSize);
  childMarginCrossEnds = new Float32Array(newSize);
}

export default function (node: ElementNode): boolean {
  const direction = node.flexDirection || 'row';
  const isRow = direction === 'row' || direction === 'row-reverse';
  const isReverse =
    direction === 'row-reverse' || direction === 'column-reverse';
  const dimension = isRow ? 'width' : 'height';
  const crossDimension = isRow ? 'height' : 'width';

  // padding order: Top, Right, Bottom, Left
  const nodePadding = node.padding;
  let pTop = 0,
    pRight = 0,
    pBottom = 0,
    pLeft = 0;
  if (nodePadding !== undefined) {
    if (typeof nodePadding === 'number') {
      pTop = pRight = pBottom = pLeft = nodePadding;
    } else {
      const len = nodePadding.length;
      if (len === 2) {
        pTop = pBottom = nodePadding[0] ?? 0;
        pRight = pLeft = nodePadding[1] ?? 0;
      } else if (len === 3) {
        pTop = nodePadding[0] ?? 0;
        pRight = pLeft = nodePadding[1] ?? 0;
        pBottom = nodePadding[2] ?? 0;
      } else if (len > 0) {
        pTop = nodePadding[0] ?? 0;
        pRight = nodePadding[1] ?? 0;
        pBottom = nodePadding[2] ?? 0;
        pLeft = nodePadding[3] ?? 0;
      }
    }
  }

  const paddingTop = node.paddingTop ?? pTop;
  const paddingRight = node.paddingRight ?? pRight;
  const paddingBottom = node.paddingBottom ?? pBottom;
  const paddingLeft = node.paddingLeft ?? pLeft;

  const paddingStart = isRow ? paddingLeft : paddingTop;
  const paddingEnd = isRow ? paddingRight : paddingBottom;
  const paddingCrossStart = isRow ? paddingTop : paddingLeft;
  const paddingCrossEnd = isRow ? paddingBottom : paddingRight;
  const nodePaddingTotal = paddingStart + paddingEnd;

  const minDimension = isRow ? 'minWidth' : 'minHeight';
  const crossMinDimension = isRow ? 'minHeight' : 'minWidth';

  const children = node.children;
  const numChildren = children.length;

  if (numChildren === 0) {
    return false;
  }

  if (numChildren > processableChildrenIndices.length) {
    ensureCapacity(numChildren);
  }

  let numProcessedChildren = 0;
  let hasOrder = false;
  let totalFlexGrow = 0;
  let totalFlexShrink = 0;

  for (let i = 0; i < numChildren; i++) {
    const c = children[i]!;
    const type = c._type;

    if (type === 'textNode' && (c as any).text && !(c.width || c.height)) {
      return false; // specific text layout constraint
    }

    if ((type as string) === 'text' || c.flexItem === false) {
      continue;
    }

    if (c.flexOrder !== undefined) {
      hasOrder = true;
    }

    const flexGrow = c.flexGrow;
    if (flexGrow !== undefined && flexGrow > 0) {
      totalFlexGrow += flexGrow;
    }

    const flexShrink = c.flexShrink;
    if (flexShrink !== undefined && flexShrink > 0) {
      totalFlexShrink += flexShrink;
    }

    const cMinDim = c[minDimension];
    if (cMinDim) {
      const cDim = c[dimension] || 0;
      if (cDim < cMinDim) {
        c[dimension] = cMinDim;
      }
    }

    const cCrossMinDim = c[crossMinDimension];
    if (cCrossMinDim) {
      const cCrossDim = c[crossDimension] || 0;
      if (cCrossDim < cCrossMinDim) {
        c[crossDimension] = cCrossMinDim;
      }
    }

    processableChildrenIndices[numProcessedChildren++] = i;
  }

  if (numProcessedChildren === 0) {
    return false;
  }

  if (hasOrder) {
    const indices = processableChildrenIndices.subarray(
      0,
      numProcessedChildren,
    );
    indices.sort((aIdx, bIdx) => {
      const a = children[aIdx] as ElementNode;
      const b = children[bIdx] as ElementNode;
      return (a.flexOrder || 0) - (b.flexOrder || 0);
    });
  }

  if (isReverse || node.direction === 'rtl') {
    const indices = processableChildrenIndices.subarray(
      0,
      numProcessedChildren,
    );
    indices.reverse();
  }

  const prop = isRow ? 'x' : 'y';
  const crossProp = isRow ? 'y' : 'x';
  const containerSize = Math.max(
    node[dimension] || 0,
    node[minDimension] || 0,
    0,
  );
  let containerCrossSize = Math.max(
    node[crossDimension] || 0,
    node[crossMinDimension] || 0,
    0,
  );
  const isWrapReverse = node.flexWrap === 'wrap-reverse';
  const gap = node.gap || 0;
  const justify = node.justifyContent || 'flexStart';
  const align = node.alignItems || (node.flexWrap ? 'flexStart' : undefined);
  let containerUpdated = false;

  let sumOfFlexBaseSizesWithMargins = 0;

  for (let idx = 0; idx < numProcessedChildren; idx++) {
    const c = children[processableChildrenIndices[idx]!] as ElementNode;
    let mTop = 0,
      mRight = 0,
      mBottom = 0,
      mLeft = 0;
    const marginArray = c.margin;
    if (marginArray !== undefined) {
      if (typeof marginArray === 'number') {
        mTop = mRight = mBottom = mLeft = marginArray;
      } else {
        const len = marginArray.length;
        if (len === 2) {
          mTop = mBottom = marginArray[0] ?? 0;
          mRight = mLeft = marginArray[1] ?? 0;
        } else if (len === 3) {
          mTop = marginArray[0] ?? 0;
          mRight = mLeft = marginArray[1] ?? 0;
          mBottom = marginArray[2] ?? 0;
        } else if (len > 0) {
          mTop = marginArray[0] ?? 0;
          mRight = marginArray[1] ?? 0;
          mBottom = marginArray[2] ?? 0;
          mLeft = marginArray[3] ?? 0;
        }
      }
    }

    const marginStart = isRow ? c.marginLeft || mLeft : c.marginTop || mTop;
    const marginEnd = isRow
      ? c.marginRight || mRight
      : c.marginBottom || mBottom;
    const marginCrossStart = isRow
      ? c.marginTop || mTop
      : c.marginLeft || mLeft;
    const marginCrossEnd = isRow
      ? c.marginBottom || mBottom
      : c.marginRight || mRight;

    const flexBasis = c.flexBasis;
    const isBasisAuto = flexBasis === undefined || flexBasis === 'auto';
    let baseMainSize = 0;
    if (isBasisAuto) {
      baseMainSize = c[dimension] || 0;
    } else {
      const computedBasis = flexBasis as number;
      const minDimVal = c[minDimension] || 0;
      baseMainSize = computedBasis > minDimVal ? computedBasis : minDimVal;
    }

    childMainSizes[idx] = baseMainSize;
    childMarginStarts[idx] = marginStart;
    childMarginEnds[idx] = marginEnd;
    const totalMainSize = baseMainSize + marginStart + marginEnd;
    childTotalMainSizes[idx] = totalMainSize;
    childCrossSizes[idx] = c[crossDimension] || 0;
    childMarginCrossStarts[idx] = marginCrossStart;
    childMarginCrossEnds[idx] = marginCrossEnd;

    sumOfFlexBaseSizesWithMargins += totalMainSize;
  }

  let totalItemSize = sumOfFlexBaseSizesWithMargins;

  if ((totalFlexGrow > 0 || totalFlexShrink > 0) && numProcessedChildren > 1) {
    node.flexBoundary = node.flexBoundary || 'fixed';

    const totalGapSpace = gap * (numProcessedChildren - 1);
    const availableSpace =
      containerSize - sumOfFlexBaseSizesWithMargins - totalGapSpace;

    if (availableSpace > 0 && totalFlexGrow > 0) {
      let sizeAdded = 0;
      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        const flexGrowValue = c.flexGrow || 0;
        if (flexGrowValue > 0) {
          const shareOfSpace = (flexGrowValue / totalFlexGrow) * availableSpace;
          const newMainSize = childMainSizes[idx]! + shareOfSpace;
          c[dimension] = newMainSize;
          childMainSizes[idx] = newMainSize;
          childTotalMainSizes[idx] =
            newMainSize + childMarginStarts[idx]! + childMarginEnds[idx]!;
          sizeAdded += shareOfSpace;
        }
      }
      totalItemSize += sizeAdded;
      node._containsFlexGrow = node._containsFlexGrow ? null : true;
    } else if (availableSpace < 0 && totalFlexShrink > 0) {
      let totalScaledShrinkFactor = 0;
      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        const flexShrinkValue = c.flexShrink || 0;
        totalScaledShrinkFactor += flexShrinkValue * childMainSizes[idx]!;
      }

      if (totalScaledShrinkFactor > 0) {
        let sizeShrunk = 0;
        for (let idx = 0; idx < numProcessedChildren; idx++) {
          const c = children[processableChildrenIndices[idx]!] as ElementNode;
          const flexShrinkValue = c.flexShrink || 0;
          if (flexShrinkValue > 0) {
            const shrinkRatio =
              (flexShrinkValue * childMainSizes[idx]!) /
              totalScaledShrinkFactor;
            const sizeReduction = shrinkRatio * Math.abs(availableSpace);
            let newMainSize = childMainSizes[idx]! - sizeReduction;

            const minBound = c[minDimension] || 0;
            if (newMainSize < minBound) {
              newMainSize = minBound;
            }

            sizeShrunk += childMainSizes[idx]! - newMainSize;

            c[dimension] = newMainSize;
            childMainSizes[idx] = newMainSize;
            childTotalMainSizes[idx] =
              newMainSize + childMarginStarts[idx]! + childMarginEnds[idx]!;
          }
        }
        totalItemSize -= sizeShrunk;
      }
      node._containsFlexGrow = node._containsFlexGrow ? null : true;
    } else if (node._containsFlexGrow) {
      node._containsFlexGrow = null;
    }
  }

  if (isRow && node._calcHeight && !node.flexCrossBoundary) {
    let maxHeight = 0;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const crossSize = childCrossSizes[idx]!;
      if (crossSize > maxHeight) maxHeight = crossSize;
    }
    const newHeight = maxHeight || node.height;
    if (newHeight !== node.height) {
      containerUpdated = true;
      node.height = containerCrossSize = newHeight;
    }
  }

  const doCrossAlign = containerCrossSize
    ? (c: ElementNode, idx: number, crossCurrentPos: number = 0) => {
        const alignSelf = c.alignSelf || align;
        if (!alignSelf) {
          return;
        }
        if (alignSelf === 'flexStart') {
          c[crossProp] = crossCurrentPos + childMarginCrossStarts[idx]!;
        } else if (alignSelf === 'center') {
          c[crossProp] =
            crossCurrentPos +
            (containerCrossSize - childCrossSizes[idx]!) / 2 +
            childMarginCrossStarts[idx]!;
        } else if (alignSelf === 'flexEnd') {
          c[crossProp] =
            crossCurrentPos +
            containerCrossSize -
            childCrossSizes[idx]! -
            childMarginCrossEnds[idx]!;
        }
      }
    : (_c: ElementNode, _idx: number, _crossCurrentPos: number = 0) => {
        /* no-op */
      };

  let currentPos = paddingStart;
  if (justify === 'flexStart') {
    if (node.flexWrap === 'wrap') {
      const childCrossSizeVar = childCrossSizes[0]!;
      let crossCurrentPos = isWrapReverse
        ? containerCrossSize - paddingCrossEnd - childCrossSizeVar
        : paddingCrossStart;
      const crossGap = isRow ? (node.columnGap ?? gap) : (node.rowGap ?? gap);

      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        if (
          currentPos + childTotalMainSizes[idx]! > containerSize &&
          currentPos > paddingStart
        ) {
          currentPos = paddingStart;
          crossCurrentPos += isWrapReverse
            ? -(childCrossSizeVar + crossGap)
            : childCrossSizeVar + crossGap;
        }
        c[prop] = currentPos + childMarginStarts[idx]!;
        currentPos += childTotalMainSizes[idx]! + gap;
        doCrossAlign(c, idx, crossCurrentPos);
      }

      const finalCrossSize = isWrapReverse
        ? containerCrossSize - crossCurrentPos + paddingCrossStart
        : crossCurrentPos + childCrossSizeVar + paddingCrossEnd;

      if (node[crossDimension] !== finalCrossSize) {
        node[`preFlex${crossDimension}`] = node[crossDimension];
        node[crossDimension] = finalCrossSize;
        containerUpdated = true;
      }
    } else {
      for (let idx = 0; idx < numProcessedChildren; idx++) {
        const c = children[processableChildrenIndices[idx]!] as ElementNode;
        c[prop] = currentPos + childMarginStarts[idx]!;
        currentPos += childTotalMainSizes[idx]! + gap;
        doCrossAlign(c, idx, paddingCrossStart);
      }
    }

    // Update container size
    if (node.flexBoundary !== 'fixed' && node.flexWrap !== 'wrap') {
      let calculatedSize = currentPos - gap + paddingEnd;
      const minSize = node[minDimension] || 0;
      if (calculatedSize < minSize) {
        calculatedSize = minSize;
      }
      if (calculatedSize !== (node[dimension] || 0)) {
        node[`preFlex${dimension}`] = containerSize;
        node[dimension] = calculatedSize;
        return true;
      }
    }
  } else if (justify === 'flexEnd') {
    currentPos = containerSize - paddingEnd;
    for (let idx = numProcessedChildren - 1; idx >= 0; idx--) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos - childMainSizes[idx]! - childMarginEnds[idx]!;
      currentPos -= childTotalMainSizes[idx]! + gap;
      doCrossAlign(c, idx, paddingCrossStart);
    }
  } else if (justify === 'center') {
    currentPos =
      (containerSize - (totalItemSize + gap * (numProcessedChildren - 1))) / 2 +
      paddingStart;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos + childMarginStarts[idx]!;
      currentPos += childTotalMainSizes[idx]! + gap;
      doCrossAlign(c, idx, paddingCrossStart);
    }
  } else if (justify === 'spaceBetween') {
    const spaceBetween =
      numProcessedChildren > 1
        ? (containerSize - totalItemSize - nodePaddingTotal) /
          (numProcessedChildren - 1)
        : 0;
    currentPos = paddingStart;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos + childMarginStarts[idx]!;
      currentPos += childTotalMainSizes[idx]! + spaceBetween;
      doCrossAlign(c, idx, paddingCrossStart);
    }
  } else if (justify === 'spaceAround') {
    const spaceAround =
      numProcessedChildren > 0
        ? (containerSize - totalItemSize - nodePaddingTotal) /
          numProcessedChildren
        : 0;
    currentPos = paddingStart + spaceAround / 2;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos + childMarginStarts[idx]!;
      currentPos += childTotalMainSizes[idx]! + spaceAround;
      doCrossAlign(c, idx, paddingCrossStart);
    }
  } else if (justify === 'spaceEvenly') {
    const spaceEvenly =
      (containerSize - totalItemSize - nodePaddingTotal) /
      (numProcessedChildren + 1);
    currentPos = spaceEvenly + paddingStart;
    for (let idx = 0; idx < numProcessedChildren; idx++) {
      const c = children[processableChildrenIndices[idx]!] as ElementNode;
      c[prop] = currentPos + childMarginStarts[idx]!;
      currentPos += childTotalMainSizes[idx]! + spaceEvenly;
      doCrossAlign(c, idx, paddingCrossStart);
    }
  }

  return containerUpdated;
}
