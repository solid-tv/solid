import { describe, expect, it } from 'vitest';
import {
  DIRTY_LAYOUT,
  F_HEIGHT,
  F_STRIDE,
  F_WIDTH,
  I_DIRTY,
  I_STRIDE,
  RendererCore,
  textStateOf,
} from '@solidtv/renderer';
import { Config } from '../../src/core/config.js';
import {
  ElementNode,
  type SolidNode,
} from '../../src/core/node/ElementNode.js';
import { SET_FONT_SIZE, SET_WIDTH } from '../../src/core/node/defaults.js';
import { applyTextSizeAtAttach } from '../../src/core/node/textProps.js';
import { NodeType, TextNode } from '../../src/core/nodeTypes.js';
import { loadBoxFont } from '../fonts.js';

const headless = () => new RendererCore({ appWidth: 640, appHeight: 360 });

/** The node's pending dirty bits, cleared so the next write shows its own. */
function takeDirty(core: RendererCore, slot: number): number {
  const i = slot * I_STRIDE + I_DIRTY;
  const bits = core.nodes.u32[i]!;
  core.nodes.u32[i] = 0;
  return bits;
}

/** A `<text>` on a core with the Box font loaded, set to use it. */
async function boxText(): Promise<{ core: RendererCore; text: ElementNode }> {
  const core = headless();
  await loadBoxFont(core);
  const text = new ElementNode(core, NodeType.TextNode);
  text.fontFamily = 'Box';
  text.fontSize = 20;
  return { core, text };
}

describe('ElementNode text props', () => {
  it('fontSize on a text writes the state and marks stale', async () => {
    const { core, text } = await boxText();
    text.text = 'ab';
    expect(text.measureText()).toBe(true);
    const state = textStateOf(core.nodes, text.slot);
    expect(state.stale).toBe(false);
    takeDirty(core, text.slot);
    text.fontSize = 30;
    expect(state.fontSize).toBe(30);
    expect(text.fontSize).toBe(30);
    expect(state.stale).toBe(true);
    expect(takeDirty(core, text.slot) & DIRTY_LAYOUT).toBe(DIRTY_LAYOUT);
    expect(text._set[SET_FONT_SIZE]).toBe(1);
    // The same value again changes nothing.
    state.stale = false;
    text.fontSize = 30;
    expect(state.stale).toBe(false);
    // undefined is the renderer's default.
    (text as { fontSize: number | undefined }).fontSize = undefined;
    expect(state.fontSize).toBe(16);
  });

  it("fontWeight before fontFamily still yields 'Family Bold' (B17)", () => {
    const alias = Config.fontWeightAlias;
    Config.fontWeightAlias = { bold: ' Bold' };
    try {
      const core = headless();
      const weightFirst = new ElementNode(core, NodeType.TextNode);
      weightFirst.fontWeight = 'bold';
      weightFirst.fontFamily = 'Family';
      const familyFirst = new ElementNode(core, NodeType.TextNode);
      familyFirst.fontFamily = 'Family';
      familyFirst.fontWeight = 'bold';
      expect(textStateOf(core.nodes, weightFirst.slot).fontFamily).toBe(
        'Family Bold',
      );
      expect(textStateOf(core.nodes, familyFirst.slot).fontFamily).toBe(
        'Family Bold',
      );
      // The raw values stay as written.
      expect(weightFirst.fontFamily).toBe('Family');
      expect(weightFirst.fontWeight).toBe('bold');
      // A weight no alias names is appended as it is; none leaves the family.
      familyFirst.fontWeight = 600;
      expect(textStateOf(core.nodes, familyFirst.slot).fontFamily).toBe(
        'Family600',
      );
      familyFirst.fontWeight = undefined;
      expect(textStateOf(core.nodes, familyFirst.slot).fontFamily).toBe(
        'Family',
      );
    } finally {
      Config.fontWeightAlias = alias;
    }
  });

  it('text props on a view land in _textProps and not in the store', () => {
    const core = headless();
    const view = new ElementNode(core, NodeType.Element);
    expect(view._textProps).toBeUndefined();
    expect(view.fontSize).toBe(16);
    takeDirty(core, view.slot);
    view.fontSize = 30;
    view.text = 'hello';
    view.fontFamily = 'Family';
    view.contain = 'width';
    expect(view._textProps).toEqual({
      fontSize: 30,
      text: 'hello',
      fontFamily: 'Family',
      contain: 'width',
    });
    expect(view.fontSize).toBe(30);
    expect(view.text).toBe('hello');
    expect(view.fontFamily).toBe('Family');
    expect(view.contain).toBe('width');
    expect(view.lineHeight).toBe(1.2);
    expect(view._set[SET_FONT_SIZE]).toBe(1);
    // No text state, nothing dirty: a view draws no text.
    expect(core.nodes.texts[view.slot]).toBeFalsy();
    expect(takeDirty(core, view.slot)).toBe(0);
    expect(view.measureText()).toBe(false);
  });

  it('width before attach becomes maxWidth', async () => {
    const { core, text } = await boxText();
    const state = textStateOf(core.nodes, text.slot);
    text.contain = 'both';
    text.width = 100;
    text.height = 50;
    // Not attached: stored as the node's own size, no maxWidth yet.
    expect(state.maxWidth).toBe(0);
    expect(text.width).toBe(100);
    expect(core.nodes.f64[text.slot * F_STRIDE + F_WIDTH]).toBe(100);
    expect(text._set[SET_WIDTH]).toBe(1);
    // Attach turns the stored size into maxWidth and maxHeight.
    applyTextSizeAtAttach(text);
    expect(state.maxWidth).toBe(100);
    expect(state.maxHeight).toBe(50);
    expect(state.stale).toBe(true);
    text.rendered = true;
    // Attached: a write is maxWidth, and the node's size stays the layout's.
    text.width = 80;
    expect(state.maxWidth).toBe(80);
    expect(text.width).toBe(80);
    text.height = 40;
    expect(state.maxHeight).toBe(40);
    expect(text.height).toBe(40);
  });

  it('attach maps the pre-attach size to maxWidth and maxHeight by contain', async () => {
    const { core, text } = await boxText();
    const state = textStateOf(core.nodes, text.slot);
    // No contain: the size stays the node's own.
    text.width = 100;
    text.height = 50;
    applyTextSizeAtAttach(text);
    expect(state.maxWidth).toBe(0);
    expect(state.maxHeight).toBe(0);
    expect(text.width).toBe(100);
    expect(core.nodes.f64[text.slot * F_STRIDE + F_WIDTH]).toBe(100);
    // contain 'width': the width only.
    text.contain = 'width';
    applyTextSizeAtAttach(text);
    expect(state.maxWidth).toBe(100);
    expect(state.maxHeight).toBe(0);
    // A maxWidth set already is kept.
    const other = new ElementNode(core, NodeType.TextNode);
    other.contain = 'both';
    other.maxWidth = 70;
    other.width = 100;
    applyTextSizeAtAttach(other);
    expect(textStateOf(core.nodes, other.slot).maxWidth).toBe(70);
  });

  it("contain 'width' reads width as maxWidth", async () => {
    const { core, text } = await boxText();
    text.rendered = true;
    text.contain = 'width';
    text.maxWidth = 100;
    text.text = 'ab';
    expect(text.measureText()).toBe(true);
    // 'ab' is 2 glyphs of 16: the laid-out width is not the maxWidth.
    const laidOut = core.nodes.f64[text.slot * F_STRIDE + F_WIDTH]!;
    expect(laidOut).toBeGreaterThan(0);
    expect(laidOut).not.toBe(100);
    expect(text.width).toBe(100);
    // Without a maxHeight, the laid-out height.
    expect(text.height).toBe(core.nodes.f64[text.slot * F_STRIDE + F_HEIGHT]);
    text.maxHeight = 60;
    expect(text.height).toBe(60);
  });

  it('measureText lays out synchronously', async () => {
    const { core, text } = await boxText();
    expect(text.width).toBe(0);
    text.text = 'ab';
    expect(text.measureText()).toBe(true);
    // No update ran: the size is the layout's.
    expect(text.width).toBeGreaterThan(0);
    expect(text.height).toBeGreaterThan(0);
    expect(textStateOf(core.nodes, text.slot).stale).toBe(false);
  });

  it('getText joins the string children', () => {
    const core = headless();
    const text = new ElementNode(core, NodeType.TextNode);
    expect(text.getText()).toBe('');
    // A <text>'s children are strings (`children` types them out).
    const strings: SolidNode[] = text.children;
    strings.push(new TextNode('ab'));
    expect(text.getText()).toBe('ab');
    strings.push(new TextNode('cd'), new TextNode('ef'));
    expect(text.getText()).toBe('abcdef');
  });

  it('the template family is read once: a later Config.fontSettings change is ignored', () => {
    const fs = Config.fontSettings;
    const saved = fs.fontFamily;
    const core = headless();
    const first = new ElementNode(core, NodeType.TextNode);
    first.rendered = true;
    first.fontFamily = undefined;
    const family = textStateOf(core.nodes, first.slot).fontFamily;
    expect(family).not.toBe('sans-serif');
    fs.fontFamily = 'Changed';
    try {
      const later = new ElementNode(core, NodeType.TextNode);
      later.rendered = true;
      later.fontFamily = undefined;
      expect(textStateOf(core.nodes, later.slot).fontFamily).toBe(family);
    } finally {
      fs.fontFamily = saved;
    }
  });
});
