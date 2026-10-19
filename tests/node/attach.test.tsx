import { describe, expect, it, vi } from 'vitest';
import { I_PARENT, I_STRIDE, NULL, RendererCore } from '@solidtv/renderer';
import { ElementNode } from '../../src/core/node/ElementNode.js';
import { insertChild, removeChild } from '../../src/core/node/lifecycle.js';
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
    expect(child._set[2]).toBe(0);
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
    // Unlinked at once, freed in the post-mutation pass.
    expect(core.nodes.i32[slot * I_STRIDE + I_PARENT]).toBe(NULL);
    expect(a.slot).toBe(slot);
    expect(destroySlot).not.toHaveBeenCalled();
    await microtasks();
    expect(destroySlot).toHaveBeenCalledTimes(1);
    expect(destroySlot).toHaveBeenCalledWith(slot);
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
      let s = core.nodes.i32[parent.slot * I_STRIDE + 4 /* I_FIRST_CHILD */]!;
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
