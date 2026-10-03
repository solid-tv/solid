/**
 * Phase 1 contract tests: text props, text children, font defaults,
 * autosize, and text inside flex containers — on the DOM renderer (jsdom).
 *
 * jsdom has no layout, so the DOM renderer measures every text as 0 x 0
 * (getBoundingClientRect). Tests that need real sizes install
 * `mockTextMeasure()`: 10px per character, 20px per line, for text divs only.
 * The DOM renderer measures a text once when it is created (synchronously)
 * and again after `document.fonts.ready`, when it emits `loaded`.
 * Real-WebGL text-in-flex is covered elsewhere.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { renderer, waitForUpdate } from './setup.js';

const CHAR_W = 10;
const LINE_H = 20;

function mockTextMeasure() {
  return vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const text = (
        this as unknown as { _node?: { props?: { text?: unknown } } }
      )._node?.props?.text;
      const isText = typeof text === 'string';
      const width = isText ? text.length * CHAR_W : 0;
      const height = isText ? LINE_H : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON() {},
      } as DOMRect;
    });
}

type RendererTextNode = lng.ElementNode['lng'] & Record<string, unknown>;
const raw = (el: lng.ElementNode) => el.lng as RendererTextNode;

afterEach(() => {
  vi.restoreAllMocks();
});

// The DOM renderer re-measures a changed text in a microtask and emits
// `loaded`; the handler queues the flex pass for the post-mutation microtask
// after that (design 3.4.4), which `waitForUpdate` (a few microtasks) can
// miss. A macrotask is after both.
const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

describe('contract: text children concatenated from several JSX expressions', () => {
  it('static text and several expressions concatenate into el.text and el.lng.text', () => {
    const [name] = s.createSignal('Bob');
    const [other] = s.createSignal('Ann');
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t}>
        Hello {name()} and {other()}
      </text>
    ));
    expect(t.text).toBe('Hello Bob and Ann');
    expect(raw(t).text).toBe('Hello Bob and Ann');
    dispose();
  });

  it('reactive updates re-concatenate synchronously, each expression on its own', () => {
    const [name, setName] = s.createSignal('Bob');
    const [other, setOther] = s.createSignal('Ann');
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t}>
        Hello {name()} and {other()}
      </text>
    ));
    setName('Zed');
    expect(t.text).toBe('Hello Zed and Ann');
    expect(raw(t).text).toBe('Hello Zed and Ann');
    setOther('Kim');
    expect(t.text).toBe('Hello Zed and Kim');
    expect(raw(t).text).toBe('Hello Zed and Kim');
    dispose();
  });

  it('number expressions are stringified', () => {
    // Works at runtime, but TextProps.children is typed `string | string[]`
    // (src/core/intrinsicTypes.ts:192), so a number child is a type error.
    const [n, setN] = s.createSignal(1);
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => <text ref={t}>Count {n()}!</text>);
    expect(t.text).toBe('Count 1!');
    setN(22);
    expect(t.text).toBe('Count 22!');
    expect(raw(t).text).toBe('Count 22!');
    dispose();
  });

  it('a <Show> inside text adds and removes its part', () => {
    // Works at runtime; a JSX element child is a type error, as above.
    const [show, setShow] = s.createSignal(false);
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t}>
        A<s.Show when={show()}>B</s.Show>C
      </text>
    ));
    expect(t.text).toBe('AC');
    setShow(true);
    expect(t.text).toBe('ABC');
    expect(raw(t).text).toBe('ABC');
    setShow(false);
    expect(t.text).toBe('AC');
    dispose();
  });
});

describe('contract: text props reach the renderer node (el.lng)', () => {
  it('contain "width" with a width: maxWidth = width, maxLines defaults to 99', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text ref={t} contain="width" width={300}>
          A
        </text>
      </view>
    ));
    expect(raw(t).contain).toBe('width');
    expect(raw(t).maxWidth).toBe(300);
    expect(raw(t).maxLines).toBe(99);
    expect(raw(t).maxHeight).toBe(0); // DOM renderer default: unset
    // el.width reads maxWidth first (elementNode.ts: width = maxWidth || w).
    expect(t.width).toBe(300);
    dispose();
  });

  // B11: before the fix marginRight was read from the renderer props bag,
  // where it is never stored (margins live on the ElementNode), so the
  // subtraction was always 0 (maxWidth 700).
  it('contain "width" without a width: maxWidth = parent width - x - marginRight', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text ref={t} contain="width" x={100} marginRight={40}>
          B
        </text>
      </view>
    ));
    expect(raw(t).maxWidth).toBe(660);
    expect(raw(t).maxLines).toBe(99);
    dispose();
  });

  // B11: as above for marginBottom (maxHeight was 550).
  it('contain "both" without a size: maxHeight = parent height - y - marginBottom', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text
          ref={t}
          contain="both"
          x={100}
          y={50}
          marginRight={40}
          marginBottom={30}
        >
          B
        </text>
      </view>
    ));
    expect(raw(t).maxWidth).toBe(660);
    expect(raw(t).maxHeight).toBe(520);
    dispose();
  });

  it('contain "both" with width and height: maxWidth/maxHeight from them, maxLines not defaulted', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text ref={t} contain="both" width={300} height={90}>
          C
        </text>
      </view>
    ));
    expect(raw(t).contain).toBe('both');
    expect(raw(t).maxWidth).toBe(300);
    expect(raw(t).maxHeight).toBe(90);
    expect(raw(t).maxLines).toBe(0); // DOM renderer default: unset
    expect(t.width).toBe(300);
    expect(t.height).toBe(90);
    dispose();
  });

  it('contain "both" without a size: maxWidth/maxHeight = parent size - x/y, maxLines 99', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text ref={t} contain="both" x={100} y={50}>
          D
        </text>
      </view>
    ));
    expect(raw(t).maxWidth).toBe(700);
    expect(raw(t).maxHeight).toBe(550);
    expect(raw(t).maxLines).toBe(99);
    dispose();
  });

  it('maxLines={1} with contain: maxHeight = lineHeight, or fontSize when there is no lineHeight', () => {
    let withLineHeight!: lng.ElementNode;
    let withFontSize!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text
          ref={withLineHeight}
          contain="width"
          width={300}
          maxLines={1}
          lineHeight={40}
        >
          E
        </text>
        <text
          ref={withFontSize}
          contain="width"
          width={300}
          maxLines={1}
          fontSize={30}
        >
          F
        </text>
      </view>
    ));
    expect(raw(withLineHeight).maxLines).toBe(1);
    expect(raw(withLineHeight).maxHeight).toBe(40);
    expect(withLineHeight.height).toBe(40);
    expect(raw(withFontSize).maxHeight).toBe(30);
    dispose();
  });

  // B12: a lineHeight at or below 3 is a multiplier of the font size (as the
  // renderer reads it). Before the fix maxHeight was the bare multiplier
  // (1.2 px), so the text was 1.2 px high in flex.
  it('maxLines={1} with contain and a multiplier lineHeight: maxHeight = lineHeight * fontSize', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text
          ref={t}
          contain="width"
          width={300}
          maxLines={1}
          lineHeight={1.2}
          fontSize={30}
        >
          E
        </text>
      </view>
    ));
    expect(raw(t).maxHeight).toBe(36);
    expect(t.height).toBe(36);
    dispose();
  });

  it('maxWidth/maxHeight without contain pass through, and el.width/el.height read them', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t} maxWidth={222} maxHeight={33}>
        G
      </text>
    ));
    expect(raw(t).maxWidth).toBe(222);
    expect(raw(t).maxHeight).toBe(33);
    expect(t.width).toBe(222);
    expect(t.height).toBe(33);
    dispose();
  });

  it('textAlign without contain warns "Text align requires contain" and is still passed on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t} textAlign="center">
        H
      </text>
    ));
    expect(warn).toHaveBeenCalledWith('Text align requires contain: ', 'H');
    expect(raw(t).textAlign).toBe('center');
    dispose();
  });

  it('textAlign with contain is passed on without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text ref={t} textAlign="right" contain="width" width={300}>
          I
        </text>
      </view>
    ));
    expect(raw(t).textAlign).toBe('right');
    expect(warn).not.toHaveBeenCalled();
    dispose();
  });

  it('lineHeight, letterSpacing, overflowSuffix, wordBreak, fontSize and fontFamily pass through', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text
        ref={t}
        lineHeight={30}
        letterSpacing={2}
        overflowSuffix="--"
        wordBreak="break-all"
        fontSize={20}
        fontFamily="Roboto"
      >
        J
      </text>
    ));
    expect(raw(t).lineHeight).toBe(30);
    expect(raw(t).letterSpacing).toBe(2);
    expect(raw(t).overflowSuffix).toBe('--');
    expect(raw(t).wordBreak).toBe('break-all');
    expect(raw(t).fontSize).toBe(20);
    expect(raw(t).fontFamily).toBe('Roboto');
    dispose();
  });

  it('unset text props get the DOM renderer defaults', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => <text ref={t}>K</text>);
    expect(raw(t).contain).toBe('none');
    expect(raw(t).textAlign).toBe('left');
    expect(raw(t).lineHeight).toBe(0);
    expect(raw(t).letterSpacing).toBe(0);
    expect(raw(t).overflowSuffix).toBe('...');
    expect(raw(t).wordBreak).toBe('overflow');
    expect(raw(t).maxLines).toBe(0);
    expect(raw(t).maxWidth).toBe(0);
    expect(raw(t).maxHeight).toBe(0);
    dispose();
  });

  it('reactive text props update the renderer node after render', () => {
    const [spacing, setSpacing] = s.createSignal(1);
    const [lines, setLines] = s.createSignal(2);
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text
          ref={t}
          contain="width"
          width={300}
          letterSpacing={spacing()}
          maxLines={lines()}
        >
          L
        </text>
      </view>
    ));
    setSpacing(5);
    setLines(3);
    expect(raw(t).letterSpacing).toBe(5);
    expect(raw(t).maxLines).toBe(3);
    dispose();
  });
});

describe('contract: font defaults from Config.fontSettings', () => {
  it('unset fontFamily and fontSize come from Config.fontSettings', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => <text ref={t}>a</text>);
    expect(raw(t).fontFamily).toBe(lng.Config.fontSettings.fontFamily);
    expect(raw(t).fontSize).toBe(lng.Config.fontSettings.fontSize);
    dispose();
  });

  it('JSX props override the defaults', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t} fontFamily="Roboto" fontSize={24}>
        a
      </text>
    ));
    expect(raw(t).fontFamily).toBe('Roboto');
    expect(raw(t).fontSize).toBe(24);
    dispose();
  });

  it('fontWeight is folded into the family name through Config.fontWeightAlias', () => {
    const family = lng.Config.fontSettings.fontFamily;
    let bold!: lng.ElementNode;
    let regular!: lng.ElementNode;
    let numeric!: lng.ElementNode;
    let custom!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view>
        <text ref={bold} fontWeight="bold">
          b
        </text>
        <text ref={regular} fontWeight={400}>
          c
        </text>
        <text ref={numeric} fontWeight={600}>
          d
        </text>
        <text ref={custom} fontFamily="Roboto" fontWeight="bold">
          e
        </text>
      </view>
    ));
    expect(raw(bold).fontFamily).toBe(`${family}700`);
    expect(raw(regular).fontFamily).toBe(family);
    expect(raw(numeric).fontFamily).toBe(`${family}600`);
    expect(raw(custom).fontFamily).toBe('Roboto700');
    dispose();
  });

  it('fontWeight before fontFamily: the weight is lost (prop order matters today)', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t} fontWeight="bold" fontFamily="Roboto">
        a
      </text>
    ));
    expect(raw(t).fontFamily).toBe('Roboto');
    dispose();
  });

  // BUG: the fontFamily setter (src/core/elementNode.ts, `set fontFamily`)
  // overwrites the family+weight name that `set fontWeight` wrote, so the
  // result depends on JSX attribute order.
  it.skip('BUG: fontWeight and fontFamily give the same family in either order', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t} fontWeight="bold" fontFamily="Roboto">
        a
      </text>
    ));
    expect(raw(t).fontFamily).toBe('Roboto700');
    dispose();
  });

  it('Config.fontSettings is read once, at the first text render: later changes are ignored', () => {
    // Documented at src/core/elementNode.ts (font template comment):
    // fontSettings is expected to be set at app startup and not change.
    let first!: lng.ElementNode;
    const d1 = renderer.render(() => <text ref={first}>a</text>);
    const family = raw(first).fontFamily;
    const size = raw(first).fontSize;
    d1();

    const saved = { ...lng.Config.fontSettings };
    try {
      lng.Config.fontSettings.fontFamily = 'ChangedFamily';
      lng.Config.fontSettings.fontSize = 42;
      let later!: lng.ElementNode;
      const d2 = renderer.render(() => <text ref={later}>b</text>);
      expect(raw(later).fontFamily).toBe(family);
      expect(raw(later).fontSize).toBe(size);
      d2();
    } finally {
      Object.assign(lng.Config.fontSettings, saved);
    }
  });
});

describe('contract: autosize', () => {
  it('autosize reaches the renderer node; a loaded event on an autosize flex child relays out its parent', async () => {
    let count = 0;
    let row!: lng.ElementNode;
    let auto!: lng.ElementNode;
    let plain!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" onLayout={() => void count++}>
        <view ref={auto} autosize width={50} height={50} />
        <view ref={plain} width={20} height={20} />
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(auto.lng.autosize).toBe(true);
    expect(count).toBe(1);
    expect(last.x).toBe(70);

    // The renderer resized the node (e.g. to its texture) and says so.
    auto.lng.w = 120;
    (auto.lng as unknown as lng.IEventEmitter).emit('loaded', {
      type: 'texture',
      dimensions: { w: 120, h: 50 },
    });
    // Design 3.4.4: the loaded handler queues the parent for the
    // post-mutation pass (in the renderer frame, between its walks) instead of
    // laying it out synchronously, so several loads in a frame cost one pass.
    // Until 1.7 the count was 2 right after emit.
    expect(count).toBe(1);
    await waitForUpdate();
    expect(count).toBe(2);
    expect(last.x).toBe(140);
    expect(row.width).toBe(190);

    // Without autosize, a loaded event on a view child does not relay out.
    (plain.lng as unknown as lng.IEventEmitter).emit('loaded', {
      type: 'texture',
      dimensions: { w: 1, h: 1 },
    });
    await waitForUpdate();
    expect(count).toBe(2);
    dispose();
  });
});

describe('contract: text in a flex container (DOM renderer)', () => {
  it('unmeasured text (jsdom 0 x 0): the flex pass gives up, siblings are not placed, onLayout still fires', async () => {
    let count = 0;
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10} onLayout={() => void count++}>
        <view width={50} height={50} />
        <text ref={t}>Hello</text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(t.width).toBe(0);
    expect(t.height).toBe(0);
    expect(raw(t).loaded).toBe(true);
    // Not laid out: the last child keeps the render default x = 0 and the
    // container keeps its render-time width (0 for a fit-to-content row).
    expect(t.x).toBe(0);
    expect(last.x).toBe(0);
    expect(row.width).toBe(0);
    expect(count).toBe(1);
    dispose();
  });

  it('measured text is laid out like a sized view; loaded is emitted as {type: "text", dimensions}; one flex pass', async () => {
    mockTextMeasure();
    let count = 0;
    const loaded: unknown[][] = [];
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10} onLayout={() => void count++}>
        <view width={50} height={50} />
        <text
          ref={t}
          onEvent={{
            loaded(this: unknown, ...args: unknown[]) {
              loaded.push([this, ...args]);
            },
          }}
        >
          Hello
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    // Measured synchronously when the renderer node is created.
    expect(t.width).toBe(5 * CHAR_W);
    expect(t.height).toBe(LINE_H);
    await waitForUpdate();
    expect(t.x).toBe(60);
    expect(last.x).toBe(120);
    expect(row.width).toBe(170);
    expect(row.height).toBe(50);
    expect(loaded).toEqual([
      [t, t, { type: 'text', dimensions: { w: 50, h: 20 } }],
    ]);
    // The loaded handler queues the container, which render() already queued:
    // one flex pass, so onLayout fires once.
    expect(count).toBe(1);
    dispose();
  });

  it('flex waits for the text size: nothing is placed until the text is measured, then loaded relays out', async () => {
    const spy = mockTextMeasure();
    // Hold the font-ready measurement and report 0 x 0 until then.
    spy.mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          toJSON() {},
        }) as DOMRect,
    );
    const fonts = document.fonts as unknown as { ready: Promise<unknown> };
    const savedReady = fonts.ready;
    let fontsReady!: () => void;
    fonts.ready = new Promise<void>((r) => (fontsReady = r));
    let dispose = () => {};
    try {
      let count = 0;
      let row!: lng.ElementNode;
      let t!: lng.ElementNode;
      let last!: lng.ElementNode;
      dispose = renderer.render(() => (
        <view ref={row} display="flex" gap={10} onLayout={() => void count++}>
          <text ref={t}>Hello</text>
          <view ref={last} width={50} height={50} />
        </view>
      ));
      await waitForUpdate();
      expect(raw(t).loaded).toBe(false);
      expect(last.x).toBe(0);
      expect(row.width).toBe(0);
      expect(count).toBe(1);

      spy.mockRestore();
      mockTextMeasure();
      fontsReady();
      await waitForUpdate();
      await nextTask();
      expect(raw(t).loaded).toBe(true);
      expect(t.width).toBe(50);
      expect(last.x).toBe(60);
      expect(row.width).toBe(110);
      expect(row.height).toBe(50);
      expect(count).toBe(2);
    } finally {
      fontsReady();
      fonts.ready = savedReady;
      await waitForUpdate();
      dispose();
    }
  });

  it('a text change relays out after the re-measure (not synchronously), once', async () => {
    mockTextMeasure();
    const [label, setLabel] = s.createSignal('Hello');
    let count = 0;
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10} onLayout={() => void count++}>
        <text ref={t}>{label()}</text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(last.x).toBe(60);
    expect(count).toBe(1);

    setLabel('Hello world');
    expect(t.text).toBe('Hello world');
    expect(last.x).toBe(60); // stale until the renderer re-measures
    await waitForUpdate();
    await nextTask();
    expect(t.width).toBe(110);
    expect(last.x).toBe(120);
    expect(row.width).toBe(170);
    expect(count).toBe(2);
    dispose();
  });

  it('contain "width": flex uses maxWidth as the item width and the measured height', async () => {
    mockTextMeasure();
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10}>
        <text ref={t} contain="width" width={300}>
          Hello
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(t.width).toBe(300);
    expect(t.height).toBe(LINE_H);
    expect(last.x).toBe(310);
    expect(row.width).toBe(360);
    dispose();
  });

  it('contain "width" + maxLines={1}: flex uses maxWidth x maxHeight (fontSize) and a text change does not relay out', async () => {
    mockTextMeasure();
    const [label, setLabel] = s.createSignal('Hello');
    let count = 0;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10} onLayout={() => void count++}>
        <text ref={t} contain="width" width={300} maxLines={1} fontSize={30}>
          {label()}
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(t.width).toBe(300);
    expect(t.height).toBe(30);
    expect(last.x).toBe(310);
    const before = count;

    setLabel('Hello there, a much longer title');
    await waitForUpdate();
    expect(count).toBe(before);
    expect(last.x).toBe(310);
    dispose();
  });

  it('contain "both": flex uses width x height (= maxWidth x maxHeight)', async () => {
    mockTextMeasure();
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10}>
        <text ref={t} contain="both" width={300} height={40}>
          Hello
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(t.width).toBe(300);
    expect(t.height).toBe(40);
    expect(last.x).toBe(310);
    dispose();
  });

  it('an explicit width on a text without contain is replaced by the measured width', async () => {
    mockTextMeasure();
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10}>
        <text ref={t} width={300}>
          Hello
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(t.width).toBe(50);
    expect(last.x).toBe(60);
    dispose();
  });

  it('flexGrow next to a text (docs example): the grow item takes the rest and follows the text size', async () => {
    mockTextMeasure();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [label, setLabel] = s.createSignal('Flex Grow');
    let t!: lng.ElementNode;
    let grow!: lng.ElementNode;
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} width={600} display="flex" gap={20} height={42}>
        <text ref={t}>{label()}</text>
        <view ref={grow} flexGrow={1} height={4} />
      </view>
    ));
    await waitForUpdate();
    expect(t.width).toBe(90);
    expect(grow.x).toBe(110);
    expect(grow.width).toBe(490);
    expect(row.width).toBe(600);

    // B8: the grow item shrinks to 600 - 180 - 20 = 400. Before the fix the
    // grown width was the item's base on the next pass, so it kept 490 and
    // the row overflowed (200 + 490 = 690 > 600).
    setLabel('Flex Grow Longer!!');
    await waitForUpdate();
    await nextTask();
    expect(t.width).toBe(180);
    expect(grow.x).toBe(200);
    expect(grow.width).toBe(400);

    // A shorter text lets it grow again.
    setLabel('Flex');
    await waitForUpdate();
    await nextTask();
    expect(grow.x).toBe(60);
    expect(grow.width).toBe(540);
    expect(warn).not.toHaveBeenCalled();
    dispose();
  });
});
