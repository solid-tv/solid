/**
 * Contract tests: text props, text children, font defaults,
 * autosize, and text inside flex containers, on a headless RendererCore
 * (tests/setup.ts) with the Box test font (tests/fonts.ts) under
 * Config.fontSettings' family.
 *
 * The core lays text out for real: a text is measured in the frame that
 * visits it (`tick()`, which `waitForUpdate()` drives), and `loaded` is the
 * core's. A text in a flex container (or one with onLayout) is measured by
 * Solid itself first (`measureText()`, the renderer's synchronous layout), in
 * the post-mutation pass before its container's flex (1.7, stream T), unless
 * its font has not arrived: it then waits for the frame that lays it out.
 * The Box font advances 8 per glyph at design size 10 (the space 5):
 * at fontSize 12.5 that is 10 per glyph, and lineHeight 20 gives 20 px lines,
 * the metrics of 1.x's measure mock here (10 px per character, 20 px per
 * line), so the flex cases write `{...MOCK}` on their texts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as s from 'solid-js';
import type { TextState } from '@solidtv/renderer';
import * as lng from '@solidtv/solid';
import { core, renderer, waitForUpdate } from './setup.js';
import { boxFont } from './fonts.js';

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

  // B11: the margin array counts as in flex ([top, right, bottom, left]).
  it('contain "both" without a size: the margin array counts too', () => {
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <text ref={t} contain="both" x={100} y={50} margin={[0, 40, 30, 0]}>
          B
        </text>
      </view>
    ));
    expect(raw(t).maxWidth).toBe(660);
    expect(raw(t).maxHeight).toBe(520);
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
    // 1.8's design 3.4.4: the loaded handler queues the parent for the
    // post-mutation pass (in the renderer frame, between its walks) instead
    // of laying it out synchronously, so several loads in a frame cost one
    // pass. Until 1.7 the count was 2 right after the event.
    expect(count).toBe(1);
    await waitForUpdate();
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

  it('measured text is laid out like a sized view; loaded is emitted as {type: "text", dimensions}; one pass', async () => {
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
    // Solid measured the text before the container's flex (the post-mutation
    // pass): one flex pass, so onLayout fires once (1.x too).
    expect(count).toBe(1);
    dispose();
  });

  // 1.7 (stream T): Solid measures a flex text itself; it waits for
  // `loaded` (once) only while the text's font is not loaded.
  it('flex waits for the text size: nothing is placed until the font loads and the text is measured, then loaded relays out', async () => {
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

  it('flexGrow next to a text (docs example): the grow item takes the rest and follows the text size', async () => {
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

    // B8: the grow item shrinks to 600 - 165 - 20 = 415. Before the fix the
    // grown width was the item's base on the next pass, so it kept 493.75
    // and the row overflowed (185 + 493.75 > 600).
    setLabel('Flex Grow Longer!!');
    s.flush();
    await waitForUpdate();
    expect(t.width).toBe(165);
    expect(grow.x).toBe(185);
    expect(grow.width).toBe(415);

    // A shorter text lets it grow again.
    setLabel('Flex');
    s.flush();
    await waitForUpdate();
    expect(grow.x).toBe(60);
    expect(grow.width).toBe(540);
    expect(warn).not.toHaveBeenCalled();
    dispose();
  });
});

/** After the post-mutation microtask that a write queued (nothing else). */
const microtask = () => Promise.resolve();

describe('contract: Solid measures text before flex (1.7, stream T)', () => {
  it('a text change is measured and laid out in the post-mutation microtask, once', async () => {
    const [label, setLabel] = s.createSignal('Hello');
    let count = 0;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10} onLayout={() => void count++}>
        <text ref={t} {...MOCK}>
          {label()}
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(last.x).toBe(60);
    count = 0;

    setLabel('Hello world');
    s.flush();
    expect(last.x).toBe(60); // not synchronously
    await microtask();
    // Until 1.7: after the renderer's own layout and its `loaded`. 10
    // glyphs and a space (6.25 at this size; 1.8's mock: 110).
    expect(t.width).toBe(106.25);
    expect(last.x).toBe(116.25);
    expect(count).toBe(1);
    await waitForUpdate();
    expect(count).toBe(1);
    dispose();
  });

  it('updateLayout() right after a text change measures the text first', () => {
    const [label, setLabel] = s.createSignal('Hello');
    let row!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10}>
        <text {...MOCK}>{label()}</text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    row.updateLayout();
    expect(last.x).toBe(60);

    setLabel('Hello world');
    s.flush();
    row.updateLayout();
    expect(last.x).toBe(116.25); // 1.8's mock: 120
    dispose();
  });

  it('a text change that keeps the measured size lays nothing out', async () => {
    const [label, setLabel] = s.createSignal('Hello');
    let count = 0;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10} onLayout={() => void count++}>
        <text {...MOCK}>{label()}</text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    count = 0;

    setLabel('World'); // 5 glyphs, as before
    s.flush();
    await waitForUpdate();
    expect(count).toBe(0);
    expect(last.x).toBe(60);
    dispose();
  });

  it('every font prop the text layout reads lays the container out again: fontSize, lineHeight, letterSpacing, fontFamily, fontWeight', async () => {
    // 'Wide': the Box font with every advance doubled; 'Wide700' (what
    // fontWeight bold makes of it) is the Box font again.
    const fonts = core.fonts;
    const savedFetch = fonts.fetch;
    const wide = boxFont();
    for (const c of wide.chars) c.xadvance *= 2;
    fonts.fetch = () => Promise.resolve(wide);
    core
      .loadFont({ fontFamily: 'Wide', atlasUrl: 'box.png', atlasDataUrl: 'w' })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    fonts.fetch = () => Promise.resolve(boxFont());
    core
      .loadFont({
        fontFamily: 'Wide700',
        atlasUrl: 'box.png',
        atlasDataUrl: 'w700',
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    fonts.fetch = savedFetch;

    const [size, setSize] = s.createSignal(20);
    const [lineHeight, setLineHeight] = s.createSignal(1);
    const [spacing, setSpacing] = s.createSignal(0);
    const [family, setFamily] = s.createSignal(
      lng.Config.fontSettings.fontFamily!,
    );
    let count = 0;
    let row!: lng.ElementNode;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10} onLayout={() => void count++}>
        <text
          ref={t}
          fontSize={size()}
          lineHeight={lineHeight()}
          letterSpacing={spacing()}
          fontFamily={family()}
        >
          Hello
        </text>
        <view ref={last} width={50} height={10} />
      </view>
    ));
    await waitForUpdate();
    // Box at fontSize 20: 16 per glyph, letterSpacing between glyphs; a
    // lineHeight of 1 is the font size. (1.8's mock: fontSize / 2 per
    // character plus letterSpacing each, so 50 + 10.)
    expect(last.x).toBe(90); // 5 * 16 + 10
    expect(row.height).toBe(20);

    const step = async (change: () => void, x: number, height: number) => {
      count = 0;
      change();
      s.flush();
      await microtask();
      expect([last.x, row.height, count]).toEqual([x, height, 1]);
    };
    await step(() => setSize(40), 170, 40); // 5 * 32 + 10 (1.8: 110)
    await step(() => setLineHeight(50), 170, 50);
    await step(() => setSpacing(2), 178, 50); // 5 * 32 + 4 * 2 + 10 (1.8: 120)
    await step(() => setFamily('Wide'), 338, 50); // 5 * 64 + 4 * 2 + 10 (1.8: 220)
    // fontWeight renames the family ('Wide700'): no longer wide.
    await step(() => (t.fontWeight = 'bold'), 178, 50); // (1.8: 120)
    dispose();
  });

  it('a maxWidth change on a contained text lays the container out again', async () => {
    const [width, setWidth] = s.createSignal(300);
    let count = 0;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" flexDirection="column" onLayout={() => void count++}>
        <text contain="width" maxWidth={width()} fontSize={20} lineHeight={20}>
          Hello world twice
        </text>
        <view ref={last} width={50} height={10} />
      </view>
    ));
    await waitForUpdate();
    // 15 glyphs of 16 and two spaces of 10: 260, one line of 20. (1.8:
    // 'Hello world, twice', 180 at its mock; Box has no comma.)
    expect(last.y).toBe(20);
    count = 0;

    setWidth(100); // a word a line: three lines (1.8: two)
    s.flush();
    await microtask();
    expect(last.y).toBe(60); // 1.8: 40
    expect(count).toBe(1);
    dispose();
  });

  it('a new text in a flex container is measured once, in the post-mutation pass, with the writes of its tick; text in a plain view is not measured by Solid', async () => {
    const measure = vi.spyOn(core.textNodes, 'measure');
    const [label, setLabel] = s.createSignal('Hello');
    let inFlex!: lng.ElementNode;
    const d2 = renderer.render(() => (
      <view display="flex">
        <text ref={inFlex}>{label()}</text>
      </view>
    ));
    setLabel('Hello again');
    s.flush();
    expect(measure).not.toHaveBeenCalled();
    await microtask();
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure.mock.calls[0]![0]).toBe(inFlex.slot);
    d2();

    measure.mockClear();
    const d3 = renderer.render(() => (
      <view>
        <text>Hello</text>
      </view>
    ));
    await waitForUpdate();
    expect(measure).not.toHaveBeenCalled();
    d3();
  });

  it('an onEvent.loaded on a flex text hears every new size, after Solid measured it first', async () => {
    const [label, setLabel] = s.createSignal('Hello');
    const heard: unknown[] = [];
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10}>
        <text
          {...MOCK}
          onEvent={{
            loaded(_el, payload) {
              heard.push((payload as { dimensions: unknown }).dimensions);
            },
          }}
        >
          {label()}
        </text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(heard).toEqual([{ width: 50, height: 20 }]);

    setLabel('Hello world');
    s.flush();
    await microtask();
    expect(last.x).toBe(116.25); // Solid measured and laid out first
    await waitForUpdate(); // the frame delivers `loaded`
    expect(heard).toEqual([
      { width: 50, height: 20 },
      { width: 106.25, height: 20 },
    ]);
    dispose();
  });
});
