/**
 * Flex layout with text children on the real renderer.
 *
 * Runs in Vitest browser mode (headless Chromium through Playwright, WebGL
 * on SwiftShader) against @solidtv/renderer with SDF text, not the DOM
 * renderer: SDF measurement differs from the DOM's, and text sizes arrive
 * through the renderer's `loaded` event, so these numbers only hold here.
 *
 *   pnpm test:webgl
 *   npx vitest run --config=vitest.webgl.config.ts
 *
 * Needs Playwright's Chromium once: `npx playwright install chromium`.
 * The jsdom suite (`npx vitest run`) does not include this directory.
 *
 * Every text uses Lato Regular (MSDF, tests/webgl/fonts), loaded before the
 * first render (setup.ts) except where a test says otherwise; the default
 * font size is 30 (Config.fontSettings). `settle()` waits until the
 * renderer has no scene update pending for two frames in a row.
 *
 * The numbers are the final positions and sizes, after fonts load, on
 * solid 1.6.4 with SDF text on renderer 1.9. They are not derived from a
 * formula, they were read from a run; the comments show how they add up.
 * Each one is compared with
 * `expect.closeTo(n, 3)`, |actual - expected| < 0.0005: flex.ts sums child
 * sizes in Float32Arrays, so positions carry float32 rounding (109.70999908
 * for 109.71) while text sizes are float64.
 *
 * Only final states are asserted. Intermediate ones (a container before its
 * texts have sizes, the number of frames, `loaded` events and flex
 * passes) are printed with console.info for information: a change to
 * Solid or the renderer may change them. Add `--reporter=verbose` if the reporter hides them.
 */
import * as v from 'vitest';
import * as s from 'solid-js';
import { loadFonts, type ElementNode } from '@solidtv/solid';
import { frameCount, latoFont, render, settle } from './setup.js';

/** x, y, width and height, as the app reads them from the ElementNode. */
function expectBox(
  node: ElementNode,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  v.expect({
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }).toEqual({
    x: v.expect.closeTo(x, 3),
    y: v.expect.closeTo(y, 3),
    width: v.expect.closeTo(width, 3),
    height: v.expect.closeTo(height, 3),
  });
}

const info = (...args: unknown[]) =>
  console.info(
    '[flex-text]',
    ...args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))),
  );

// Lato at the default size 30: a line is 43.2 high.
const LINE_30 = 43.2;

v.test('a row of text children with gap and padding', async () => {
  let row!: ElementNode;
  let home!: ElementNode;
  let movies!: ElementNode;
  let shows!: ElementNode;

  const f0 = frameCount();
  const dispose = render(() => (
    <view ref={row} display="flex" gap={20} padding={10}>
      <text ref={home}>Home</text>
      <text ref={movies}>Movies</text>
      <text ref={shows}>Series and Shows</text>
    </view>
  ));
  await settle();
  info('row of 3 texts, first render: frames', frameCount() - f0);

  // Padding on the main axis only: y stays 0.
  expectBox(home, 10, 0, 79.71, LINE_30);
  expectBox(movies, 109.71, 0, 95.67, LINE_30); // 10 + 79.71 + 20
  expectBox(shows, 225.38, 0, 225.63, LINE_30); // 109.71 + 95.67 + 20
  // Width fits the children: 225.38 + 225.63 + 10. Height: the tallest.
  expectBox(row, 0, 0, 461.01, LINE_30);

  dispose();
});

const Tile = (props: {
  ref?: (el: ElementNode) => void;
  title: string;
  subtitle: string;
  description: string;
  titleRef?: (el: ElementNode) => void;
  subtitleRef?: (el: ElementNode) => void;
  descriptionRef?: (el: ElementNode) => void;
}) => (
  <view
    ref={props.ref}
    display="flex"
    flexDirection="column"
    width={300}
    gap={8}
    padding={12}
  >
    <text ref={props.titleRef} fontSize={32}>
      {props.title}
    </text>
    <text ref={props.subtitleRef} fontSize={22}>
      {props.subtitle}
    </text>
    <text
      ref={props.descriptionRef}
      fontSize={20}
      contain="width"
      width={276}
      maxLines={2}
    >
      {props.description}
    </text>
  </view>
);

v.test(
  'a column tile: title, subtitle and a contained description',
  async () => {
    let tile!: ElementNode;
    let title!: ElementNode;
    let subtitle!: ElementNode;
    let description!: ElementNode;

    const dispose = render(() => (
      <Tile
        ref={(el) => (tile = el)}
        titleRef={(el) => (title = el)}
        subtitleRef={(el) => (subtitle = el)}
        descriptionRef={(el) => (description = el)}
        title="Title"
        subtitle="Subtitle"
        description="A description long enough to wrap onto a second line of the tile."
      />
    ));
    await settle();

    // Padding on the main axis only: x stays 0 in a column.
    expectBox(title, 0, 12, 63.968, 46.08);
    expectBox(subtitle, 0, 66.08, 75.394, 31.68); // 12 + 46.08 + 8
    // contain="width": width reads maxWidth (276), two lines of 28.8.
    expectBox(description, 0, 105.76, 276, 57.6); // 66.08 + 31.68 + 8
    v.expect(description.lng.w).toBeCloseTo(271.7, 3); // the laid-out lines
    // Width as given; height fits: 105.76 + 57.6 + 12.
    expectBox(tile, 0, 0, 300, 175.36);

    dispose();
  },
);

v.test('a row of column tiles takes the tallest tile', async () => {
  let row!: ElementNode;
  const tiles: ElementNode[] = [];
  const titles: ElementNode[] = [];
  const descriptions: ElementNode[] = [];

  const dispose = render(() => (
    <view ref={row} display="flex" gap={24}>
      <Tile
        ref={(el) => (tiles[0] = el)}
        titleRef={(el) => (titles[0] = el)}
        descriptionRef={(el) => (descriptions[0] = el)}
        title="Short"
        subtitle="One line"
        description="Fits."
      />
      <Tile
        ref={(el) => (tiles[1] = el)}
        titleRef={(el) => (titles[1] = el)}
        descriptionRef={(el) => (descriptions[1] = el)}
        title="A longer title"
        subtitle="Subtitle two"
        description="This description is long enough that it has to be cut off after the second line, with more words."
      />
      <Tile
        ref={(el) => (tiles[2] = el)}
        titleRef={(el) => (titles[2] = el)}
        descriptionRef={(el) => (descriptions[2] = el)}
        title="Third"
        subtitle="Sub"
        description="Two lines of description text for the third tile here."
      />
    </view>
  ));
  await settle();

  expectBox(titles[0]!, 0, 12, 77.376, 46.08);
  expectBox(titles[1]!, 0, 12, 180.928, 46.08);
  expectBox(titles[2]!, 0, 12, 75.648, 46.08);
  // One line; two lines; cut at maxLines 2.
  expectBox(descriptions[0]!, 0, 105.76, 276, 28.8);
  expectBox(descriptions[1]!, 0, 105.76, 276, 57.6);
  expectBox(descriptions[2]!, 0, 105.76, 276, 57.6);

  expectBox(tiles[0]!, 0, 0, 300, 146.56); // 105.76 + 28.8 + 12
  expectBox(tiles[1]!, 324, 0, 300, 175.36); // 105.76 + 57.6 + 12
  expectBox(tiles[2]!, 648, 0, 300, 175.36);
  // 3 * 300 + 2 * 24; the tallest tile.
  expectBox(row, 0, 0, 948, 175.36);

  dispose();
});

v.test('justifyContent center with text children', async () => {
  let row!: ElementNode;
  let left!: ElementNode;
  let middle!: ElementNode;

  const dispose = render(() => (
    <view ref={row} display="flex" justifyContent="center" width={800} gap={20}>
      <text ref={left}>Left</text>
      <text ref={middle}>Middle text</text>
    </view>
  ));
  await settle();

  // (800 - (51.9 + 20 + 150.33)) / 2
  expectBox(left, 288.885, 0, 51.9, LINE_30);
  expectBox(middle, 360.785, 0, 150.33, LINE_30); // 288.885 + 51.9 + 20
  expectBox(row, 0, 0, 800, LINE_30);

  dispose();
});

v.test(
  'justifyContent spaceBetween with padding and text children',
  async () => {
    let row!: ElementNode;
    let first!: ElementNode;
    let second!: ElementNode;
    let third!: ElementNode;

    const dispose = render(() => (
      <view
        ref={row}
        display="flex"
        justifyContent="spaceBetween"
        width={800}
        padding={20}
      >
        <text ref={first}>First</text>
        <text ref={second}>Second item</text>
        <text ref={third}>Third</text>
      </view>
    ));
    await settle();

    // Space: (800 - 2 * 20 - (60.96 + 160.77 + 70.92)) / 2 = 233.675
    expectBox(first, 20, 0, 60.96, LINE_30);
    expectBox(second, 314.635, 0, 160.77, LINE_30); // 20 + 60.96 + 233.675
    expectBox(third, 709.08, 0, 70.92, LINE_30); // 800 - 20 - 70.92
    expectBox(row, 0, 0, 800, LINE_30);

    dispose();
  },
);

v.test(
  'justifyContent and alignItems center on a fixed-height row',
  async () => {
    let row!: ElementNode;
    let small!: ElementNode;
    let large!: ElementNode;

    const dispose = render(() => (
      <view
        ref={row}
        display="flex"
        justifyContent="center"
        alignItems="center"
        width={800}
        height={100}
      >
        <text ref={small} fontSize={20}>
          small
        </text>
        <text ref={large} fontSize={50}>
          Large
        </text>
      </view>
    ));
    await settle();

    // x: (800 - (45.48 + 122.95)) / 2; y: (100 - height) / 2
    expectBox(small, 315.785, 35.6, 45.48, 28.8);
    expectBox(large, 361.265, 14, 122.95, 72);
    expectBox(row, 0, 0, 800, 100);

    dispose();
  },
);

v.test(
  'a text whose content changes in a flex row lays the row out again',
  async () => {
    const [label, setLabel] = s.createSignal('Short');
    let row!: ElementNode;
    let prev!: ElementNode;
    let middle!: ElementNode;
    let next!: ElementNode;
    let loaded = 0;
    let flexPasses = 0;

    const dispose = render(() => (
      <view
        ref={row}
        display="flex"
        gap={20}
        onLayout={() => {
          flexPasses++;
        }}
      >
        <text ref={prev}>Prev</text>
        <text
          ref={middle}
          onEvent={{
            loaded: () => {
              loaded++;
            },
          }}
        >
          {label()}
        </text>
        <text ref={next}>Next</text>
      </view>
    ));
    await settle();
    info('3 texts, first render: flex passes on the row', flexPasses);

    expectBox(prev, 0, 0, 61.11, LINE_30);
    expectBox(middle, 81.11, 0, 72.54, LINE_30); // 61.11 + 20
    expectBox(next, 173.65, 0, 63.81, LINE_30); // 81.11 + 72.54 + 20
    expectBox(row, 0, 0, 237.46, LINE_30);

    const measure = async (text: string) => {
      loaded = 0;
      flexPasses = 0;
      const f0 = frameCount();
      setLabel(text);
      await settle();
      info(
        `text change to "${text}": frames ${frameCount() - f0},` +
          ` loaded events ${loaded}, flex passes on the row ${flexPasses}`,
      );
    };

    await measure('A much longer label');
    expectBox(prev, 0, 0, 61.11, LINE_30);
    expectBox(middle, 81.11, 0, 257.01, LINE_30);
    expectBox(next, 358.12, 0, 63.81, LINE_30); // 81.11 + 257.01 + 20
    expectBox(row, 0, 0, 421.93, LINE_30);

    await measure('Hi');
    expectBox(prev, 0, 0, 61.11, LINE_30);
    expectBox(middle, 81.11, 0, 30.36, LINE_30);
    expectBox(next, 131.47, 0, 63.81, LINE_30); // 81.11 + 30.36 + 20
    expectBox(row, 0, 0, 195.28, LINE_30);

    dispose();
  },
);

v.test(
  'a text concatenated from several expressions in a flex row',
  async () => {
    const [episode, setEpisode] = s.createSignal('1');
    const total = '12';
    let row!: ElementNode;
    let label!: ElementNode;
    let next!: ElementNode;

    const dispose = render(() => (
      <view ref={row} display="flex" gap={20}>
        <text ref={label}>
          Episode {episode()} of {total}
        </text>
        <text ref={next}>Next</text>
      </view>
    ));
    await settle();

    v.expect(label.text).toBe('Episode 1 of 12');
    expectBox(label, 0, 0, 200.22, LINE_30);
    expectBox(next, 220.22, 0, 63.81, LINE_30);
    expectBox(row, 0, 0, 284.03, LINE_30);

    setEpisode('10');
    await settle();

    v.expect(label.text).toBe('Episode 10 of 12');
    expectBox(label, 0, 0, 217.62, LINE_30);
    expectBox(next, 237.62, 0, 63.81, LINE_30);
    expectBox(row, 0, 0, 301.43, LINE_30);

    dispose();
  },
);

v.test('text with a fixed width and contain in a flex row', async () => {
  let widthRow!: ElementNode;
  let widthText!: ElementNode;
  let widthAfter!: ElementNode;
  let bothRow!: ElementNode;
  let bothText!: ElementNode;
  let bothAfter!: ElementNode;

  const dispose = render(() => (
    <>
      <view ref={widthRow} display="flex" gap={10}>
        <text ref={widthText} width={200} contain="width" maxLines={1}>
          Fixed width label that is long
        </text>
        <text ref={widthAfter}>After</text>
      </view>
      <view ref={bothRow} display="flex" gap={10} y={100}>
        <text
          ref={bothText}
          width={150}
          height={60}
          contain="both"
          fontSize={24}
        >
          Contained both ways with a lot of words
        </text>
        <text ref={bothAfter}>After</text>
      </view>
    </>
  ));
  await settle();

  // contain="width", maxLines 1: width reads maxWidth (200) and height
  // maxHeight, which Solid sets to the font size (30) without a lineHeight,
  // though the laid-out line is 43.2 high.
  expectBox(widthText, 0, 0, 200, 30);
  v.expect(widthText.lng.w).toBeCloseTo(171.54, 3);
  v.expect(widthText.lng.h).toBeCloseTo(LINE_30, 3);
  expectBox(widthAfter, 210, 0, 69.51, LINE_30); // 200 + 10
  expectBox(widthRow, 0, 0, 279.51, LINE_30);

  // contain="both": width and height read maxWidth and maxHeight; one line
  // of 34.56 fits in 60.
  expectBox(bothText, 0, 0, 150, 60);
  v.expect(bothText.lng.w).toBeCloseTo(124.992, 3);
  v.expect(bothText.lng.h).toBeCloseTo(34.56, 3);
  expectBox(bothAfter, 160, 0, 69.51, LINE_30); // 150 + 10
  expectBox(bothRow, 0, 100, 229.51, 60);

  dispose();
});

v.test(
  'a width on a text without contain is replaced by the layout',
  async () => {
    let row!: ElementNode;
    let text!: ElementNode;
    let after!: ElementNode;

    const dispose = render(() => (
      <view ref={row} display="flex" gap={10}>
        <text ref={text} width={300}>
          Width only
        </text>
        <text ref={after}>After</text>
      </view>
    ));
    await settle();

    // The 300 is only the size before the first layout.
    expectBox(text, 0, 0, 145.08, LINE_30);
    expectBox(after, 155.08, 0, 69.51, LINE_30); // 145.08 + 10
    expectBox(row, 0, 0, 224.59, LINE_30);

    dispose();
  },
);

v.test('a text with flexItem={false} is left out of the row', async () => {
  let row!: ElementNode;
  let one!: ElementNode;
  let badge!: ElementNode;
  let two!: ElementNode;

  const dispose = render(() => (
    <view ref={row} display="flex" gap={10}>
      <text ref={one}>One</text>
      <text ref={badge} flexItem={false} x={500} y={50}>
        Badge
      </text>
      <text ref={two}>Two</text>
    </view>
  ));
  await settle();

  expectBox(one, 0, 0, 56.34, LINE_30);
  expectBox(badge, 500, 50, 82.44, LINE_30); // where it was put
  expectBox(two, 66.34, 0, 55.26, LINE_30); // 56.34 + 10: no gap for the badge
  expectBox(row, 0, 0, 121.6, LINE_30); // the badge is not counted

  dispose();
});

v.test('nested flex containers with text', async () => {
  let column!: ElementNode;
  let title!: ElementNode;
  let rowOne!: ElementNode;
  let alpha!: ElementNode;
  let beta!: ElementNode;
  let rowTwo!: ElementNode;
  let gamma!: ElementNode;
  let delta!: ElementNode;

  const f0 = frameCount();
  const dispose = render(() => (
    <view
      ref={column}
      display="flex"
      flexDirection="column"
      gap={10}
      padding={20}
      x={100}
      y={50}
    >
      <text ref={title} fontSize={40}>
        Section
      </text>
      <view ref={rowOne} display="flex" gap={15}>
        <text ref={alpha}>Alpha</text>
        <text ref={beta}>Beta</text>
      </view>
      <view ref={rowTwo} display="flex" gap={15} padding={5}>
        <text ref={gamma} fontSize={24}>
          Gamma
        </text>
        <text ref={delta} fontSize={36}>
          Delta Epsilon
        </text>
      </view>
    </view>
  ));
  await settle();
  info('nested column of rows, first render: frames', frameCount() - f0);

  expectBox(title, 0, 20, 130.48, 57.6);
  expectBox(alpha, 0, 0, 76.53, LINE_30);
  expectBox(beta, 91.53, 0, 61.53, LINE_30); // 76.53 + 15
  expectBox(rowOne, 0, 87.6, 153.06, LINE_30); // y: 20 + 57.6 + 10
  expectBox(gamma, 5, 0, 81.36, 34.56);
  expectBox(delta, 101.36, 0, 208.692, 51.84); // 5 + 81.36 + 15
  // y: 87.6 + 43.2 + 10; width: 101.36 + 208.692 + 5; height: the tallest
  // text (no cross-axis padding).
  expectBox(rowTwo, 0, 140.8, 315.052, 51.84);
  // A column fills its parent's width (1920 - 100); its height fits:
  // 140.8 + 51.84 + 20.
  expectBox(column, 100, 50, 1820, 212.64);

  dispose();
});

// Renderer 1.9 creates a text only for a family that is loaded or loading
// (Stage.createTextNode throws "No compatible text renderer found" for any
// other), so the load starts first, as an app's loadFonts call before its
// first render. The files are Lato's, already fetched, so the font may well
// arrive before the first frame: only the layout after it is asserted.
v.test(
  'text rendered after loadFonts() for its family lays out with that font',
  async () => {
    let row!: ElementNode;
    let home!: ElementNode;
    let movies!: ElementNode;
    let shows!: ElementNode;

    // A family whose load has started but not finished.
    const fontLoaded = loadFonts([latoFont('LatoLate')]);
    const dispose = render(() => (
      <view ref={row} display="flex" gap={20} padding={10}>
        <text ref={home} fontFamily="LatoLate">
          Home
        </text>
        <text ref={movies} fontFamily="LatoLate">
          Movies
        </text>
        <text ref={shows} fontFamily="LatoLate">
          Series and Shows
        </text>
      </view>
    ));
    await settle();
    info(
      'first settle: row',
      [row.width, row.height],
      'texts',
      [home, movies, shows].map((t) => [t.x, t.width, t.height]),
    );

    await fontLoaded;
    await settle();

    // The same as with the font loaded first (the first test).
    expectBox(home, 10, 0, 79.71, LINE_30);
    expectBox(movies, 109.71, 0, 95.67, LINE_30);
    expectBox(shows, 225.38, 0, 225.63, LINE_30);
    expectBox(row, 0, 0, 461.01, LINE_30);

    dispose();
  },
);

v.test(
  'text in a row hidden with alpha 0 lays out when the row is shown',
  async () => {
    const [alpha, setAlpha] = s.createSignal(0);
    let row!: ElementNode;
    let one!: ElementNode;
    let two!: ElementNode;

    const dispose = render(() => (
      <view ref={row} display="flex" gap={10} alpha={alpha()}>
        <text ref={one}>One</text>
        <text ref={two}>Two</text>
      </view>
    ));
    await settle();
    info(
      'under alpha 0: row',
      [row.width, row.height],
      'texts',
      [one, two].map((t) => [t.x, t.width, t.height]),
    );

    const f0 = frameCount();
    setAlpha(1);
    await settle();
    info(`shown: frames ${frameCount() - f0}`);

    expectBox(one, 0, 0, 56.34, LINE_30);
    expectBox(two, 66.34, 0, 55.26, LINE_30); // 56.34 + 10
    expectBox(row, 0, 0, 121.6, LINE_30);

    dispose();
  },
);
