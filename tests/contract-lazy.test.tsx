// Contract tests: LazyRow and LazyColumn (upCount, sync, buffer,
// delay, eagerLoad; items mount progressively as you navigate).
//
// Pins today's behaviour (1.7) through the public surface: keys go through
// the focus manager's real keydown listener (so the handler runs inside the
// focus manager's owner, as in an app); assertions read the mounted child
// count, the focused element and final x/y. Animations are off.
//
// Note: `bufferSize` is not a Lazy prop (it is VirtualRow/VirtualColumn's);
// Lazy's is `buffer`. The demo app passes `bufferSize` to LazyRow/LazyColumn,
// where it has no effect (pinned below).
import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import {
  LazyRow,
  LazyColumn,
  useFocusManager,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { renderer } from './setup.js';

// Real KeyboardEvents on the target the focus manager listens to. A private
// target (instead of `document`) keeps listeners other files leave on
// `document` (vitest isolate: false) from handling a press twice.
const keys = new EventTarget();
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function press(...names: string[]) {
  for (const key of names) {
    keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
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

const twenty = Array.from({ length: 20 }, (_, i) => i);

let dispose: (() => void) | undefined;
const animationsEnabled = lng.Config.animationsEnabled;
const taskDelay = lng.Config.taskDelay;

v.beforeAll(() => {
  lng.Config.animationsEnabled = false;
});
v.afterAll(() => {
  lng.Config.animationsEnabled = animationsEnabled;
});
v.afterEach(() => {
  dispose?.();
  dispose = undefined;
  lng.Config.taskDelay = taskDelay;
  lng.clearTasks();
});

/** Presses Right `n` times; returns [mounted count, focused id, x] after each. */
async function walkRight(row: lng.ElementNode, n: number) {
  const seen: unknown[] = [];
  for (let i = 0; i < n; i++) {
    await press('ArrowRight');
    seen.push([row.children.length, focusedId(), row.x]);
  }
  return seen;
}

v.describe('LazyRow', () => {
  v.it(
    'upCount with the default buffer (upCount + 1): mounts upCount + 1, then one more per Right; x scrolls once the row is wider than the screen',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyRow ref={row} autofocus each={twenty} upCount={3} sync>
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyRow>
        </view>
      ));
      v.expect([row.children.length, focusedId()]).toEqual([4, 'l0']);
      // Nothing more mounts on its own.
      await wait(50);
      v.expect(row.children.length).toBe(4);

      // 200 wide + gap 30. Current behaviour: the auto-scroll clamp uses the
      // Row width from before this press's item is laid out, so the first
      // scroll is -180 rather than -230.
      v.expect(await walkRight(row, 8)).toEqual([
        [5, 'l1', 0],
        [6, 'l2', 0],
        [7, 'l3', 0],
        [8, 'l4', 0],
        [9, 'l5', 0],
        [10, 'l6', -180],
        [11, 'l7', -410],
        [12, 'l8', -640],
      ]);
    },
  );

  v.it(
    'without sync and with the default buffer the first mount is the same (upCount + 1)',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyRow ref={row} autofocus each={twenty} upCount={3}>
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyRow>
        </view>
      ));
      v.expect(row.children.length).toBe(4);
      await wait(50);
      v.expect(row.children.length).toBe(4);
      v.expect(
        (await walkRight(row, 3)).map((s) => (s as unknown[])[0]),
      ).toEqual([5, 6, 7]);
    },
  );

  v.it(
    'upCount without sync ramps up to upCount (one item per ~16ms) when buffer < upCount; sync mounts upCount at once',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyRow ref={row} autofocus each={twenty} upCount={3} buffer={1}>
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyRow>
        </view>
      ));
      v.expect(row.children.length).toBe(2);
      await v.vi.waitFor(() => v.expect(row.children.length).toBe(3));
      await wait(60);
      v.expect(row.children.length).toBe(3);
      dispose();

      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyRow
            ref={row}
            autofocus
            each={twenty}
            upCount={3}
            buffer={1}
            sync
          >
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyRow>
        </view>
      ));
      v.expect(row.children.length).toBe(3);
    },
  );

  v.it(
    'buffer={2}: mounts once the selection is within 2 of the rendered edge',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyRow
            ref={row}
            autofocus
            each={twenty}
            upCount={3}
            buffer={2}
            sync
            scroll="none"
          >
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyRow>
        </view>
      ));
      v.expect(row.children.length).toBe(3);
      v.expect(await walkRight(row, 5)).toEqual([
        [3, 'l1', 0],
        [4, 'l2', 0],
        [5, 'l3', 0],
        [6, 'l4', 0],
        [7, 'l5', 0],
      ]);
    },
  );

  v.it(
    'scroll="center" defaults buffer to ceil(upCount / 2) + 1; scroll="edge" to 2',
    async () => {
      const counts = async (scroll: 'center' | 'edge') => {
        let row!: lng.ElementNode;
        dispose = await mount(() => (
          <view width={1920} height={1080}>
            <LazyRow
              ref={row}
              autofocus
              each={twenty}
              upCount={3}
              sync
              scroll={scroll}
            >
              {(item) => <view id={`l${item()}`} width={200} height={100} />}
            </LazyRow>
          </view>
        ));
        const seen = [row.children.length];
        for (let i = 0; i < 3; i++) {
          await press('ArrowRight');
          seen.push(row.children.length);
        }
        dispose();
        dispose = undefined;
        return seen;
      };
      // center: buffer 3, so the first Right (selected 0 >= 3 - 3) mounts.
      v.expect(await counts('center')).toEqual([3, 4, 5, 6]);
      // edge: buffer 2, so the first Right does not mount.
      v.expect(await counts('edge')).toEqual([3, 3, 4, 5]);
    },
  );

  v.it(
    'bufferSize is not a Lazy prop: same mounts as without it (the demo app passes it)',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyRow
            ref={row}
            autofocus
            each={twenty}
            upCount={3}
            sync
            {...{ bufferSize: 0 }}
          >
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyRow>
        </view>
      ));
      v.expect(row.children.length).toBe(4);
      v.expect(
        (await walkRight(row, 3)).map((s) => (s as unknown[])[0]),
      ).toEqual([5, 6, 7]);
    },
  );

  v.it(
    'delay: the mount waits for the delay; pressing faster mounts immediately and re-arms the timer',
    async () => {
      let row!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyRow
            ref={row}
            autofocus
            each={twenty}
            upCount={3}
            sync
            delay={300}
          >
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyRow>
        </view>
      ));
      const seen: unknown[] = [];
      for (let i = 0; i < 8; i++) {
        await press('ArrowRight');
        seen.push([row.children.length, focusedId()]);
      }
      v.expect(seen).toEqual([
        [4, 'l1'], // first press: mount deferred by `delay`
        [5, 'l2'],
        [6, 'l3'],
        [7, 'l4'],
        [8, 'l5'],
        [9, 'l6'],
        [10, 'l7'],
        [11, 'l8'],
      ]);
      // The trailing timer adds one more.
      await v.vi.waitFor(() => v.expect(row.children.length).toBe(12), {
        timeout: 2000,
      });
    },
  );

  v.it('stops mounting at the end of `each`', async () => {
    let row!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={1920} height={1080}>
        <LazyRow ref={row} autofocus each={[0, 1, 2, 3, 4, 5]} upCount={3} sync>
          {(item) => <view id={`l${item()}`} width={200} height={100} />}
        </LazyRow>
      </view>
    ));
    const seen = (await walkRight(row, 7)).map((s) =>
      (s as unknown[]).slice(0, 2),
    );
    v.expect(seen).toEqual([
      [5, 'l1'],
      [6, 'l2'],
      [6, 'l3'],
      [6, 'l4'],
      [6, 'l5'],
      [6, 'l5'],
      [6, 'l5'],
    ]);
  });

  // B16 (fixed in 1.7), with buffer={1}: the press that left the selection
  // on the last rendered child did not mount (updateOffset checks the
  // selection before the move); the next press mounted, but the key handler
  // runs inside the focus manager's runWithOwner, which batches the write, so
  // the new child existed only after the Row's handler had run. That press
  // found nothing to move to and bubbled: every other press was lost (focus
  // went l1, l2, l2, l3, l3, ...). A buffer below 2 now acts as 2.
  v.it(
    'B16: with a small buffer every press moves and none bubbles',
    async () => {
      let row!: lng.ElementNode;
      const parentRight = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view width={1920} height={1080} onRight={parentRight}>
          <LazyRow
            ref={row}
            autofocus
            each={twenty}
            upCount={3}
            buffer={1}
            sync
            scroll="none"
          >
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyRow>
        </view>
      ));
      v.expect(row.children.length).toBe(3);
      // [mounted, focused] after each press: a mount starts one press before
      // the selection reaches the last mounted child.
      v.expect(await walkRight(row, 5)).toEqual([
        [3, 'l1', 0],
        [4, 'l2', 0],
        [5, 'l3', 0],
        [6, 'l4', 0],
        [7, 'l5', 0],
      ]);
      v.expect(parentRight).not.toHaveBeenCalled();
    },
  );
});

v.describe('LazyColumn', () => {
  v.it(
    'mounts upCount + 1, then one more per Down until the end; y scrolls',
    async () => {
      let col!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyColumn
            ref={col}
            autofocus
            each={[0, 1, 2, 3, 4, 5, 6, 7]}
            upCount={3}
            sync
            y={20}
          >
            {(item) => <view id={`l${item()}`} width={200} height={200} />}
          </LazyColumn>
        </view>
      ));
      const seen: unknown[] = [[col.children.length, focusedId(), col.y]];
      for (let i = 0; i < 9; i++) {
        await press('ArrowDown');
        seen.push([col.children.length, focusedId(), col.y]);
      }
      await press('ArrowUp');
      seen.push([col.children.length, focusedId(), col.y]);
      // 200 high + gap 30.
      v.expect(seen).toEqual([
        [4, 'l0', 20],
        [5, 'l1', 20],
        [6, 'l2', -100],
        [7, 'l3', -330],
        [8, 'l4', -560],
        [8, 'l5', -790],
        [8, 'l6', -790],
        [8, 'l7', -790],
        [8, 'l7', -790],
        [8, 'l7', -790],
        [8, 'l6', -560],
      ]);
    },
  );

  v.it(
    'eagerLoad: mounts one past the initial count, then the rest one per task once the renderer reports idle',
    async () => {
      lng.Config.taskDelay = 1;
      let col!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <LazyColumn ref={col} autofocus each={twenty} upCount={3} eagerLoad>
            {(item) => <view id={`l${item()}`} width={200} height={100} />}
          </LazyColumn>
        </view>
      ));
      v.expect(col.children.length).toBe(5);
      // Background mounts go through scheduleTask, which runs only after the
      // renderer's 'idle' event. The DOM renderer used by these tests never
      // emits it, so raise it as the WebGL renderer would.
      await wait(50);
      v.expect(col.children.length).toBe(5);
      (
        renderer.renderer as unknown as {
          emit: (event: string, data: unknown) => void;
        }
      ).emit('idle', {});
      await v.vi.waitFor(() => v.expect(col.children.length).toBe(20), {
        timeout: 2000,
      });
      v.expect(focusedId()).toBe('l0');
    },
  );
});
