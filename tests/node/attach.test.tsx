import { describe, expect, it, vi } from 'vitest';
import {
  I_FIRST_CHILD,
  I_PARENT,
  I_STRIDE,
  NULL,
  RendererCore,
} from '@solidtv/renderer';
import { ElementNode } from '../../src/core/node/ElementNode.js';
import { insertChild, removeChild } from '../../src/core/node/lifecycle.js';
import { SET_WIDTH } from '../../src/core/node/defaults.js';
import { NodeType } from '../../src/core/nodeTypes.js';
import { registerDefaultShaders } from '../../src/core/shaders.js';

/** A headless core and its root, attached, as createRenderer makes them. */
function scene() {
  const core = new RendererCore({ appWidth: 640, appHeight: 360 });
  registerDefaultShaders(core);
  const root = ElementNode.fromSlot(core, core.root.slot);
  root.rendered = true;
  return { core, root };
}

const view = (core: RendererCore) => new ElementNode(core, NodeType.Element);

/** Settle the microtask queue (the post-mutation pass). */
const microtasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('attach', () => {
  it('insert links in the store before the parent is attached', () => {
    const { core } = scene();
    const parent = view(core);
    const child = view(core);
    insertChild(parent, child);
    expect(core.nodes.i32[child.slot * I_STRIDE + I_PARENT]).toBe(parent.slot);
    expect(parent.rendered).toBe(false);
    expect(child.rendered).toBe(false);
    expect(child.parent).toBe(parent);
  });

  it('attach runs parent-first and sets rendered', () => {
    const { core, root } = scene();
    const log: string[] = [];
    const parent = view(core);
    const child = view(core);
    parent.onCreate = function () {
      log.push(`parent ${this.rendered} child ${child.rendered}`);
    };
    child.onCreate = function () {
      log.push(`child ${this.rendered}`);
    };
    insertChild(parent, child);
    expect(log).toEqual([]);
    insertChild(root, parent);
    expect(log).toEqual(['parent true child false', 'child true']);
    expect(parent.rendered).toBe(true);
    expect(child.rendered).toBe(true);
  });

  it('an explicit width on a detached child is kept at attach', () => {
    const { core, root } = scene();
    const parent = view(core);
    parent.width = 400;
    const child = view(core);
    child.width = 50;
    insertChild(parent, child);
    insertChild(root, parent);
    expect(child.width).toBe(50);
    expect(parent.width).toBe(400);
  });

  it("a child without width takes the parent's width minus its x at attach", () => {
    const { core, root } = scene();
    const parent = view(core);
    parent.width = 400;
    parent.height = 300;
    const child = view(core);
    child.x = 30;
    child.y = 20;
    insertChild(parent, child);
    insertChild(root, parent);
    expect(child.width).toBe(370);
    expect(child.height).toBe(280);
    // The root's size for a node with no size of its own.
    expect(parent.x).toBe(0);
    const full = view(core);
    insertChild(root, full);
    expect(full.width).toBe(640);
    expect(full.height).toBe(360);
    // A default is not the app's: no `_set` byte.
    expect(child._set[SET_WIDTH]).toBe(0);
  });

  it('right/bottom/center resolve once at attach', () => {
    const { core, root } = scene();
    const parent = view(core);
    parent.width = 400;
    parent.height = 300;
    insertChild(root, parent);
    const corner = view(core);
    corner.width = 10;
    corner.height = 10;
    corner.right = 20;
    corner.bottom = 30;
    const middle = view(core);
    middle.width = 10;
    middle.height = 10;
    middle.center = true;
    insertChild(parent, corner);
    insertChild(parent, middle);
    expect(corner.x).toBe(380);
    expect(corner.mountX).toBe(1);
    expect(corner.y).toBe(270);
    expect(corner.mountY).toBe(1);
    expect(middle.x).toBe(200);
    expect(middle.mountX).toBe(0.5);
    expect(middle.y).toBe(150);
    expect(middle.mountY).toBe(0.5);
    // Once: a later write of the shortcut moves nothing.
    corner.right = 0;
    expect(corner.x).toBe(380);
    parent.width = 800;
    expect(middle.x).toBe(200);
  });

  it('remove and re-insert in one tick keeps the slot', async () => {
    const { core, root } = scene();
    const parent = view(core);
    insertChild(root, parent);
    const a = view(core);
    const b = view(core);
    insertChild(parent, a);
    insertChild(parent, b);
    a.x = 12;
    const onCreate = vi.fn();
    a.onCreate = onCreate;
    const destroySlot = vi.spyOn(core, 'destroySlot');
    const slot = a.slot;
    removeChild(parent, a);
    insertChild(parent, a);
    await microtasks();
    expect(a.slot).toBe(slot);
    expect(destroySlot).not.toHaveBeenCalled();
    // Not attached again: no second onCreate, and its values are kept.
    expect(onCreate).not.toHaveBeenCalled();
    expect(a.x).toBe(12);
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(parent.slot);
    expect(a._queueDelete).toBeUndefined();
  });

  it('remove then a microtask frees the slot', async () => {
    const { core, root } = scene();
    const parent = view(core);
    insertChild(root, parent);
    const a = view(core);
    insertChild(parent, a);
    const destroySlot = vi.spyOn(core, 'destroySlot');
    const slot = a.slot;
    removeChild(parent, a);
    // Out of the children at once; still linked (drawn) until the
    // post-mutation pass destroys it, which unlinks and frees it.
    expect(parent.children).not.toContain(a);
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(parent.slot);
    expect(a.slot).toBe(slot);
    expect(destroySlot).not.toHaveBeenCalled();
    await microtasks();
    expect(destroySlot).toHaveBeenCalledTimes(1);
    expect(destroySlot).toHaveBeenCalledWith(slot);
    expect(a.slot).toBe(NULL);
    expect(core.nodes.i32[parent.slot * I_STRIDE + I_FIRST_CHILD]).toBe(NULL);
  });

  it('a preserved child removed, then its old parent destroyed, keeps its slot and can be inserted elsewhere', async () => {
    const { core, root } = scene();
    const parent = view(core);
    insertChild(root, parent);
    const kept = view(core);
    kept.preserve = true;
    insertChild(parent, kept);
    const slot = kept.slot;
    removeChild(parent, kept);
    await microtasks();
    // The delete flush never destroys it, so nothing would unlink it later:
    // it is out of the store's child list of the old parent at once.
    expect(kept.slot).toBe(slot);
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(NULL);
    expect(core.nodes.i32[parent.slot * I_STRIDE + I_FIRST_CHILD]).toBe(NULL);

    removeChild(root, parent);
    await microtasks();
    expect(parent.slot).toBe(NULL);
    // destroySubtree of the old parent did not take it along.
    expect(kept.slot).toBe(slot);

    const other = view(core);
    insertChild(root, other);
    insertChild(other, kept);
    await microtasks();
    expect(kept.slot).toBe(slot);
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(other.slot);
    expect(kept.preserve).toBe(true);
    expect(other.children).toContain(kept);
  });

  it('a node removed, re-inserted and removed again in one tick stays linked until the flush', async () => {
    const { core, root } = scene();
    const parent = view(core);
    insertChild(root, parent);
    const a = view(core);
    insertChild(parent, a);
    await microtasks();
    const slot = a.slot;
    // Its count passes through 0 (-1, +1, -1 queued) like a preserved node's,
    // but it is not preserved: it is destroyed, and stays drawn until then.
    removeChild(parent, a);
    insertChild(parent, a);
    removeChild(parent, a);
    expect(a.preserve).toBe(false);
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(parent.slot);
    await microtasks();
    expect(a.slot).toBe(NULL);
  });

  it('the same node with a promise onDestroy stays linked until it resolves', async () => {
    const { core, root } = scene();
    const parent = view(core);
    insertChild(root, parent);
    const a = view(core);
    let finish!: () => void;
    a.onDestroy = () => new Promise<void>((resolve) => (finish = resolve));
    insertChild(parent, a);
    await microtasks();
    const slot = a.slot;
    removeChild(parent, a);
    insertChild(parent, a);
    removeChild(parent, a);
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(parent.slot);
    await microtasks();
    expect(a.slot).toBe(slot);
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(parent.slot);
    finish();
    await microtasks();
    expect(a.slot).toBe(NULL);
  });

  it('a removed node stays linked while the promise onDestroy returns is pending', async () => {
    const { core, root } = scene();
    const parent = view(core);
    insertChild(root, parent);
    const a = view(core);
    let finish!: () => void;
    const onDestroy = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    a.onDestroy = onDestroy;
    insertChild(parent, a);
    const slot = a.slot;
    removeChild(parent, a);
    await microtasks();
    // The exit animation's node is still drawn.
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(a.slot).toBe(slot);
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(parent.slot);
    finish();
    await microtasks();
    expect(a.slot).toBe(NULL);
    expect(core.nodes.i32[parent.slot * I_STRIDE + I_FIRST_CHILD]).toBe(NULL);
  });

  it('a child removed, then its parent removed: one flush destroys both, the child onDestroy once', async () => {
    const { core, root } = scene();
    const parent = view(core);
    const child = view(core);
    const onDestroy = vi.fn();
    child.onDestroy = onDestroy;
    insertChild(root, parent);
    insertChild(parent, child);
    removeChild(parent, child);
    removeChild(root, parent);
    await microtasks();
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(child.slot).toBe(NULL);
    expect(parent.slot).toBe(NULL);
  });

  it('a parent removed, then its child: the parent frees the child, whose onDestroy still runs once', async () => {
    const { core, root } = scene();
    const parent = view(core);
    const child = view(core);
    const onDestroy = vi.fn();
    child.onDestroy = onDestroy;
    insertChild(root, parent);
    insertChild(parent, child);
    const destroySlot = vi.spyOn(core, 'destroySlot');
    // The parent is first in the delete queue: its destroySlot frees the
    // child's slot (still linked under it) before the child's turn.
    removeChild(root, parent);
    removeChild(parent, child);
    await microtasks();
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(onDestroy.mock.contexts[0]).toBe(child);
    expect(parent.slot).toBe(NULL);
    expect(child.slot).toBe(NULL);
    // Once, for the parent's subtree: the child's slot was already freed.
    expect(destroySlot).toHaveBeenCalledTimes(1);
  });

  it('a second destroy() does not run onDestroy again', () => {
    // 2.0: destroy runs once per node (1.x ran onDestroy on every call).
    const { core, root } = scene();
    const a = view(core);
    const onDestroy = vi.fn();
    a.onDestroy = onDestroy;
    insertChild(root, a);
    const destroySlot = vi.spyOn(core, 'destroySlot');
    a.destroy();
    a.destroy();
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(destroySlot).toHaveBeenCalledTimes(1);
    expect(a.slot).toBe(NULL);
  });

  it('draw order follows child order after insert before an anchor', () => {
    const { core, root } = scene();
    const parent = view(core);
    const a = view(core);
    const b = view(core);
    const c = view(core);
    insertChild(parent, a);
    insertChild(parent, c);
    // Detached: linked in child order before the parent is attached.
    insertChild(parent, b, c);
    const order = () => {
      const out: ElementNode[] = [];
      let s = core.nodes.i32[parent.slot * I_STRIDE + I_FIRST_CHILD]!;
      while (s !== NULL) {
        out.push(core.nodes.handles[s] as ElementNode);
        s = core.nodes.next[s]!;
      }
      return out;
    };
    expect(parent.children).toEqual([a, b, c]);
    expect(order()).toEqual([a, b, c]);
    insertChild(root, parent);
    // Attached: a move before an anchor moves the store link too.
    insertChild(parent, c, a);
    expect(parent.children).toEqual([c, a, b]);
    expect(order()).toEqual([c, a, b]);
    expect(core.nodes.prev[a.slot]).toBe(c.slot);
    const d = view(core);
    insertChild(parent, d, b);
    expect(order()).toEqual([c, a, d, b]);
  });

  it('width on a contain text before attach becomes its maxWidth at attach', () => {
    const { core, root } = scene();
    const text = new ElementNode(core, NodeType.TextNode);
    text.contain = 'width';
    text.width = 300;
    expect(text.maxWidth).toBe(0);
    insertChild(root, text);
    expect(text.maxWidth).toBe(300);
    expect(text.width).toBe(300);
  });
});
