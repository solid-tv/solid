/**
 * Contract tests: text props, text children, font defaults,
 * autosize, and text inside flex containers, on a headless RendererCore
 * (tests/setup.ts) with the Box test font (tests/fonts.ts) under
 * Config.fontSettings' family.
 *
 * The core lays text out for real: a text is measured in the frame that
 * visits it (`tick()`, which `waitForUpdate()` drives), and `loaded` is the
 * core's. The Box font advances 8 per glyph at design size 10 (the space 5):
 * at fontSize 12.5 that is 10 per glyph, and lineHeight 20 gives 20 px lines,
 * the metrics of 1.x's measure mock here (10 px per character, 20 px per
 * line), so the flex cases write `{...MOCK}` on their texts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as s from 'solid-js';
import type { TextState } from '@solidtv/renderer';
import * as lng from '@solidtv/solid';
import { core, renderer, waitForUpdate } from './setup.js';

const CHAR_W = 10;
const LINE_H = 20;
/** Box at 10 px per glyph (6.25 per space) and 20 px lines. */
const MOCK = { fontSize: 12.5, lineHeight: LINE_H };

/** The text's renderer state (1.x read it off the renderer node, `lng`). */
// The store keeps a TextState for every text slot.
const raw = (el: lng.ElementNode) => core.nodes.texts[el.slot] as TextState;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('contract: text children concatenated from several JSX expressions', () => {
  it('static text and several expressions concatenate into el.text and the renderer text state', () => {
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
    s.flush();
    expect(t.text).toBe('Hello Zed and Ann');
    expect(raw(t).text).toBe('Hello Zed and Ann');
    setOther('Kim');
    s.flush();
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
    s.flush();
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
    s.flush();
    expect(t.text).toBe('ABC');
    expect(raw(t).text).toBe('ABC');
    setShow(false);
    s.flush();
    expect(t.text).toBe('AC');
    dispose();
  });
});

describe('contract: text props reach the renderer text state', () => {
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
    expect(raw(t).maxHeight).toBe(0); // renderer default: unset
    // el.width reads maxWidth first (elementNode.ts: width = maxWidth || w).
    expect(t.width).toBe(300);
    dispose();
  });

  it('contain "width" without a width: maxWidth = parent width - x (marginRight is ignored today)', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text ref={t} contain="width" x={100} marginRight={40}>
          B
        </text>
      </view>
    ));
    expect(raw(t).maxWidth).toBe(700);
    expect(raw(t).maxLines).toBe(99);
    dispose();
  });

  // BUG: src/core/elementNode.ts:1612 (and :1617 for marginBottom) reads
  // marginRight from the renderer props bag, where it is never stored (margins
  // live on the ElementNode), so the subtraction is always 0.
  it.skip('BUG: contain "width" without a width subtracts marginRight from maxWidth', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text ref={t} contain="width" x={100} marginRight={40}>
          B
        </text>
      </view>
    ));
    expect(raw(t).maxWidth).toBe(660);
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
    expect(raw(t).maxLines).toBe(0); // renderer default: unset
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

  it('unset text props get the renderer defaults', () => {
    // The renderer's TextState defaults (1.x pinned the DOM renderer's:
    // lineHeight 0, wordBreak 'overflow').
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => <text ref={t}>K</text>);
    expect(raw(t).contain).toBe('none');
    expect(raw(t).textAlign).toBe('left');
    expect(raw(t).lineHeight).toBe(1.2);
    expect(raw(t).letterSpacing).toBe(0);
    expect(raw(t).overflowSuffix).toBe('...');
    expect(raw(t).wordBreak).toBe('break-word');
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
    s.flush();
    setLines(3);
    s.flush();
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

  // B17 (fixed in 1.7): the fontFamily setter used to overwrite the
  // family+weight name that `set fontWeight` wrote, so fontWeight before
  // fontFamily lost the weight ('Roboto'). Pinned before the fix as
  // 'fontWeight before fontFamily: the weight is lost'.
  it('fontWeight and fontFamily give the same family in either order (B17)', () => {
    let weightFirst!: lng.ElementNode;
    let familyFirst!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view>
        <text ref={weightFirst} fontWeight="bold" fontFamily="Roboto">
          a
        </text>
        <text ref={familyFirst} fontFamily="Roboto" fontWeight="bold">
          b
        </text>
      </view>
    ));
    expect(raw(weightFirst).fontFamily).toBe('Roboto700');
    expect(raw(familyFirst).fontFamily).toBe('Roboto700');
    dispose();
  });

  it('a fontFamily change after render keeps the weight (B17)', () => {
    const [family, setFamily] = s.createSignal('Roboto');
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <text ref={t} fontWeight="bold" fontFamily={family()}>
        a
      </text>
    ));
    expect(raw(t).fontFamily).toBe('Roboto700');
    setFamily('Ubuntu');
    s.flush();
    expect(raw(t).fontFamily).toBe('Ubuntu700');
    expect(t.fontFamily).toBe('Ubuntu');
    dispose();
  });

  // B17 follow-up: a $focus fontWeight undone on blur, on a text whose family
  // comes from Config.fontSettings, wrote no family at all (`undefined`,
  // which renderer v2 turns into 'sans-serif'); before 1.7 it wrote
  // "<family>undefined". Either way the font was lost.
  it('a $focus fontWeight undone on blur gives back the Config family (B17)', async () => {
    let a!: lng.ElementNode;
    let b!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view>
        <text ref={a} style={{ $focus: { fontWeight: 'bold' } }}>
          a
        </text>
        <text ref={b}>b</text>
      </view>
    ));
    const family = raw(a).fontFamily;
    expect(family).toBe(lng.Config.fontSettings.fontFamily);

    a.setFocus();
    await waitForUpdate();
    expect(a.states.has('$focus')).toBe(true);
    expect(raw(a).fontFamily).toBe(`${family}700`);

    b.setFocus();
    await waitForUpdate();
    expect(a.states.has('$focus')).toBe(false);
    expect(raw(a).fontFamily).toBe(family);
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
  it('autosize reaches the renderer node; a loaded event on an autosize flex child relays out its parent synchronously', async () => {
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
    expect(auto.autosize).toBe(true);
    expect(count).toBe(1);
    expect(last.x).toBe(70);

    // The renderer resized the node (e.g. to its texture) and says so: the
    // core delivers `loaded` to the node's listeners.
    auto.setNow('width', 120);
    core.events.queue(auto, 'loaded', {
      type: 'texture',
      dimensions: { width: 120, height: 50 },
    });
    core.events.flush();
    expect(count).toBe(2);
    expect(last.x).toBe(140);
    expect(row.width).toBe(190);

    // Without autosize, a loaded event on a view child does not relay out.
    core.events.queue(plain, 'loaded', {
      type: 'texture',
      dimensions: { width: 1, height: 1 },
    });
    core.events.flush();
    await waitForUpdate();
    expect(count).toBe(2);
    dispose();
  });
});

describe('contract: text in a flex container', () => {
  it('unmeasured text (its font has not arrived, 0 x 0): the flex pass gives up, siblings are not placed, onLayout still fires', async () => {
    // 1.x: jsdom measured every text 0 x 0. Here a text waits for a font
    // that is not loaded.
    let count = 0;
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10} onLayout={() => void count++}>
        <view width={50} height={50} />
        <text ref={t} fontFamily="NotLoaded">
          Hello
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(t.width).toBe(0);
    expect(t.height).toBe(0);
    expect(raw(t).layout).toBe(null);
    // Not laid out: the last child keeps the render default x = 0 and the
    // container keeps its render-time width (0 for a fit-to-content row).
    expect(t.x).toBe(0);
    expect(last.x).toBe(0);
    expect(row.width).toBe(0);
    expect(count).toBe(1);
    dispose();
  });

  it('measured text is laid out like a sized view; loaded is emitted as {type: "text", dimensions}; a pass before and one after', async () => {
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
          {...MOCK}
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
    // Measured in the first frame (1.x: synchronously, at creation).
    await waitForUpdate();
    expect(t.width).toBe(5 * CHAR_W);
    expect(t.height).toBe(LINE_H);
    expect(t.x).toBe(60);
    expect(last.x).toBe(120);
    expect(row.width).toBe(170);
    expect(row.height).toBe(50);
    expect(loaded).toEqual([
      [t, t, { type: 'text', dimensions: { width: 50, height: 20 } }],
    ]);
    // The post-mutation pass lays the container out before the frame
    // measures the text (it gives up), then the loaded handler lays it out
    // again: onLayout fires twice (1.x: once, the text was measured first).
    expect(count).toBe(2);
    dispose();
  });

  it('flex waits for the text size: nothing is placed until the text is measured, then loaded relays out', async () => {
    let count = 0;
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10} onLayout={() => void count++}>
        <text ref={t} {...MOCK} fontFamily="LateBox">
          Hello
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(raw(t).layout).toBe(null);
    expect(last.x).toBe(0);
    expect(row.width).toBe(0);
    expect(count).toBe(1);

    // The font arrives (1.x: document.fonts.ready): the Box font again,
    // under the family the text waits for.
    core
      .loadFont({
        fontFamily: 'LateBox',
        atlasUrl: 'box.png',
        atlasDataUrl: 'box.json',
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    await waitForUpdate();
    expect(raw(t).layout).not.toBe(null);
    expect(t.width).toBe(50);
    expect(last.x).toBe(60);
    expect(row.width).toBe(110);
    expect(row.height).toBe(50);
    expect(count).toBe(2);
    dispose();
  });

  it('a text change relays out after the re-measure (not synchronously), once', async () => {
    const [label, setLabel] = s.createSignal('Hello');
    let count = 0;
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10} onLayout={() => void count++}>
        <text ref={t} {...MOCK}>
          {label()}
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(last.x).toBe(60);
    const before = count;

    setLabel('Hello world');
    s.flush();
    expect(t.text).toBe('Hello world');
    expect(last.x).toBe(60); // stale until the renderer re-measures
    await waitForUpdate();
    // 10 glyphs and a space (6.25 at this size; 1.x's mock: 10).
    expect(t.width).toBe(106.25);
    expect(last.x).toBe(116.25);
    expect(row.width).toBe(166.25);
    expect(count).toBe(before + 1);
    dispose();
  });

  it('contain "width": flex uses maxWidth as the item width and the measured height', async () => {
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10}>
        <text ref={t} {...MOCK} contain="width" width={300}>
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
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10}>
        <text ref={t} {...MOCK} width={300}>
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

  it('flexGrow next to a text (docs example): the grow item takes the rest; it never shrinks back when the text grows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [label, setLabel] = s.createSignal('Flex Grow');
    let t!: lng.ElementNode;
    let grow!: lng.ElementNode;
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} width={600} display="flex" gap={20} height={42}>
        <text ref={t} {...MOCK}>
          {label()}
        </text>
        <view ref={grow} flexGrow={1} height={4} />
      </view>
    ));
    await waitForUpdate();
    // 8 glyphs and a space (1.x's mock: 90).
    expect(t.width).toBe(86.25);
    expect(grow.x).toBe(106.25);
    expect(grow.width).toBe(493.75);
    expect(row.width).toBe(600);

    // Today the grown width is the item's base on the next pass, so it keeps
    // 493.75 and the row overflows (185 + 493.75 > 600).
    setLabel('Flex Grow Longer!!');
    s.flush();
    await waitForUpdate();
    expect(t.width).toBe(165);
    expect(grow.x).toBe(185);
    expect(grow.width).toBe(493.75);

    // A shorter text lets it grow again.
    setLabel('Flex');
    s.flush();
    await waitForUpdate();
    expect(grow.x).toBe(60);
    expect(grow.width).toBe(540);
    expect(warn).not.toHaveBeenCalled();
    dispose();
  });

  // BUG: flexGrow should be computed from the item's own size each pass, so
  // the grow item shrinks to 600 - 180 - 20 = 400 when the text grows.
  // flex.ts:146 / flexLayout.ts:199 add the free space to the current
  // (already grown) width.
  it.skip('BUG: a flexGrow item shrinks back when a text sibling grows', async () => {
    const [label, setLabel] = s.createSignal('Flex Grow');
    let grow!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={600} display="flex" gap={20} height={42}>
        <text {...MOCK}>{label()}</text>
        <view ref={grow} flexGrow={1} height={4} />
      </view>
    ));
    await waitForUpdate();
    setLabel('Flex Grow Longer!!');
    await waitForUpdate();
    expect(grow.x).toBe(200);
    expect(grow.width).toBe(400);
    dispose();
  });
});
