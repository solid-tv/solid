/**
 * B20: the renderer v2 handle has no fields of its own beyond `id`,
 * `renderer`, `_uid` and its listener map; every prop is a prototype
 * accessor over the node store. A name the handle does not know becomes a
 * new own field (a new hidden class for that handle), and a write to one of
 * its getter-only props throws. Solid must never do either.
 *
 * Runs on the real renderer (vitest.webgl.config.ts): the DOM renderer's
 * nodes are plain objects that take any field.
 */
import * as v from 'vitest';
import type { ElementNode } from '@solidtv/solid';
import { render, renderer } from './setup.js';

type Handle = Record<string, unknown>;
const handle = (el: ElementNode) => el.lng as unknown as Handle;

v.test(
  'text-only props written to a rendered <view> add no field to its handle',
  () => {
    let view!: ElementNode;
    const dispose = render(() => <view ref={view} width={100} height={100} />);
    v.expect(view.rendered).toBe(true);
    const keys = Object.keys(view.lng);

    view.fontSize = 20;
    view.lineHeight = 30;
    view.maxWidth = 50;
    view.text = 'hello';
    view.contain = 'width';
    view.fontWeight = 'bold';

    v.expect(Object.keys(view.lng)).toEqual(keys);
    // The values stay on the ElementNode.
    v.expect(view.fontSize).toBe(20);
    v.expect(view.lineHeight).toBe(30);
    v.expect(view.maxWidth).toBe(50);
    v.expect(view.text).toBe('hello');
    v.expect(view.contain).toBe('width');
    v.expect(view.fontWeight).toBe('bold');
    dispose();
  },
);

v.test('text-only props written to a rendered <text> reach its handle', () => {
  let text!: ElementNode;
  const dispose = render(() => <text ref={text}>a</text>);
  const keys = Object.keys(text.lng);

  text.fontSize = 40;
  text.maxWidth = 300;
  text.contain = 'width';
  text.text = 'b';

  v.expect(Object.keys(text.lng)).toEqual(keys);
  v.expect(handle(text).fontSize).toBe(40);
  v.expect(handle(text).maxWidth).toBe(300);
  v.expect(handle(text).contain).toBe('width');
  v.expect(handle(text).text).toBe('b');
  dispose();
});

v.test(
  'absX, absY and destroyed: writes do not throw, reads come from the handle',
  () => {
    let parent!: ElementNode;
    let view!: ElementNode;
    const dispose = render(() => (
      <view ref={parent} x={10} y={20} width={300} height={300}>
        <view ref={view} x={5} y={7} width={10} height={10} />
      </view>
    ));
    const keys = Object.keys(view.lng);

    v.expect(() => {
      view.absX = 1;
      view.absY = 2;
      view.destroyed = true;
    }).not.toThrow();

    v.expect(Object.keys(view.lng)).toEqual(keys);
    v.expect(view.absX).toBe(handle(view).absX);
    v.expect(view.absY).toBe(handle(view).absY);
    v.expect(view.destroyed).toBe(false);
    void parent;
    dispose();
  },
);

// Every prop Solid forwards to the renderer node, written alone on a
// rendered node: the handle gets exactly the value (no field of its own) and
// the ElementNode reads it back from there. Each value is distinct, so an
// accessor wired to the wrong name fails.
const NODE_PROPS: Array<[string, unknown]> = [
  ['x', 11],
  ['y', 12],
  ['w', 13],
  ['h', 14],
  ['alpha', 0.5],
  ['color', 0x01020304],
  ['colorTop', 0x05060708],
  ['colorBottom', 0x090a0b0c],
  ['colorLeft', 0x0d0e0f10],
  ['colorRight', 0x11121314],
  ['colorTl', 0x15161718],
  ['colorTr', 0x191a1b1c],
  ['colorBl', 0x1d1e1f20],
  ['colorBr', 0x21222324],
  ['mount', 0.25],
  ['mountX', 0.3],
  ['mountY', 0.35],
  ['pivot', 0.4],
  ['pivotX', 0.45],
  ['pivotY', 0.55],
  ['rotation', 0.6],
  ['scale', 1.5],
  ['scaleX', 1.6],
  ['scaleY', 1.7],
  ['zIndex', 3],
  ['autosize', true],
  ['clipping', true],
  ['componentName', 'Name'],
  ['componentLocation', 'file.tsx:1'],
  ['data', { a: 1 }],
  ['ignoreParentAlpha', true],
  ['imageType', 'png'],
  ['placeholderColor', 0x25262728],
  ['srcX', 1],
  ['srcY', 2],
  ['srcWidth', 3],
  ['srcHeight', 4],
  ['textureOptions', { preload: true }],
];

const TEXT_PROPS: Array<[string, unknown]> = [
  ['fontSize', 40],
  ['lineHeight', 50],
  ['fontStyle', 'italic'],
  ['letterSpacing', 2],
  ['maxHeight', 200],
  ['maxLines', 3],
  ['maxWidth', 300],
  ['offsetY', 4],
  ['overflowSuffix', '..'],
  ['text', 'b'],
  ['textAlign', 'center'],
  ['verticalAlign', 'middle'],
  ['wordBreak', 'break-all'],
  ['contain', 'width'],
  ['forceLoad', true],
];

v.test('every forwarded prop reaches the handle under its own name', () => {
  let view!: ElementNode;
  let text!: ElementNode;
  const dispose = render(() => (
    <view>
      <view ref={view} width={100} height={100} />
      <text ref={text}>a</text>
    </view>
  ));
  const viewKeys = Object.keys(view.lng);
  const textKeys = Object.keys(text.lng);
  const el = (n: ElementNode) => n as unknown as Handle;

  for (const [name, value] of NODE_PROPS) {
    el(view)[name] = value;
    v.expect(handle(view)[name], name).toEqual(value);
    v.expect(el(view)[name], name).toEqual(value);
  }
  for (const [name, value] of [...NODE_PROPS.slice(4), ...TEXT_PROPS]) {
    el(text)[name] = value;
    v.expect(handle(text)[name], name).toEqual(value);
    v.expect(el(text)[name], name).toEqual(value);
  }
  const texture = renderer.createTexture('ColorTexture', {
    color: 0xffffffff,
  });
  view.texture = texture;
  v.expect(handle(view).texture).toBe(texture);
  v.expect(view.texture).toBe(texture);

  v.expect(Object.keys(view.lng)).toEqual(viewKeys);
  v.expect(Object.keys(text.lng)).toEqual(textKeys);
  dispose();
});

// The transition path. With `transition` on a rendered node, an animatable
// setter hands the renderer's animateProp its own name and the value, and
// does not store the value itself. animateProp is stubbed: this checks what
// Solid passes, not the animation.
const ANIMATABLE_NODE_PROPS = NODE_PROPS.slice(0, 25) as Array<
  [string, number]
>;
const ANIMATABLE_TEXT_PROPS: Array<[string, number]> = [
  ['fontSize', 40],
  ['lineHeight', 50],
];

v.test(
  'with a transition, every animatable prop animates under its own name',
  () => {
    let view!: ElementNode;
    let text!: ElementNode;
    const dispose = render(() => (
      <view>
        <view ref={view} width={100} height={100} />
        <text ref={text}>a</text>
      </view>
    ));
    // Node.prototype (a TextNode inherits it).
    const proto = Object.getPrototypeOf(view.lng) as {
      animateProp: (name: string, value: number, settings: unknown) => unknown;
    };
    const animateProp = v.vi
      .spyOn(proto, 'animateProp')
      .mockImplementation(() => undefined);
    try {
      view.transition = true;
      text.transition = true;
      const el = (n: ElementNode) => n as unknown as Handle;
      const check = (node: ElementNode, name: string, value: number) => {
        const before = handle(node)[name];
        v.expect(before, name).not.toBe(value);
        const calls = animateProp.mock.calls.length;
        el(node)[name] = value;
        v.expect(animateProp.mock.calls.length, name).toBe(calls + 1);
        v.expect(animateProp.mock.lastCall, name).toEqual([
          name,
          value,
          v.expect.anything(),
        ]);
        v.expect(animateProp.mock.contexts.at(-1), name).toBe(node.lng);
        v.expect(handle(node)[name], name).toBe(before);
      };
      for (const [name, value] of ANIMATABLE_NODE_PROPS) {
        check(view, name, value);
      }
      for (const [name, value] of ANIMATABLE_TEXT_PROPS) {
        check(text, name, value);
      }
    } finally {
      animateProp.mockRestore();
      dispose();
    }
  },
);
