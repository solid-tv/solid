// Phase 1 contract tests: VirtualRow and VirtualColumn (window of mounted
// items, window shift per press, selected -> data index mapping, final x/y,
// scroll modes, wrap, displaySize, bufferSize, selected, onSelectedChanged,
// onEndReached).
//
// Pins today's behaviour (arm B) through the public surface: keys go through
// the focus manager's real keydown listener; assertions read the focused
// element, `selected`, `cursor` (documented as the data index), the data
// items of the mounted children, callback arguments and final x/y.
// Animations are off so positions are final.
import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import {
  VirtualRow,
  VirtualColumn,
  useFocusManager,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { renderer } from './setup.js';

// Real KeyboardEvents on the target the focus manager listens to. A private
// target (instead of `document`) keeps listeners other files leave on
// `document` (vitest isolate: false) from handling a press twice.
const keys = new EventTarget();
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function press(...names: string[]) {
  for (const key of names) {
    keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
    // Focus and the window shift settle in microtasks.
    await flush();
  }
}

async function mount(ui: () => s.JSX.Element) {
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys as unknown as KeyEventTarget);
    return ui();
  }) as unknown as () => void;
  await flush();
  return dispose;
}

const focusedId = () => lng.activeElement()?.id;

/** Data items of the mounted children, in order. */
const mounted = (el: lng.ElementNode) =>
  el.children.map((c) => (c as lng.ElementNode).item as number).join(',');

type Step = [
  focused: string | undefined,
  selected: number | undefined,
  cursor: number,
  pos: number,
  mounted: string,
];

const rowStep = (row: lng.ElementNode): Step => [
  focusedId(),
  row.selected,
  row.cursor as number,
  row.x,
  mounted(row),
];

// Each child carries its data item as `item`, as the docs' Thumbnail does;
// VirtualRow finds the selected child by it.
const Item = (props: { item: number }) => (
  <view id={`v${props.item}`} item={props.item} width={200} height={100} />
);

const twelve = Array.from({ length: 12 }, (_, i) => i);

let dispose: (() => void) | undefined;
const animationsEnabled = lng.Config.animationsEnabled;

v.beforeAll(() => {
  lng.Config.animationsEnabled = false;
});
v.afterAll(() => {
  lng.Config.animationsEnabled = animationsEnabled;
});
v.afterEach(() => {
  dispose?.();
  dispose = undefined;
});

v.describe('VirtualRow: window and scroll modes', () => {
  v.it(
    'mounts displaySize + bufferSize (default 2) items, laid out by flex with gap 30',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow ref={row} autofocus x={50} each={twelve} displaySize={4}>
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      v.expect(rowStep(row)).toEqual(['v0', 0, 0, 50, '0,1,2,3,4,5']);
      v.expect(row.children.map((c) => c.x)).toEqual([
        0, 230, 460, 690, 920, 1150,
      ]);
    },
  );

  // 12 items, displaySize 4, x=50, 200-wide children + gap 30. Thirteen Right
  // presses then four Left presses; after each press:
  // [focused, selected, cursor, x, data items mounted].
  const cases: Record<string, { initial: Step; right: Step[]; left: Step[] }> =
    {
      auto: {
        initial: ['v0', 0, 0, 50, '0,1,2,3,4,5'],
        right: [
          ['v1', 1, 1, -180, '0,1,2,3,4,5'],
          ['v2', 1, 2, -180, '1,2,3,4,5,6'],
          ['v3', 1, 3, -180, '2,3,4,5,6,7'],
          ['v4', 1, 4, -180, '3,4,5,6,7,8'],
          ['v5', 1, 5, -180, '4,5,6,7,8,9'],
          ['v6', 1, 6, -180, '5,6,7,8,9,10'],
          ['v7', 1, 7, -180, '6,7,8,9,10,11'],
          // The window runs off the end of the data and shrinks.
          ['v8', 1, 8, -180, '7,8,9,10,11'],
          ['v9', 1, 9, -180, '8,9,10,11'],
          ['v10', 2, 10, -180, '8,9,10,11'],
          ['v11', 3, 11, -180, '8,9,10,11'],
          ['v11', 3, 11, -180, '8,9,10,11'],
          ['v11', 3, 11, -180, '8,9,10,11'],
        ],
        left: [
          ['v10', 3, 10, -180, '7,8,9,10,11'],
          ['v9', 3, 9, -180, '6,7,8,9,10,11'],
          ['v8', 3, 8, -180, '5,6,7,8,9,10'],
          ['v7', 3, 7, -180, '4,5,6,7,8,9'],
        ],
      },
      'auto + wrap': {
        // Wrap keeps one item before the selection: the window starts at the
        // last item and x is shifted left by one slot.
        initial: ['v0', 1, 0, -180, '11,0,1,2,3,4'],
        right: [
          ['v1', 1, 1, -180, '0,1,2,3,4,5'],
          ['v2', 1, 2, -180, '1,2,3,4,5,6'],
          ['v3', 1, 3, -180, '2,3,4,5,6,7'],
          ['v4', 1, 4, -180, '3,4,5,6,7,8'],
          ['v5', 1, 5, -180, '4,5,6,7,8,9'],
          ['v6', 1, 6, -180, '5,6,7,8,9,10'],
          ['v7', 1, 7, -180, '6,7,8,9,10,11'],
          ['v8', 1, 8, -180, '7,8,9,10,11,0'],
          ['v9', 1, 9, -180, '8,9,10,11,0,1'],
          ['v10', 1, 10, -180, '9,10,11,0,1,2'],
          ['v11', 1, 11, -180, '10,11,0,1,2,3'],
          ['v0', 1, 0, -180, '11,0,1,2,3,4'],
          ['v1', 1, 1, -180, '0,1,2,3,4,5'],
        ],
        left: [
          ['v0', 1, 0, -180, '11,0,1,2,3,4'],
          ['v11', 1, 11, -180, '10,11,0,1,2,3'],
          ['v10', 1, 10, -180, '9,10,11,0,1,2'],
          ['v9', 1, 9, -180, '8,9,10,11,0,1'],
        ],
      },
      edge: {
        initial: ['v0', 0, 0, 50, '0,1,2,3,4,5'],
        right: [
          ['v1', 1, 1, 50, '0,1,2,3,4,5'],
          ['v2', 2, 2, 50, '0,1,2,3,4,5'],
          ['v3', 3, 3, 50, '0,1,2,3,4,5'],
          ['v4', 4, 4, -180, '0,1,2,3,4,5'],
          ['v5', 4, 5, -180, '1,2,3,4,5,6'],
          ['v6', 4, 6, -180, '2,3,4,5,6,7'],
          ['v7', 4, 7, -180, '3,4,5,6,7,8'],
          ['v8', 4, 8, -180, '4,5,6,7,8,9'],
          ['v9', 4, 9, -180, '5,6,7,8,9,10'],
          ['v10', 4, 10, -180, '6,7,8,9,10,11'],
          ['v11', 4, 11, -180, '7,8,9,10,11'],
          ['v11', 4, 11, -180, '7,8,9,10,11'],
          ['v11', 4, 11, -180, '7,8,9,10,11'],
        ],
        left: [
          ['v10', 3, 10, -180, '7,8,9,10,11'],
          ['v9', 2, 9, -180, '7,8,9,10,11'],
          ['v8', 1, 8, -180, '7,8,9,10,11'],
          ['v7', 1, 7, -180, '6,7,8,9,10,11'],
        ],
      },
      'edge + wrap': {
        initial: ['v0', 1, 0, -180, '11,0,1,2,3,4'],
        right: [
          ['v1', 2, 1, -180, '11,0,1,2,3,4'],
          ['v2', 3, 2, -180, '11,0,1,2,3,4'],
          ['v3', 4, 3, -180, '11,0,1,2,3,4'],
          ['v4', 4, 4, -180, '0,1,2,3,4,5'],
          ['v5', 4, 5, -180, '1,2,3,4,5,6'],
          ['v6', 4, 6, -180, '2,3,4,5,6,7'],
          ['v7', 4, 7, -180, '3,4,5,6,7,8'],
          ['v8', 4, 8, -180, '4,5,6,7,8,9'],
          ['v9', 4, 9, -180, '5,6,7,8,9,10'],
          ['v10', 4, 10, -180, '6,7,8,9,10,11'],
          ['v11', 4, 11, -180, '7,8,9,10,11,0'],
          ['v0', 4, 0, -180, '8,9,10,11,0,1'],
          ['v1', 4, 1, -180, '9,10,11,0,1,2'],
        ],
        left: [
          ['v0', 3, 0, -180, '9,10,11,0,1,2'],
          ['v11', 2, 11, -180, '9,10,11,0,1,2'],
          ['v10', 1, 10, -180, '9,10,11,0,1,2'],
          ['v9', 1, 9, -180, '8,9,10,11,0,1'],
        ],
      },
      always: {
        initial: ['v0', 0, 0, 50, '0,1,2,3,4,5'],
        right: [
          ['v1', 1, 1, -180, '0,1,2,3,4,5'],
          ['v2', 2, 2, -410, '0,1,2,3,4,5'],
          ['v3', 2, 3, -410, '1,2,3,4,5,6'],
          ['v4', 2, 4, -410, '2,3,4,5,6,7'],
          ['v5', 2, 5, -410, '3,4,5,6,7,8'],
          ['v6', 2, 6, -410, '4,5,6,7,8,9'],
          ['v7', 2, 7, -410, '5,6,7,8,9,10'],
          ['v8', 2, 8, -410, '6,7,8,9,10,11'],
          ['v9', 3, 9, -640, '6,7,8,9,10,11'],
          ['v10', 4, 10, -870, '6,7,8,9,10,11'],
          ['v11', 5, 11, -1100, '6,7,8,9,10,11'],
          ['v11', 5, 11, -1100, '6,7,8,9,10,11'],
          ['v11', 5, 11, -1100, '6,7,8,9,10,11'],
        ],
        left: [
          ['v10', 4, 10, -870, '6,7,8,9,10,11'],
          ['v9', 3, 9, -640, '6,7,8,9,10,11'],
          ['v8', 2, 8, -410, '6,7,8,9,10,11'],
          ['v7', 2, 7, -410, '5,6,7,8,9,10'],
        ],
      },
    };
  // 'always + wrap' produces exactly the 'auto + wrap' sequence today.
  cases['always + wrap'] = cases['auto + wrap']!;

  for (const [name, expected] of Object.entries(cases)) {
    v.it(
      `scroll="${name}": mounted items, selected, cursor and x after each press`,
      async () => {
        const [mode, wrap] = name.split(' + ') as [
          'auto' | 'edge' | 'always',
          string | undefined,
        ];
        let row!: lng.ElementNode;
        dispose = await mount(() => (
          <view width={1920} height={1080}>
            <VirtualRow
              ref={row}
              autofocus
              x={50}
              each={twelve}
              displaySize={4}
              scroll={mode}
              wrap={wrap === 'wrap'}
            >
              {(item) => <Item item={item()} />}
            </VirtualRow>
          </view>
        ));
        v.expect(rowStep(row)).toEqual(expected.initial);
        const right: Step[] = [];
        for (let i = 0; i < 13; i++) {
          await press('ArrowRight');
          right.push(rowStep(row));
        }
        v.expect(right).toEqual(expected.right);
        const left: Step[] = [];
        for (let i = 0; i < 4; i++) {
          await press('ArrowLeft');
          left.push(rowStep(row));
        }
        v.expect(left).toEqual(expected.left);
      },
    );
  }

  // B13 (fixed in 1.7): scroll="none" (and "center", which VirtualRow does
  // not implement and treats like "none") never moved the window: only items
  // 0-5 were ever mounted, Right stopped at v5 and the press bubbled. Now the
  // window follows the cursor, keeping one item mounted on each side of it;
  // the row itself still never scrolls (x stays 50), like a Row with
  // scroll="none".
  v.it(
    'B13: scroll="none"/"center" on VirtualRow: the window follows the cursor, so every item is reachable; x never changes',
    async () => {
      for (const mode of ['none', 'center'] as const) {
        let row!: lng.ElementNode;
        const parentRight = v.vi.fn(() => true);
        dispose = await mount(() => (
          <view width={1920} height={1080} onRight={parentRight}>
            <VirtualRow
              ref={row}
              autofocus
              x={50}
              each={twelve}
              displaySize={4}
              scroll={mode}
            >
              {(item) => <Item item={item()} />}
            </VirtualRow>
          </view>
        ));
        const seen: Step[] = [rowStep(row)];
        for (let i = 0; i < 13; i++) {
          await press('ArrowRight');
          seen.push(rowStep(row));
        }
        for (let i = 0; i < 7; i++) {
          await press('ArrowLeft');
          seen.push(rowStep(row));
        }
        v.expect(seen).toEqual([
          ['v0', 0, 0, 50, '0,1,2,3,4,5'],
          ['v1', 1, 1, 50, '0,1,2,3,4,5'],
          ['v2', 2, 2, 50, '0,1,2,3,4,5'],
          ['v3', 3, 3, 50, '0,1,2,3,4,5'],
          ['v4', 4, 4, 50, '0,1,2,3,4,5'],
          // The next item must stay mounted: the window moves.
          ['v5', 4, 5, 50, '1,2,3,4,5,6'],
          ['v6', 4, 6, 50, '2,3,4,5,6,7'],
          ['v7', 4, 7, 50, '3,4,5,6,7,8'],
          ['v8', 4, 8, 50, '4,5,6,7,8,9'],
          ['v9', 4, 9, 50, '5,6,7,8,9,10'],
          ['v10', 4, 10, 50, '6,7,8,9,10,11'],
          ['v11', 5, 11, 50, '6,7,8,9,10,11'],
          // At the end the press bubbles.
          ['v11', 5, 11, 50, '6,7,8,9,10,11'],
          ['v11', 5, 11, 50, '6,7,8,9,10,11'],
          ['v10', 4, 10, 50, '6,7,8,9,10,11'],
          ['v9', 3, 9, 50, '6,7,8,9,10,11'],
          ['v8', 2, 8, 50, '6,7,8,9,10,11'],
          ['v7', 1, 7, 50, '6,7,8,9,10,11'],
          ['v6', 1, 6, 50, '5,6,7,8,9,10'],
          ['v5', 1, 5, 50, '4,5,6,7,8,9'],
          ['v4', 1, 4, 50, '3,4,5,6,7,8'],
        ]);
        v.expect(parentRight).toHaveBeenCalledTimes(2);
        dispose();
        dispose = undefined;
      }
    },
  );

  // B13 with wrap: the window follows the cursor around the end of the data
  // (it is a modular window, as in the other wrap modes), so Right past the
  // last item wraps to the first and Left past the first to the last.
  v.it(
    'B13: scroll="none" + wrap on VirtualRow: Right past the last item wraps to the first; x never changes after mount',
    async () => {
      let row!: lng.ElementNode;
      const parentRight = v.vi.fn(() => true);
      const parentLeft = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view
          width={1920}
          height={1080}
          onRight={parentRight}
          onLeft={parentLeft}
        >
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={twelve}
            displaySize={4}
            scroll="none"
            wrap
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      const seen: Step[] = [rowStep(row)];
      for (let i = 0; i < 13; i++) {
        await press('ArrowRight');
        seen.push(rowStep(row));
      }
      for (let i = 0; i < 3; i++) {
        await press('ArrowLeft');
        seen.push(rowStep(row));
      }
      v.expect(seen).toEqual([
        // As in the other wrap modes, one item before the cursor and the row
        // one slot left (wrap's mount offset): v0 is at screen x 50.
        ['v0', 1, 0, -180, '11,0,1,2,3,4'],
        ['v1', 2, 1, -180, '11,0,1,2,3,4'],
        ['v2', 3, 2, -180, '11,0,1,2,3,4'],
        ['v3', 4, 3, -180, '11,0,1,2,3,4'],
        ['v4', 4, 4, -180, '0,1,2,3,4,5'],
        ['v5', 4, 5, -180, '1,2,3,4,5,6'],
        ['v6', 4, 6, -180, '2,3,4,5,6,7'],
        ['v7', 4, 7, -180, '3,4,5,6,7,8'],
        ['v8', 4, 8, -180, '4,5,6,7,8,9'],
        ['v9', 4, 9, -180, '5,6,7,8,9,10'],
        ['v10', 4, 10, -180, '6,7,8,9,10,11'],
        ['v11', 4, 11, -180, '7,8,9,10,11,0'],
        // Past the last item: the first, then the second.
        ['v0', 4, 0, -180, '8,9,10,11,0,1'],
        ['v1', 4, 1, -180, '9,10,11,0,1,2'],
        ['v0', 3, 0, -180, '9,10,11,0,1,2'],
        ['v11', 2, 11, -180, '9,10,11,0,1,2'],
        ['v10', 1, 10, -180, '9,10,11,0,1,2'],
      ]);
      v.expect(parentRight).not.toHaveBeenCalled();
      v.expect(parentLeft).not.toHaveBeenCalled();
    },
  );

  v.it(
    'B13: scroll="none" + wrap with fewer items than the window (displaySize < count < displaySize + bufferSize): each item mounted once, every press moves',
    async () => {
      let row!: lng.ElementNode;
      const parentRight = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view width={1920} height={1080} onRight={parentRight}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={[0, 1, 2, 3, 4]}
            displaySize={4}
            scroll="none"
            wrap
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      const step = (): [...Step, number] => [
        ...rowStep(row),
        row.x + lng.activeElement()!.x,
      ];
      const seen = [step()];
      for (let i = 0; i < 7; i++) {
        await press('ArrowRight');
        seen.push(step());
      }
      for (let i = 0; i < 3; i++) {
        await press('ArrowLeft');
        seen.push(step());
      }
      // [focused, selected, cursor, x, mounted, focused screen x]: five
      // items in a window of five, the focus kept in slots 1-3.
      v.expect(seen).toEqual([
        ['v0', 1, 0, -180, '4,0,1,2,3', 50],
        ['v1', 2, 1, -180, '4,0,1,2,3', 280],
        ['v2', 3, 2, -180, '4,0,1,2,3', 510],
        ['v3', 3, 3, -180, '0,1,2,3,4', 510],
        ['v4', 3, 4, -180, '1,2,3,4,0', 510],
        ['v0', 3, 0, -180, '2,3,4,0,1', 510],
        ['v1', 3, 1, -180, '3,4,0,1,2', 510],
        ['v2', 3, 2, -180, '4,0,1,2,3', 510],
        ['v1', 2, 1, -180, '4,0,1,2,3', 280],
        ['v0', 1, 0, -180, '4,0,1,2,3', 50],
        ['v4', 1, 4, -180, '3,4,0,1,2', 50],
      ]);
      v.expect(parentRight).not.toHaveBeenCalled();
    },
  );

  // B14 (fixed in 1.7): a window shift moves the row by one slot, the
  // item's unscaled size plus the gap, which is how far flex moves the items.
  // With factorScale and a `$focus` scale of 1.2 it moved by 200 * 1.2 + 30 =
  // 270 instead of 230 whenever it saw the scale, so the focused item drifted
  // 40 left per shift (screen x 50, 10, -30, ... on the plain path, before and
  // after the first B14 attempt that read `$focus`, which spread the drift to
  // the wrap and initial-selected paths). factorScale has no effect now: the
  // positions are the same with and without it.
  //
  // Animations are on, as in an app. The DOM renderer's animations run on
  // requestAnimationFrame, and jsdom's frame time is on another clock than
  // the performance.now() the animations start from, so frames are driven
  // here with a time far ahead: each shift animation ends on its first frame.
  v.it(
    'B14: with factorScale and a $focus scale, the focused item keeps its screen x across window shifts (animations on)',
    async () => {
      const settle = async () => {
        for (let i = 0; i < 4; i++) await flush();
      };
      v.vi.stubGlobal(
        'requestAnimationFrame',
        (cb: (time: number) => void) =>
          setTimeout(() => cb(performance.now() + 1e6), 0),
      );
      lng.Config.animationsEnabled = true;
      try {
        // Focused item's screen x (row x + its x) at mount, then after Right
        // x5 and Left x3.
        const expected: Record<string, number[]> = {
          plain: [50, 50, 50, 50, 50, 50, 50, 50, 50],
          wrap: [50, 50, 50, 50, 50, 50, 50, 50, 50],
          // Not constant: an initial `selected` makes the first and fifth
          // press move the focused item one slot right, with or without
          // factorScale. A separate bug from before 1.7 (out of scope here).
          selected: [50, 280, 280, 280, 280, 510, 510, 510, 510],
        };
        for (const factorScale of [true, false]) {
          for (const variant of ['plain', 'wrap', 'selected']) {
            let row!: lng.ElementNode;
            dispose = await mount(() => (
              <view width={1920} height={1080}>
                <VirtualRow
                  ref={row}
                  autofocus
                  x={50}
                  each={twelve}
                  displaySize={4}
                  factorScale={factorScale}
                  wrap={variant === 'wrap'}
                  selected={variant === 'selected' ? 5 : undefined}
                >
                  {(item) => (
                    <view
                      id={`v${item()}`}
                      item={item()}
                      width={200}
                      height={100}
                      style={{ $focus: { scale: 1.2 } }}
                    />
                  )}
                </VirtualRow>
              </view>
            ));
            await settle();
            const screenX = () => row.x + lng.activeElement()!.x;
            const seen = [screenX()];
            for (const key of [
              'ArrowRight',
              'ArrowRight',
              'ArrowRight',
              'ArrowRight',
              'ArrowRight',
              'ArrowLeft',
              'ArrowLeft',
              'ArrowLeft',
            ]) {
              await press(key);
              await settle();
              seen.push(screenX());
            }
            v.expect([factorScale, variant, seen]).toEqual([
              factorScale,
              variant,
              expected[variant],
            ]);
            dispose();
            dispose = undefined;
          }
        }
      } finally {
        lng.Config.animationsEnabled = false;
        v.vi.unstubAllGlobals();
      }
    },
  );

  v.it(
    'displaySize >= item count: everything is mounted, nothing shifts, wrap wraps the children',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={[0, 1, 2]}
            displaySize={4}
            wrap
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      const seen: Step[] = [rowStep(row)];
      for (const key of [
        'ArrowRight',
        'ArrowRight',
        'ArrowRight',
        'ArrowLeft',
      ]) {
        await press(key);
        seen.push(rowStep(row));
      }
      v.expect(seen).toEqual([
        ['v0', 0, 0, 50, '0,1,2'],
        ['v1', 1, 1, 50, '0,1,2'],
        ['v2', 2, 2, 50, '0,1,2'],
        ['v0', 0, 0, 50, '0,1,2'],
        ['v2', 2, 2, 50, '0,1,2'],
      ]);
    },
  );
});

v.describe('VirtualRow: bufferSize and onEndReached', () => {
  v.it(
    'bufferSize sets how many extra items are mounted; onEndReached fires on every press within onEndReachedThreshold; appended items extend the window',
    async () => {
      let row!: lng.ElementNode;
      const [items, setItems] = s.createSignal(twelve);
      const onEndReached = v.vi.fn();
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={items()}
            displaySize={3}
            bufferSize={1}
            onEndReached={onEndReached}
            onEndReachedThreshold={3}
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      const seen: [...Step, number][] = [[...rowStep(row), 0]];
      for (let i = 0; i < 11; i++) {
        await press('ArrowRight');
        seen.push([...rowStep(row), onEndReached.mock.calls.length]);
      }
      // displaySize 3 + bufferSize 1 = 4 mounted. Threshold 3 of 12: fires once
      // the cursor reaches 9, and again on each later press.
      v.expect(seen).toEqual([
        ['v0', 0, 0, 50, '0,1,2,3', 0],
        ['v1', 1, 1, -180, '0,1,2,3', 0],
        ['v2', 1, 2, -180, '1,2,3,4', 0],
        ['v3', 1, 3, -180, '2,3,4,5', 0],
        ['v4', 1, 4, -180, '3,4,5,6', 0],
        ['v5', 1, 5, -180, '4,5,6,7', 0],
        ['v6', 1, 6, -180, '5,6,7,8', 0],
        ['v7', 1, 7, -180, '6,7,8,9', 0],
        ['v8', 1, 8, -180, '7,8,9,10', 0],
        ['v9', 1, 9, -180, '8,9,10,11', 1],
        ['v10', 1, 10, -180, '9,10,11', 2],
        ['v11', 2, 11, -180, '9,10,11', 3],
      ]);

      // The app appends a page in response.
      setItems(Array.from({ length: 16 }, (_, i) => i));
      await flush();
      v.expect(rowStep(row)).toEqual(['v11', 1, 11, -180, '10,11,12,13']);
      await press('ArrowRight', 'ArrowRight');
      v.expect(rowStep(row)).toEqual(['v13', 1, 13, -180, '12,13,14,15']);
      // 16 - 3 = 13: fires for cursor 13 but not 12.
      v.expect(onEndReached).toHaveBeenCalledTimes(4);
    },
  );

  v.it(
    'onEndReached is never called without onEndReachedThreshold',
    async () => {
      let row!: lng.ElementNode;
      const onEndReached = v.vi.fn();
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={twelve}
            displaySize={3}
            onEndReached={onEndReached}
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      await press(...Array.from({ length: 12 }, () => 'ArrowRight'));
      v.expect(row.cursor).toBe(11);
      v.expect(onEndReached).not.toHaveBeenCalled();
    },
  );
});

v.describe('VirtualRow: onSelectedChanged and selected', () => {
  v.it(
    'onSelectedChanged is called as (idx, container, active, lastIdx), this = container; idx is the child index before the window shift; this.cursor is still the previous data index',
    async () => {
      let row!: lng.ElementNode;
      const calls: unknown[][] = [];
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={twelve}
            displaySize={4}
            onSelectedChanged={function (
              this: lng.ElementNode,
              idx,
              container,
              active,
              lastIdx,
            ) {
              calls.push([
                this === row,
                container === row,
                idx,
                active.item,
                lastIdx,
                this.cursor,
              ]);
            }}
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      await press('ArrowRight', 'ArrowRight', 'ArrowRight');
      // [this, container, idx, active.item, lastIdx, this.cursor]
      v.expect(calls).toEqual([
        // Once on mount (autofocus).
        [true, true, 0, 0, 0, 0],
        [true, true, 1, 1, 0, 0],
        // The window then shifts and selected is corrected back to 1.
        [true, true, 2, 2, 1, 1],
        [true, true, 2, 3, 1, 2],
      ]);
      // After the press cursor is the data index of the focused item.
      v.expect([row.cursor, row.selected, focusedId()]).toEqual([3, 1, 'v3']);
    },
  );

  v.it(
    'selected: initial value is a data index; a reactive change moves focus and the window without onSelectedChanged',
    async () => {
      let row!: lng.ElementNode;
      const [sel, setSel] = s.createSignal(5);
      const calls: unknown[][] = [];
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={twelve}
            displaySize={4}
            selected={sel()}
            onSelectedChanged={(idx, _c, active, lastIdx) =>
              calls.push([idx, active.id, lastIdx])
            }
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      v.expect(rowStep(row)).toEqual(['v5', 1, 5, -180, '4,5,6,7,8,9']);
      v.expect(calls).toEqual([[1, 'v5', 1]]);

      // Current behaviour: the first press after an initial selected puts x
      // back to 50 as the window shifts, so the focused item sits one slot
      // further right (screen x 280) than when the row starts at 0 (screen x
      // 50, see the auto case). The position used is the one saved before the
      // initial shift (Virtual.tsx:500-502).
      await press('ArrowRight');
      v.expect(rowStep(row)).toEqual(['v6', 1, 6, 50, '5,6,7,8,9,10']);
      await press('ArrowLeft', 'ArrowLeft');
      v.expect(rowStep(row)).toEqual(['v4', 1, 4, 50, '3,4,5,6,7,8']);
      calls.length = 0;

      setSel(9);
      await flush();
      v.expect(rowStep(row)).toEqual(['v9', 3, 9, -180, '6,7,8,9,10,11']);
      v.expect(calls).toEqual([]);

      await press('ArrowRight');
      v.expect(rowStep(row)).toEqual(['v10', 3, 10, 50, '7,8,9,10,11']);
      v.expect(calls).toEqual([[4, 'v10', 3]]);
    },
  );

  v.it(
    'selected + wrap: the selected data item is placed in slot 1',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={twelve}
            displaySize={4}
            wrap
            selected={5}
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      const seen: Step[] = [rowStep(row)];
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowLeft']) {
        await press(key);
        seen.push(rowStep(row));
      }
      v.expect(seen).toEqual([
        ['v5', 1, 5, -180, '4,5,6,7,8,9'],
        ['v6', 1, 6, -180, '5,6,7,8,9,10'],
        ['v5', 1, 5, -180, '4,5,6,7,8,9'],
        ['v4', 1, 4, -180, '3,4,5,6,7,8'],
      ]);
    },
  );
});

v.describe('VirtualColumn', () => {
  v.it(
    'Down/Up shift the window and y; Left/Right are not handled',
    async () => {
      let col!: lng.ElementNode;
      const parentRight = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view width={1920} height={1080} onRight={parentRight}>
          <VirtualColumn
            ref={col}
            autofocus
            y={50}
            each={twelve}
            displaySize={3}
          >
            {(item) => <Item item={item()} />}
          </VirtualColumn>
        </view>
      ));
      const colStep = (): Step => [
        focusedId(),
        col.selected,
        col.cursor as number,
        col.y,
        mounted(col),
      ];
      v.expect(col.children.map((c) => c.y)).toEqual([0, 130, 260, 390, 520]);
      const seen: Step[] = [colStep()];
      for (const key of [
        'ArrowDown',
        'ArrowDown',
        'ArrowDown',
        'ArrowUp',
        'ArrowRight',
      ]) {
        await press(key);
        seen.push(colStep());
      }
      // 100-high children + gap 30: one slot is 130.
      v.expect(seen).toEqual([
        ['v0', 0, 0, 50, '0,1,2,3,4'],
        ['v1', 1, 1, -80, '0,1,2,3,4'],
        ['v2', 1, 2, -80, '1,2,3,4,5'],
        ['v3', 1, 3, -80, '2,3,4,5,6'],
        ['v2', 1, 2, -80, '1,2,3,4,5'],
        ['v2', 1, 2, -80, '1,2,3,4,5'],
      ]);
      v.expect(parentRight).toHaveBeenCalledTimes(1);
      v.expect(col.x).toBe(0);
    },
  );
});

v.describe('VirtualRow: work per press (1.7)', () => {
  // Counts the row's flex passes: updateLayout calls, from the post-mutation
  // layout phase and from VirtualRow itself.
  const countLayouts = (row: lng.ElementNode) => {
    const counter = { n: 0 };
    const updateLayout = row.updateLayout;
    row.updateLayout = function (this: lng.ElementNode) {
      counter.n++;
      return updateLayout.call(this);
    };
    return counter;
  };

  v.it(
    'a press re-runs only the props that depend on the cursor: an unrelated prop getter is not read again (1.7)',
    async () => {
      let row!: lng.ElementNode;
      let reads = 0;
      const probe = () => {
        reads++;
        return 1;
      };
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={twelve}
            displaySize={4}
            probe={probe()}
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      const before = reads;
      await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft');
      v.expect(row.cursor).toBe(2);
      // It was read again on every press: the cursor was in the spread.
      v.expect(reads).toBe(before);
    },
  );

  v.it(
    'with animations on, each window shift animates the row to the same x the non-animated shift sets',
    async () => {
      let now = 0;
      // Presses far apart: the adaptive duration is the full duration.
      const spy = v.vi
        .spyOn(performance, 'now')
        .mockImplementation(() => (now += 1000));
      lng.Config.animationsEnabled = true;
      try {
        let row!: lng.ElementNode;
        dispose = await mount(() => (
          <view width={1920} height={1080}>
            <VirtualRow
              ref={row}
              autofocus
              x={50}
              each={twelve}
              displaySize={4}
            >
              {(item) => <Item item={item()} />}
            </VirtualRow>
          </view>
        ));
        const targets: unknown[] = [];
        row.animate = (props, settings) => {
          // Copied at the call, as the renderers do.
          targets.push([props.x, settings?.duration]);
          return {
            state: 'stopped',
            start() {
              return this;
            },
            stop() {},
          } as unknown as lng.IAnimationController;
        };
        await press('ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft');
        const duration = row.animationSettings?.duration;
        // The auto case's x after each press (-180), the left press included.
        v.expect(targets).toEqual([
          [-180, duration],
          [-180, duration],
          [-180, duration],
          [-180, duration],
        ]);
        v.expect(row.cursor).toBe(2);
      } finally {
        lng.Config.animationsEnabled = false;
        spy.mockRestore();
      }
    },
  );

  // Eight Right presses then four Left presses.
  const expected = {
    auto: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    always: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    edge: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1],
  };
  for (const mode of ['auto', 'always', 'edge'] as const) {
    v.it(`scroll="${mode}": a press lays the row out at most once`, async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualRow
            ref={row}
            autofocus
            x={50}
            each={twelve}
            displaySize={4}
            scroll={mode}
          >
            {(item) => <Item item={item()} />}
          </VirtualRow>
        </view>
      ));
      const counter = countLayouts(row);
      const passes: number[] = [];
      for (const key of [
        ...Array.from({ length: 8 }, () => 'ArrowRight'),
        ...Array.from({ length: 4 }, () => 'ArrowLeft'),
      ]) {
        counter.n = 0;
        await press(key);
        passes.push(counter.n);
      }
      // One pass for a press that changes the window, none for a press that
      // only moves the row or the focus (it was two and one).
      v.expect(passes).toEqual(expected[mode]);
    });
  }
});
