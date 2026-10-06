// Contract tests: Row and Column (navigation, wrap, plinko, selected,
// skipFocus, scroll modes, centerScroll, onSelectedChanged, throttleInput).
//
// Pins today's behaviour (1.7) through the public surface only: keys go
// through the focus manager's real keydown listener, and assertions read the
// focused element, `selected`, callback arguments and final x/y. Numbers are
// what HEAD produces with fixed-size children; where today's behaviour looks
// odd the test says so in a comment. Animations are off so x/y are final.
import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import {
  Row,
  Column,
  useFocusManager,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { renderer } from './setup.js';

// The focus manager listens for `keydown` on the target given to
// useFocusManager (`document` by default). A private target gets the same
// listener and real KeyboardEvents, and keeps listeners that other test files
// leave on `document` (vitest runs with isolate: false) from handling a press
// twice.
const keys = new EventTarget();
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function press(...names: string[]) {
  for (const key of names) {
    keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
    // Focus is applied in a microtask; wait for it to settle.
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

const items = (
  n: number,
  props: (i: number) => Record<string, unknown> = () => ({}),
) =>
  Array.from({ length: n }, (_, i) => (
    <view id={`c${i}`} width={400} height={200} {...props(i)} />
  ));

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
  v.vi.restoreAllMocks();
});

v.describe('Row and Column: navigation', () => {
  v.it(
    'Row: Right/Left move focus and selected; at either end the key bubbles to the parent',
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
          <Row ref={row} autofocus scroll="none">
            {items(3)}
          </Row>
        </view>
      ));
      v.expect([row.selected, focusedId()]).toEqual([0, 'c0']);

      await press('ArrowRight');
      v.expect([row.selected, focusedId()]).toEqual([1, 'c1']);
      await press('ArrowRight');
      v.expect([row.selected, focusedId()]).toEqual([2, 'c2']);
      v.expect(parentRight).not.toHaveBeenCalled();

      // At the last child the Row does not handle Right: it bubbles.
      await press('ArrowRight');
      v.expect([row.selected, focusedId()]).toEqual([2, 'c2']);
      v.expect(parentRight).toHaveBeenCalledTimes(1);

      await press('ArrowLeft', 'ArrowLeft');
      v.expect([row.selected, focusedId()]).toEqual([0, 'c0']);
      v.expect(parentLeft).not.toHaveBeenCalled();
      await press('ArrowLeft');
      v.expect([row.selected, focusedId()]).toEqual([0, 'c0']);
      v.expect(parentLeft).toHaveBeenCalledTimes(1);
    },
  );

  v.it(
    'Column: Down/Up move focus and selected; Left/Right are not handled and bubble',
    async () => {
      let col!: lng.ElementNode;
      const parentRight = v.vi.fn(() => true);
      const parentDown = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view
          width={1920}
          height={1080}
          onRight={parentRight}
          onDown={parentDown}
        >
          <Column ref={col} autofocus scroll="none">
            {items(3)}
          </Column>
        </view>
      ));
      v.expect([col.selected, focusedId()]).toEqual([0, 'c0']);
      await press('ArrowDown', 'ArrowDown');
      v.expect([col.selected, focusedId()]).toEqual([2, 'c2']);
      await press('ArrowUp');
      v.expect([col.selected, focusedId()]).toEqual([1, 'c1']);

      await press('ArrowRight');
      v.expect(parentRight).toHaveBeenCalledTimes(1);
      v.expect([col.selected, focusedId()]).toEqual([1, 'c1']);

      await press('ArrowDown', 'ArrowDown');
      v.expect(parentDown).toHaveBeenCalledTimes(1);
      v.expect([col.selected, focusedId()]).toEqual([2, 'c2']);
    },
  );

  v.it(
    'skipFocus: children with skipFocus are skipped, including for the initial focus',
    async () => {
      let row!: lng.ElementNode;
      const parentRight = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view width={1920} height={1080} onRight={parentRight}>
          <Row ref={row} autofocus scroll="none">
            {items(5, (i) => ({ skipFocus: i % 2 === 0 }))}
          </Row>
        </view>
      ));
      // c0 is skipFocus, so the first focus lands on c1.
      v.expect([row.selected, focusedId()]).toEqual([1, 'c1']);
      await press('ArrowRight');
      v.expect([row.selected, focusedId()]).toEqual([3, 'c3']);
      // Only skipFocus children remain to the right: the key bubbles.
      await press('ArrowRight');
      v.expect([row.selected, focusedId()]).toEqual([3, 'c3']);
      v.expect(parentRight).toHaveBeenCalledTimes(1);
      await press('ArrowLeft');
      v.expect([row.selected, focusedId()]).toEqual([1, 'c1']);
    },
  );

  v.it(
    'wrap: Row wraps at both ends and still skips skipFocus children',
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
          <Row ref={row} autofocus wrap scroll="none">
            {items(4, (i) => ({ skipFocus: i === 0 }))}
          </Row>
        </view>
      ));
      const seen: unknown[] = [focusedId()];
      for (const key of [
        'ArrowRight',
        'ArrowRight',
        'ArrowRight', // c3 -> wraps past skipFocus c0 to c1
        'ArrowLeft', // c1 -> wraps past skipFocus c0 to c3
        'ArrowLeft',
      ]) {
        await press(key);
        seen.push(focusedId());
      }
      v.expect(seen).toEqual(['c1', 'c2', 'c3', 'c1', 'c3', 'c2']);
      v.expect(row.selected).toBe(2);
      // With wrap the Row always handles the key: nothing bubbles.
      v.expect(parentRight).not.toHaveBeenCalled();
      v.expect(parentLeft).not.toHaveBeenCalled();
    },
  );

  v.it('wrap: Column wraps at both ends', async () => {
    let col!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={1920} height={1080}>
        <Column ref={col} autofocus wrap scroll="none">
          {items(3)}
        </Column>
      </view>
    ));
    await press('ArrowUp');
    v.expect([col.selected, focusedId()]).toEqual([2, 'c2']);
    await press('ArrowDown');
    v.expect([col.selected, focusedId()]).toEqual([0, 'c0']);
  });

  // B1 (fixed in 1.7): findFirstFocusableChildIdx (handleNavigation.ts) was a
  // `for (let i = from; ; i += delta)` loop whose only exits were a child
  // without skipFocus and leaving the array without wrap. With wrap and every
  // child skipFocus neither exit was reached: an endless loop on focus
  // (navigableForwardFocus) and on a key press (moveSelection). With wrap and
  // no children it returned NaN.
  //
  // Bounded harness: a synchronous endless loop cannot be stopped by a vitest
  // timeout, so each child's skipFocus is a getter that counts its reads and
  // throws past a cap. A search that does not terminate then fails the test
  // instead of hanging the worker.
  const skipFocusGuard = () => {
    const state = { reads: 0, on: false };
    const guard = (el: lng.ElementNode) => {
      Object.defineProperty(el, 'skipFocus', {
        configurable: true,
        get() {
          if (++state.reads > 1000) {
            throw new Error('B1: the focusable-child search did not end');
          }
          return state.on;
        },
        set() {},
      });
    };
    return { state, guard };
  };

  v.it(
    'B1: wrap with every child skipFocus: a press returns, focus stays and the key bubbles',
    async () => {
      const { state, guard } = skipFocusGuard();
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
          <Row ref={row} autofocus wrap scroll="none">
            {[0, 1, 2].map((i) => (
              <view id={`c${i}`} ref={guard} width={400} height={200} />
            ))}
          </Row>
        </view>
      ));
      v.expect([row.selected, focusedId()]).toEqual([0, 'c0']);

      // Every child becomes skipFocus while c0 holds focus.
      state.on = true;
      await press('ArrowRight');
      await press('ArrowLeft');
      v.expect([row.selected, focusedId()]).toEqual([0, 'c0']);
      v.expect(parentRight).toHaveBeenCalledTimes(1);
      v.expect(parentLeft).toHaveBeenCalledTimes(1);
      v.expect(state.reads).toBeLessThan(1000);
    },
    5000,
  );

  v.it(
    'B1: wrap with every child skipFocus: focusing the Row keeps focus on the Row itself',
    async () => {
      const { state, guard } = skipFocusGuard();
      state.on = true;
      let row!: lng.ElementNode;
      const parentRight = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view width={1920} height={1080} onRight={parentRight}>
          <Row ref={row} id="row" autofocus wrap scroll="none">
            {[0, 1, 2].map((i) => (
              <view id={`c${i}`} ref={guard} width={400} height={200} />
            ))}
          </Row>
        </view>
      ));
      // No focusable child: forwardFocus selects nothing (-1), as without
      // wrap, and the Row takes focus itself.
      v.expect([row.selected, focusedId()]).toEqual([-1, 'row']);
      await press('ArrowRight');
      v.expect([row.selected, focusedId()]).toEqual([-1, 'row']);
      v.expect(parentRight).toHaveBeenCalledTimes(1);
      v.expect(state.reads).toBeLessThan(1000);
    },
    5000,
  );

  v.it(
    'B1: wrap with no children: a press bubbles and selected stays (no NaN index)',
    async () => {
      let row!: lng.ElementNode;
      const parentRight = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view width={1920} height={1080} onRight={parentRight}>
          <Row ref={row} id="row" autofocus wrap scroll="none" />
        </view>
      ));
      v.expect([row.selected, focusedId()]).toEqual([0, 'row']);
      await press('ArrowRight');
      v.expect([row.selected, focusedId()]).toEqual([0, 'row']);
      v.expect(parentRight).toHaveBeenCalledTimes(1);
    },
  );
});

v.describe('Row and Column: plinko', () => {
  const rows = () => (
    <>
      <Row id="r0" scroll="none">
        {[0, 1, 2, 3].map((i) => (
          <view id={`a${i}`} width={100} height={100} />
        ))}
      </Row>
      <Row id="r1" scroll="none">
        {[0, 1].map((i) => (
          <view id={`b${i}`} width={100} height={100} />
        ))}
      </Row>
      <Row id="r2" scroll="none">
        {[0, 1, 2, 3].map((i) => (
          <view id={`d${i}`} width={100} height={100} />
        ))}
      </Row>
    </>
  );
  const walk = [
    'ArrowRight',
    'ArrowRight',
    'ArrowDown',
    'ArrowDown',
    'ArrowRight',
    'ArrowUp',
    'ArrowUp',
  ];

  v.it(
    'plinko: moving down/up a Column of Rows keeps the horizontal index, clamped to shorter rows',
    async () => {
      let col!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Column ref={col} autofocus plinko scroll="none">
            {rows()}
          </Column>
        </view>
      ));
      const seen: unknown[] = [focusedId()];
      for (const key of walk) {
        await press(key);
        seen.push(focusedId());
      }
      // a2 -> Down -> r1 has 2 items, so index 2 clamps to b1; then d1 (not d2).
      v.expect(seen).toEqual(['a0', 'a1', 'a2', 'b1', 'd1', 'd2', 'b1', 'a1']);
      v.expect(col.children.map((r) => r.selected)).toEqual([1, 1, 2]);
    },
  );

  v.it('without plinko each Row keeps its own selected', async () => {
    let col!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={1920} height={1080}>
        <Column ref={col} autofocus scroll="none">
          {rows()}
        </Column>
      </view>
    ));
    const seen: unknown[] = [focusedId()];
    for (const key of walk) {
      await press(key);
      seen.push(focusedId());
    }
    v.expect(seen).toEqual(['a0', 'a1', 'a2', 'b0', 'd0', 'd1', 'b0', 'a2']);
    v.expect(col.children.map((r) => r.selected)).toEqual([2, 0, 1]);
  });
});

v.describe('Row and Column: selected', () => {
  v.it(
    'initial selected focuses that child and scrolls it to the start on layout',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row ref={row} autofocus selected={3}>
            {items(10)}
          </Row>
        </view>
      ));
      v.expect([row.selected, focusedId()]).toEqual([3, 'c3']);
      // c3 is at x=1290; the first scroll aligns it with the Row's start.
      v.expect(row.x).toBe(-1290);
    },
  );

  v.it(
    'reactive selected: updates .selected but does not move focus or scroll until the next key',
    async () => {
      let row!: lng.ElementNode;
      const [sel, setSel] = s.createSignal(3);
      const changed = v.vi.fn();
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row ref={row} autofocus selected={sel()} onSelectedChanged={changed}>
            {items(10)}
          </Row>
        </view>
      ));
      changed.mockClear();

      setSel(6);
      await flush();
      v.expect([row.selected, focusedId(), row.x]).toEqual([6, 'c3', -1290]);
      v.expect(changed).not.toHaveBeenCalled();

      // The next key moves from the new selected (6), not from the focused c3.
      await press('ArrowRight');
      v.expect([row.selected, focusedId(), row.x]).toEqual([7, 'c7', -1720]);

      // Current behaviour (odd): after selected goes back to 0, Left focuses c0
      // in place (moveSelection falls back to `selected` when there is nothing
      // to the left) and scrollRow sees idx === lastIdx and does not scroll, so
      // c0 stays off screen at x = -1720.
      setSel(0);
      await flush();
      v.expect([row.selected, focusedId()]).toEqual([0, 'c7']);
      await press('ArrowLeft');
      v.expect([row.selected, focusedId(), row.x]).toEqual([0, 'c0', -1720]);
    },
  );

  v.it(
    'Row with a truthy selected prop re-runs the scroll on every layout (aligns selected to the start, unclamped)',
    async () => {
      let row!: lng.ElementNode;
      const [count, setCount] = s.createSignal(10);
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row ref={row} autofocus selected={1}>
            <s.For each={Array.from({ length: count() }, (_, i) => i)}>
              {(i) => <view id={`c${i}`} width={400} height={200} />}
            </s.For>
          </Row>
        </view>
      ));
      v.expect(row.x).toBe(-430);
      await press(...Array.from({ length: 7 }, () => 'ArrowRight'));
      v.expect([row.selected, row.x]).toEqual([8, -2410]);

      // Adding a child re-lays out the Row; with `selected` set the layout
      // handler re-scrolls as if first shown ('always': x = -childX), past the
      // clamp that auto scrolling applied. Current behaviour.
      setCount(11);
      await flush();
      v.expect([row.selected, focusedId(), row.x]).toEqual([8, 'c8', -3440]);
    },
  );

  v.it(
    'Row without a selected prop keeps its scroll position on layout',
    async () => {
      let row!: lng.ElementNode;
      const [count, setCount] = s.createSignal(10);
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row ref={row} autofocus>
            <s.For each={Array.from({ length: count() }, (_, i) => i)}>
              {(i) => <view id={`c${i}`} width={400} height={200} />}
            </s.For>
          </Row>
        </view>
      ));
      await press(...Array.from({ length: 8 }, () => 'ArrowRight'));
      v.expect([row.selected, row.x]).toEqual([8, -2410]);
      setCount(11);
      await flush();
      v.expect([row.selected, row.x]).toEqual([8, -2410]);
    },
  );

  v.it(
    'scrollToIndex(i) selects and focuses child i; the scroll is one auto step, not an alignment',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row ref={row} autofocus>
            {items(10)}
          </Row>
        </view>
      ));
      const scrollToIndex = (i: number) =>
        (
          row as lng.ElementNode & { scrollToIndex: (i: number) => void }
        ).scrollToIndex(i);
      scrollToIndex(5);
      await flush();
      // Current behaviour: the scroll moves one step (400 + gap 30) whatever the
      // distance jumped.
      v.expect([row.selected, focusedId(), row.x]).toEqual([5, 'c5', -430]);
      scrollToIndex(2);
      await flush();
      // ... and a jump back by more than one still counts as "incrementing".
      v.expect([row.selected, focusedId(), row.x]).toEqual([2, 'c2', -860]);
    },
  );
});

v.describe('Row and Column: onSelectedChanged', () => {
  v.it(
    'called as (idx, container, activeChild, lastIdx) with this = container; twice on autofocus mount; not at an edge',
    async () => {
      let row!: lng.ElementNode;
      const calls: unknown[][] = [];
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row
            ref={row}
            autofocus
            scroll="none"
            onSelectedChanged={function (
              this: unknown,
              idx,
              container,
              active,
              lastIdx,
            ) {
              calls.push([
                this === row,
                idx,
                container === row,
                active?.id,
                lastIdx,
              ]);
            }}
          >
            {items(4, (i) => ({ skipFocus: i === 2 }))}
          </Row>
        </view>
      ));
      // Fires on mount, currently twice: once when the node is rendered with
      // autofocus and again from the deferred autofocus pass.
      v.expect(calls).toEqual([
        [true, 0, true, 'c0', 0],
        [true, 0, true, 'c0', 0],
      ]);
      calls.length = 0;

      await press('ArrowRight');
      await press('ArrowRight'); // skips c2
      await press('ArrowRight'); // at the end: no call
      await press('ArrowLeft');
      v.expect(calls).toEqual([
        [true, 1, true, 'c1', 0],
        [true, 3, true, 'c3', 1],
        [true, 1, true, 'c1', 3],
      ]);
    },
  );

  v.it(
    'fires again with idx === lastIdx when focus re-enters the container',
    async () => {
      const calls: unknown[][] = [];
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Column scroll="none" autofocus>
            <Row
              scroll="none"
              onSelectedChanged={(idx, _c, active, lastIdx) => {
                calls.push([idx, active?.id, lastIdx]);
              }}
            >
              {items(4)}
            </Row>
            <view id="below" width={100} height={100} />
          </Column>
        </view>
      ));
      // Focus forwarded from the autofocused Column: also twice.
      v.expect(calls).toEqual([
        [0, 'c0', 0],
        [0, 'c0', 0],
      ]);
      calls.length = 0;
      await press('ArrowRight', 'ArrowDown');
      v.expect(focusedId()).toBe('below');
      await press('ArrowUp');
      v.expect(focusedId()).toBe('c1');
      v.expect(calls).toEqual([
        [1, 'c1', 0],
        [1, 'c1', 1],
      ]);
    },
  );
});

v.describe('Row and Column: scroll modes', () => {
  // Row: x=100 inside a parent at x=50, ten 400x200 children, default gap 30
  // (children at x = 0, 430, ... 3870; Row width 4270). Ten Right presses,
  // then ten Left presses; the Row's x after each press.
  const rowCases: Record<string, { right: number[]; left: number[] }> = {
    auto: {
      right: [
        -330, -760, -1190, -1620, -2050, -2460, -2460, -2460, -2460, -2460,
      ],
      left: [-2030, -1600, -1170, -740, -310, 100, 100, 100, 100, 100],
    },
    edge: {
      right: [100, 100, 100, -330, -760, -1190, -1620, -2050, -2460, -2460],
      left: [-2460, -2460, -2460, -2050, -1620, -1190, -760, -330, 100, 100],
    },
    always: {
      right: [
        -330, -760, -1190, -1620, -2050, -2480, -2910, -3340, -3770, -3770,
      ],
      left: [-3340, -2910, -2480, -2050, -1620, -1190, -760, -330, 100, 100],
    },
    center: {
      right: [100, -150, -580, -1010, -1440, -1870, -2300, -2460, -2460, -2460],
      left: [-2460, -2300, -1870, -1440, -1010, -580, -150, 100, 100, 100],
    },
    none: {
      right: Array<number>(10).fill(100),
      left: Array<number>(10).fill(100),
    },
  };

  for (const [mode, expected] of Object.entries(rowCases)) {
    v.it(
      `scroll="${mode}": Row x after each Right then each Left`,
      async () => {
        let row!: lng.ElementNode;
        dispose = await mount(() => (
          <view x={50} width={1920} height={1080}>
            <Row
              ref={row}
              autofocus
              x={100}
              scroll={mode as 'auto' | 'edge' | 'always' | 'center' | 'none'}
            >
              {/* edge asks the renderer whether the next child is in the
                viewport; the DOM renderer only tracks that for nodes with a
                texture source, hence src. */}
              {items(10, () => (mode === 'edge' ? { src: 'edge.png' } : {}))}
            </Row>
          </view>
        ));
        v.expect(row.children.map((c) => c.x)).toEqual([
          0, 430, 860, 1290, 1720, 2150, 2580, 3010, 3440, 3870,
        ]);
        v.expect(row.x).toBe(100);

        const right: number[] = [];
        const selected: number[] = [];
        for (let i = 0; i < 10; i++) {
          await press('ArrowRight');
          right.push(row.x);
          selected.push(row.selected!);
        }
        v.expect(selected).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 9]);
        v.expect(focusedId()).toBe('c9');
        v.expect(right).toEqual(expected.right);

        const left: number[] = [];
        for (let i = 0; i < 10; i++) {
          await press('ArrowLeft');
          left.push(row.x);
        }
        v.expect(focusedId()).toBe('c0');
        v.expect(left).toEqual(expected.left);
      },
    );
  }

  v.it('no scroll prop: behaves as "auto"', async () => {
    let row!: lng.ElementNode;
    dispose = await mount(() => (
      <view x={50} width={1920} height={1080}>
        <Row ref={row} autofocus x={100}>
          {items(10)}
        </Row>
      </view>
    ));
    const right: number[] = [];
    for (let i = 0; i < 10; i++) {
      await press('ArrowRight');
      right.push(row.x);
    }
    v.expect(right).toEqual(rowCases.auto!.right);
    const left: number[] = [];
    for (let i = 0; i < 10; i++) {
      await press('ArrowLeft');
      left.push(row.x);
    }
    v.expect(left).toEqual(rowCases.auto!.left);
  });

  // Column: x=10, y=100 inside a parent at (20, 40), eight 400x200 children,
  // default gap 30 (children at y = 0, 230, ... 1610; Column height 1810).
  // Eight Down presses, then eight Up presses; the Column's y after each.
  const colCases: Record<string, { down: number[]; up: number[] }> = {
    auto: {
      down: [-130, -360, -590, -820, -830, -830, -830, -830],
      // Current behaviour: coming back up lands on 90, not on a child edge,
      // because the down scroll was clamped at -830.
      up: [-600, -370, -140, 90, 100, 100, 100, 100],
    },
    edge: {
      down: [100, 100, 100, -130, -360, -590, -830, -830],
      up: [-830, -830, -830, -590, -360, -130, 100, 100],
    },
    always: {
      down: [-130, -360, -590, -820, -1050, -1280, -1510, -1510],
      up: [-1280, -1050, -820, -590, -360, -130, 100, 100],
    },
    center: {
      down: [100, -60, -290, -520, -750, -830, -830, -830],
      up: [-830, -750, -520, -290, -60, 100, 100, 100],
    },
    none: {
      down: Array<number>(8).fill(100),
      up: Array<number>(8).fill(100),
    },
  };

  for (const [mode, expected] of Object.entries(colCases)) {
    v.it(
      `scroll="${mode}": Column y after each Down then each Up`,
      async () => {
        let col!: lng.ElementNode;
        dispose = await mount(() => (
          <view x={20} y={40} width={1920} height={1080}>
            <Column
              ref={col}
              autofocus
              x={10}
              y={100}
              scroll={mode as 'auto' | 'edge' | 'always' | 'center' | 'none'}
            >
              {items(8, () => (mode === 'edge' ? { src: 'edge.png' } : {}))}
            </Column>
          </view>
        ));
        v.expect(col.children.map((c) => c.y)).toEqual([
          0, 230, 460, 690, 920, 1150, 1380, 1610,
        ]);
        v.expect([col.x, col.y]).toEqual([10, 100]);

        const down: number[] = [];
        for (let i = 0; i < 8; i++) {
          await press('ArrowDown');
          down.push(col.y);
        }
        v.expect([col.selected, focusedId()]).toEqual([7, 'c7']);
        v.expect(down).toEqual(expected.down);

        const up: number[] = [];
        for (let i = 0; i < 8; i++) {
          await press('ArrowUp');
          up.push(col.y);
        }
        v.expect([col.selected, focusedId()]).toEqual([0, 'c0']);
        v.expect(up).toEqual(expected.up);
        // Scrolling never moves the cross axis.
        v.expect(col.x).toBe(10);
      },
    );
  }

  v.it(
    'centerScroll on a child: the parent centres that child on screen',
    async () => {
      let col!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Column ref={col} autofocus>
            {/* 300 high, gap 30: children at y = 0, 330, ... 2310 */}
            {items(8, () => ({ height: 300, centerScroll: true }))}
          </Column>
        </view>
      ));
      const down: number[] = [];
      for (let i = 0; i < 8; i++) {
        await press('ArrowDown');
        down.push(col.y);
      }
      // y = -childY + (1080 - 300) / 2, clamped at the end (-1590).
      // Current behaviour: moving down to c1 puts y at +60, below the Column's
      // starting position (the down clamp has no upper bound).
      v.expect(down).toEqual([
        60, -270, -600, -930, -1260, -1590, -1590, -1590,
      ]);
      const up: number[] = [];
      for (let i = 0; i < 8; i++) {
        await press('ArrowUp');
        up.push(col.y);
      }
      // Moving up is clamped at the starting position, so c1 is at 0 not 60.
      v.expect(up).toEqual([-1590, -1260, -930, -600, -270, 0, 0, 0]);
    },
  );

  v.it(
    'scroll="bounded" with upCount: stops scrolling for the last upCount children',
    async () => {
      let col!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          {/* 'bounded' is accepted by withScrolling but missing from the
            public `scroll` type. */}
          <Column ref={col} autofocus scroll={'bounded' as 'auto'} upCount={3}>
            {items(8)}
          </Column>
        </view>
      ));
      const down: number[] = [];
      for (let i = 0; i < 8; i++) {
        await press('ArrowDown');
        down.push(col.y);
      }
      // 8 children, upCount 3: the zone starts at child 5 (y = 1150).
      v.expect(down).toEqual([
        -230, -460, -690, -920, -1150, -1150, -1150, -1150,
      ]);
      const up: number[] = [];
      for (let i = 0; i < 8; i++) {
        await press('ArrowUp');
        up.push(col.y);
      }
      v.expect(up).toEqual([-1150, -1150, -920, -690, -460, -230, 0, 0]);
    },
  );
});

v.describe('Row and Column: transitions and throttleInput', () => {
  v.it(
    'transitionRight/transitionLeft are written to `transition` on each press; a user `transition` wins',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row ref={row} autofocus>
            {items(4)}
          </Row>
        </view>
      ));
      v.expect(row.transition).toBeUndefined();
      await press('ArrowRight');
      v.expect(row.transition).toEqual({
        x: { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      });
      await press('ArrowLeft');
      v.expect(row.transition).toEqual({
        x: { duration: 180, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      });
      dispose();

      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row
            ref={row}
            autofocus
            transition={{ x: { duration: 999 }, alpha: true }}
          >
            {items(4)}
          </Row>
        </view>
      ));
      await press('ArrowRight');
      v.expect(row.transition).toEqual({ x: { duration: 999 }, alpha: true });
      await press('ArrowLeft');
      v.expect(row.transition).toEqual({ x: { duration: 999 }, alpha: true });
    },
  );

  v.it(
    'the merged transition is one object per direction and base `transition`, not one per press (1.7)',
    async () => {
      let row!: lng.ElementNode;
      const [base, setBase] = s.createSignal<lng.NodeProps['transition']>();
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row ref={row} autofocus transition={base()}>
            {items(6)}
          </Row>
        </view>
      ));
      await press('ArrowRight');
      const right = row.transition;
      await press('ArrowRight');
      v.expect(row.transition).toBe(right);
      await press('ArrowLeft');
      const left = row.transition;
      v.expect(left).not.toBe(right);
      await press('ArrowLeft', 'ArrowRight');
      v.expect(row.transition).toBe(right);

      // A new base transition from the app gives new merged objects, again
      // one per direction.
      setBase({ alpha: true });
      await press('ArrowRight');
      const right2 = row.transition;
      v.expect(right2).toEqual({
        x: { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        alpha: true,
      });
      await press('ArrowRight');
      v.expect(row.transition).toBe(right2);
    },
  );

  v.it(
    'Rows without a `transition` do not share a merged transition object (1.7)',
    async () => {
      let r0!: lng.ElementNode;
      let r1!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Column autofocus scroll="none">
            <Row ref={r0}>{items(3)}</Row>
            <Row ref={r1}>{items(3)}</Row>
          </Column>
        </view>
      ));
      await press('ArrowRight', 'ArrowDown', 'ArrowRight');
      v.expect(r0.transition).toEqual(r1.transition);
      v.expect(r0.transition).not.toBe(r1.transition);
    },
  );

  v.it(
    'Rows given the same `transition` object do not share a merged transition object (1.7)',
    async () => {
      let r0!: lng.ElementNode;
      let r1!: lng.ElementNode;
      const shared = { alpha: true };
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Column autofocus scroll="none">
            <Row ref={r0} transition={shared}>
              {items(3)}
            </Row>
            <Row ref={r1} transition={shared}>
              {items(3)}
            </Row>
          </Column>
        </view>
      ));
      await press('ArrowRight', 'ArrowDown', 'ArrowRight');
      v.expect(r0.transition).toEqual({
        x: { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        alpha: true,
      });
      v.expect(r0.transition).toEqual(r1.transition);
      v.expect(r0.transition).not.toBe(r1.transition);
    },
  );

  v.it(
    'throttleInput on a Row: the same key within the window is dropped; another key is not',
    async () => {
      let now = 1000;
      v.vi.spyOn(performance, 'now').mockImplementation(() => now);
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Row ref={row} autofocus scroll="none" throttleInput={100}>
            {items(6)}
          </Row>
        </view>
      ));
      await press('ArrowRight');
      v.expect(focusedId()).toBe('c1');
      now = 1050;
      await press('ArrowRight');
      v.expect(focusedId()).toBe('c1');
      // A dropped press does not restart the window.
      now = 1099;
      await press('ArrowRight');
      v.expect(focusedId()).toBe('c1');
      now = 1100;
      await press('ArrowRight');
      v.expect(focusedId()).toBe('c2');
      // A different key is never throttled.
      now = 1101;
      await press('ArrowLeft');
      v.expect(focusedId()).toBe('c1');
      v.expect(row.selected).toBe(1);
    },
  );
});
