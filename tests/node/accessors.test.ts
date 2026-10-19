import { describe, expect, it } from 'vitest';
import {
  DIRTY_COLOR,
  DIRTY_LOCAL,
  DIRTY_SHADER,
  F_ALPHA,
  F_STRIDE,
  F_WIDTH,
  F_X,
  I_COLOR_BL,
  I_COLOR_BR,
  I_COLOR_TL,
  I_COLOR_TR,
  I_DIRTY,
  I_STRIDE,
  NULL,
  RendererCore,
} from '@solidtv/renderer';
import { ElementNode } from '../../src/core/node/ElementNode.js';
import { SET_X } from '../../src/core/node/defaults.js';
import { NodeType } from '../../src/core/nodeTypes.js';

const headless = () => new RendererCore({ appWidth: 640, appHeight: 360 });

/** The node's pending dirty bits, cleared so the next write shows its own. */
function takeDirty(core: RendererCore, slot: number): number {
  const i = slot * I_STRIDE + I_DIRTY;
  const bits = core.nodes.u32[i]!;
  core.nodes.u32[i] = 0;
  return bits;
}

describe('ElementNode accessors', () => {
  it('x writes the store and marks DIRTY_LOCAL', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    takeDirty(core, node.slot);
    node.x = 42;
    expect(core.nodes.f64[node.slot * F_STRIDE + F_X]).toBe(42);
    expect(node.x).toBe(42);
    expect(takeDirty(core, node.slot) & DIRTY_LOCAL).toBe(DIRTY_LOCAL);
    expect(node._set[SET_X]).toBe(1);
  });

  it('width goes through applySize', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    takeDirty(core, node.slot);
    node.width = 120;
    expect(core.nodes.f64[node.slot * F_STRIDE + F_WIDTH]).toBe(120);
    expect(node.width).toBe(120);
    expect(takeDirty(core, node.slot) & DIRTY_SHADER).toBe(DIRTY_SHADER);
  });

  it('color writes u32 and marks DIRTY_COLOR', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    takeDirty(core, node.slot);
    node.color = 0xff0000ff;
    const o = node.slot * I_STRIDE;
    expect(core.nodes.u32[o + I_COLOR_TL]).toBe(0xff0000ff);
    expect(core.nodes.u32[o + I_COLOR_TR]).toBe(0xff0000ff);
    expect(core.nodes.u32[o + I_COLOR_BL]).toBe(0xff0000ff);
    expect(core.nodes.u32[o + I_COLOR_BR]).toBe(0xff0000ff);
    expect(node.color).toBe(0xff0000ff);
    expect(takeDirty(core, node.slot) & DIRTY_COLOR).toBe(DIRTY_COLOR);
  });

  it('hidden is alpha', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    node.hidden = true;
    expect(node.alpha).toBe(0);
    expect(node.hidden).toBe(true);
    node.hidden = false;
    expect(node.alpha).toBe(1);
    expect(node.hidden).toBe(false);
  });

  it('a destroyed node reads defaults and ignores writes', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    const slot = node.slot;
    node.alpha = 0.5;
    takeDirty(core, slot);
    node.slot = NULL;
    expect(node.alpha).toBe(1);
    expect(node.x).toBe(0);
    expect(() => {
      node.x = 5;
    }).not.toThrow();
    expect(core.nodes.f64[slot * F_STRIDE + F_X]).toBe(0);
    expect(core.nodes.f64[slot * F_STRIDE + F_ALPHA]).toBe(0.5);
    expect(takeDirty(core, slot)).toBe(0);
    expect(node._set[SET_X]).toBe(0);
  });

  it('the forwarded names the renderer never had are absent', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    const names = [
      'worldX',
      'worldY',
      'zIndexLocked',
      'scrollable',
      'scrollY',
      'strictBounds',
      'fontStretch',
      'textBaseline',
      'textOverflow',
      'textRendererOverride',
      'wordWrap',
    ];
    for (const name of names) {
      expect(name in node, name).toBe(false);
    }
  });

  it('one hidden class', () => {
    const core = headless();
    const view = new ElementNode(core, NodeType.Element);
    const text = new ElementNode(core, NodeType.TextNode);
    const root = ElementNode.fromSlot(core, core.root.slot);
    expect(Object.keys(text)).toEqual(Object.keys(view));
    expect(Object.keys(root)).toEqual(Object.keys(view));
    expect(core.nodes.handles[view.slot]).toBe(view);
    expect(core.nodes.handles[text.slot]).toBe(text);
    expect(core.nodes.handles[root.slot]).toBe(root);
  });
});
