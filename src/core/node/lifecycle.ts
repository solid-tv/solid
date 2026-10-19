import {
  DIRTY_INHERITED,
  DIRTY_RENDERABLE,
  I_PARENT,
  I_STRIDE,
  NULL,
} from '@solidtv/renderer';
import { Config } from '../config.js';
import { isDev } from '../env.js';
import { NodeType } from '../nodeTypes.js';
import {
  SET_COLOR,
  SET_COLOR_BR,
  SET_HEIGHT,
  SET_INDEX,
  SET_LINE_HEIGHT,
  SET_MAX_LINES,
  SET_TEXT,
  SET_TEXT_ALIGN,
  SET_TEXTURE,
  SET_WIDTH,
} from './defaults.js';
import type { ElementNode, SolidNode } from './ElementNode.js';
import {
  addToLayoutQueue,
  enqueueDelete,
  queueLayout,
  schedulePostMutation,
} from './postMutation.js';
import { readKey, writeKey } from './styles.js';
import { applyTextSizeAtAttach } from './textProps.js';

// Linking and attaching (spec 5.2). Solid inserts inside-out: a child is
// inserted into its parent before the parent is anywhere near the root. A
// node is linked into the store at insert (so draw order is child order from
// the start); it is attached, outside-in, parent before children, when its
// subtree is connected to the attached tree.

/**
 * The index of `item` in `list`, scanning from the end: Solid appends and
 * removes at the tail most often. The first item is checked first, for
 * Solid's cleanChildren, which removes the first child until none is left.
 */
function lastIndexOf(list: SolidNode[], item: SolidNode): number {
  if (list[0] === item) {
    return 0;
  }
  let i = list.length - 1;
  while (i > 0 && list[i] !== item) {
    i--;
  }
  return i === 0 ? -1 : i;
}

/**
 * Insert `node` into `parent`'s children before `before` (appended when
 * `before` is not a child), DOM insertBefore semantics: a node in a parent
 * is taken out first. An element is linked into the store at once, before
 * the next element sibling, and attached when `parent` is attached.
 */
export function insertChild(
  parent: ElementNode,
  node: SolidNode,
  before?: SolidNode | null,
): void {
  const children: SolidNode[] = parent.children;
  const prevParent = node.parent;
  // Before itself: it stays where it is. Solid's swap of adjacent items asks
  // for this (insertNode(parent, y, nextSibling(x))).
  if (before === node) {
    const at = prevParent === parent ? lastIndexOf(children, node) : -1;
    before = at === -1 ? undefined : children[at + 1];
  }
  // A node in a parent (this one too) is taken out first. One removed
  // earlier keeps its parent link but is in no child list: nothing to do.
  if (prevParent !== undefined) {
    removeChild(prevParent, node);
  }

  // DOM insertBefore semantics: an anchor that is not a child appends.
  let index =
    before !== undefined && before !== null
      ? lastIndexOf(children, before)
      : -1;
  if (index === -1) {
    index = children.length;
    children.push(node);
  } else {
    // Shifted up by hand: splice allocates its result array.
    let i = children.length;
    children.push(node);
    for (; i > index; i--) {
      children[i] = children[i - 1]!;
    }
    children[index] = node;
  }

  if (node._type === NodeType.Text) {
    // A string in a <text> (or a placeholder Solid puts anywhere).
    node.parent = parent;
    if (parent._type === NodeType.TextNode) {
      parent.text = parent.getText();
    }
    return;
  }
  node.parent = parent;

  // Link: draw before the next element sibling (B19), else last.
  const slot = node.slot;
  const parentSlot = parent.slot;
  if (slot !== NULL && parentSlot !== NULL) {
    const nodes = parent.core.nodes;
    let anchor = NULL;
    for (let i = index + 1; i < children.length; i++) {
      const c = children[i]!;
      if (c._type !== NodeType.Text && c.slot !== NULL) {
        anchor = c.slot;
        break;
      }
    }
    const linked = nodes.i32[slot * I_STRIDE + I_PARENT]!;
    if (linked !== parentSlot || nodes.next[slot] !== anchor) {
      if (linked !== NULL) {
        nodes.unlink(slot);
        nodes.markDirty(linked, 0);
      }
      nodes.insertBefore(parentSlot, slot, anchor);
      nodes.markDirty(slot, DIRTY_INHERITED | DIRTY_RENDERABLE);
    }
  }

  if (parent.rendered) {
    attach(node);
    // One pass for the whole insert: <For> may add many children in one
    // tick, and the pass runs once.
    schedulePostMutation();
  }
  if (prevParent !== undefined) {
    enqueueDelete(node, 1);
  }
}

/**
 * Take `node` out of `parent`'s children; an element is queued for the
 * delete flush, which destroys it (and so unlinks it from the store) unless
 * it is inserted again first (it then keeps its slot).
 */
export function removeChild(parent: ElementNode, node: SolidNode): void {
  const children: SolidNode[] = parent.children;
  const index = lastIndexOf(children, node);
  if (index === -1) {
    return;
  }
  // Shifted down by hand: splice allocates the array of removed items.
  if (index === 0) {
    children.shift();
  } else {
    const last = children.length - 1;
    for (let i = index; i < last; i++) {
      children[i] = children[i + 1]!;
    }
    children.pop();
  }

  if (node._type === NodeType.Text) {
    if (parent._type === NodeType.TextNode) {
      parent.text = parent.getText();
    }
    return;
  }

  // The store link stays until the node is destroyed (destroySlot unlinks
  // it, at the delete flush or after onDestroy's promise), so that an exit
  // animation (onDestroy, onRemove's fade) is drawn, as today. Inserted
  // again first, insertChild relinks it at its anchor.
  if (node.onRemove !== undefined) {
    node.onRemove.call(node, node);
  }
  if (parent.requiresLayout()) {
    queueLayout(parent);
  }
  enqueueDelete(node, -1);
}

/**
 * Remove every child of `node`, in one pass over the list (O(n), as 1.8):
 * what removing the first child until none is left does, without the
 * shifting.
 */
export function cleanChildren(node: ElementNode): void {
  const children: SolidNode[] = node.children;
  const len = children.length;
  if (len === 0) {
    return;
  }
  const removed = children.slice();
  children.length = 0;
  for (let i = 0; i < len; i++) {
    const child = removed[i]!;
    // Put back one at a time so removeChild finds it first in the list.
    children.push(child);
    removeChild(node, child);
  }
}

// The template of text defaults (Config.fontSettings), built at the first
// text attach. Config.fontSettings is set at app startup and later changes
// are ignored (contract-text).
let fontTemplate: string[] | undefined;
let fontTemplateValues: unknown[] | undefined;

/** `_layoutOnLoad`: a laid-out text or a loaded image lays its parent out. */
function layoutParentOnLoad(node: ElementNode): void {
  schedulePostMutation();
  const parent = node.parent;
  if (parent !== undefined) {
    parent.updateLayout();
  }
}

/**
 * Attach `node`, then its children, outside-in (spec 5.2): resolve its
 * parent-dependent defaults for the props the app did not set (spec 5.3),
 * the placement shortcuts once, the text defaults, its states; then
 * `rendered`, its shader, `onCreate` and `onRender`; then each element
 * child; then `autofocus`. A node already attached (a re-insert) only runs
 * `onRender`.
 */
export function attach(node: ElementNode): void {
  const parent = node.parent!;
  if (parent.requiresLayout()) {
    addToLayoutQueue(parent);
  }

  if (node.rendered) {
    // An item reordered or re-inserted: its layout is queued above.
    if (node.onRender !== undefined) {
      node.onRender.call(node, node);
    }
    return;
  }

  if (node._states !== undefined) {
    node._stateChanged();
  }

  const set = node._set;
  const parentWidth = parent.width;
  const parentHeight = parent.height;

  // The placement shortcuts, resolved once against the parent's size, and
  // not reactive afterwards (spec 5.3). setNow: the accessors marked the
  // x/mount bytes already.
  const right = node._right;
  if (right !== undefined) {
    node.setNow('x', parentWidth - right);
    node.setNow('mountX', 1);
  }
  const bottom = node._bottom;
  if (bottom !== undefined) {
    node.setNow('y', parentHeight - bottom);
    node.setNow('mountY', 1);
  }
  const center = node._center === true;
  if (center || node._centerX === true) {
    node.setNow('x', node.x + parentWidth / 2);
    node.setNow('mountX', 0.5);
  }
  if (center || node._centerY === true) {
    node.setNow('y', node.y + parentHeight / 2);
    node.setNow('mountY', 0.5);
  }

  if (node._type === NodeType.TextNode) {
    // The text defaults of Config.fontSettings, for each key the app did
    // not set. The family: a text with neither family nor weight takes the
    // template's (with its weight) once attached, below.
    let keys = fontTemplate;
    let values = fontTemplateValues;
    if (keys === undefined || values === undefined) {
      keys = [];
      values = [];
      // Config.fontSettings: a record of text props.
      const fs = Config.fontSettings as Record<string, unknown>;
      for (const key in fs) {
        if (key !== 'fontFamily' && key !== 'fontWeight') {
          keys.push(key);
          values.push(fs[key]);
        }
      }
      fontTemplate = keys;
      fontTemplateValues = values;
    }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      // A text prop the app did not write: the template's value.
      const at = SET_INDEX[key];
      if (at !== undefined ? set[at] === 0 : readKey(node, key) === undefined) {
        writeKey(node, key, values[i]);
      }
    }
    if (set[SET_TEXT] === 0 && node.children.length > 0) {
      node.text = node.getText();
    }

    if (isDev && set[SET_TEXT_ALIGN] === 1 && node.contain === 'none') {
      console.warn('Text align requires contain: ', node.getText());
    }

    // `contain` is 'width' or 'both': the size written before attach is
    // the max size, then today's defaults.
    applyTextSizeAtAttach(node);
    const contain = node.contain;
    if (contain !== 'none') {
      if (set[SET_HEIGHT] === 0 && node.maxHeight === 0) {
        if (set[SET_MAX_LINES] === 0) {
          node.setNow('maxLines', 99);
        }
      }
      if (node.maxWidth === 0) {
        node.setNow('maxWidth', parentWidth - node.x);
      }
      if (contain === 'both' && node.maxHeight === 0) {
        node.setNow('maxHeight', parentHeight - node.y);
      } else if (node.maxLines === 1 && node.maxHeight === 0) {
        node.setNow(
          'maxHeight',
          set[SET_LINE_HEIGHT] === 1 ? node.lineHeight : node.fontSize,
        );
      }
    }
    if (
      parent.requiresLayout() &&
      (node.maxWidth === 0 || node.maxHeight === 0)
    ) {
      node.on('loaded', layoutParentOnLoad);
    }
  } else if (set[SET_TEXTURE] === 0) {
    // Not a texture: the size of the parent less the offset, for a size
    // the app did not set.
    if (set[SET_WIDTH] === 0) {
      // A flex row container that sizes its width to its children (contain
      // on the main axis) defaults to 0 rather than filling its parent, so
      // it shrinks to fit its content once laid out.
      let flexFitsWidth = false;
      if (node.display === 'flex') {
        const flexDirection = node.flexDirection || 'row';
        flexFitsWidth =
          (flexDirection === 'row' || flexDirection === 'row-reverse') &&
          node.flexBoundary !== 'fixed';
        // Every justify mode except flexStart positions children out of the
        // container's free space. Shrinking to fit leaves none, so fall back
        // to filling the parent unless the app asked to contain, in which
        // case honour it and warn about the contradiction.
        const justify = node.justifyContent;
        if (flexFitsWidth && justify !== undefined && justify !== 'flexStart') {
          if (node.flexBoundary === undefined) {
            flexFitsWidth = false;
          } else if (isDev) {
            console.warn(
              `justifyContent '${justify}' has no free space to distribute on a flexBoundary 'contain' container without an explicit width: `,
              node,
            );
          }
        }
      }
      node.setNow(
        'width',
        node.flexGrow || flexFitsWidth ? 0 : parentWidth - node.x,
      );
      node._calcWidth = true;
    }
    if (set[SET_HEIGHT] === 0) {
      node.setNow('height', parentHeight - node.y);
      node._calcHeight = true;
    }
    // No colour written (any of the nine colour props) and no image:
    // transparent. With a `src`, the store's white stays.
    let i = SET_COLOR;
    while (i <= SET_COLOR_BR && set[i] === 0) {
      i++;
    }
    if (i > SET_COLOR_BR && node.src === null) {
      node.setNow('color', 0x00000000);
    }
  }

  node.rendered = true;

  if (node._type === NodeType.TextNode) {
    if (node._fontFamily === undefined && node._fontWeight === undefined) {
      // The template's family, which needs `rendered` (textProps.ts).
      node.fontFamily = undefined;
    }
  }
  if (node._shader === undefined && node._shaderProps !== undefined) {
    Config.convertToShader(node);
  }

  if (node.autosize && parent.requiresLayout()) {
    node.on('loaded', layoutParentOnLoad);
  }

  if (node.onCreate !== undefined) {
    node.onCreate.call(node, node);
  }
  if (node.onRender !== undefined) {
    node.onRender.call(node, node);
  }

  if (node._type === NodeType.Element) {
    // Only element nodes have element children; the children of a <text>
    // are strings.
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const c = children[i]!;
      // A TextNode may be a child (`children` types it out).
      if ((c as SolidNode)._type !== NodeType.Text) {
        attach(c);
      }
    }
  }

  if (node._autofocus) {
    node.setFocus();
  }
}

/**
 * `destroy()`: run `onDestroy` (the removed node's own: not its children's,
 * as today), waiting for the promise it returns (an exit animation), then
 * destroy the subtree in the store: `destroySlot` unlinks it, frees its
 * slots and gives its handles slot NULL. Once per subtree root: the store
 * frees the descendants. Once per node: a second call does nothing. A node
 * whose slot a destroyed ancestor freed first (it was removed, then its old
 * parent was) still runs its `onDestroy`.
 */
export function destroy(node: ElementNode): void {
  if (node._destroyed) {
    return;
  }
  node._destroyed = true;
  const onDestroy = node.onDestroy;
  if (onDestroy !== undefined) {
    const result = onDestroy.call(node, node);
    // If onDestroy returns a promise, wait for it before destroying: an
    // animation's waitUntilStopped.
    if (result instanceof Promise) {
      void result.then(() => {
        if (node.slot !== NULL) {
          node.core.destroySlot(node.slot);
        }
      });
      return;
    }
  }
  if (node.slot !== NULL) {
    node.core.destroySlot(node.slot);
  }
}
