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

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const items = Array.from({ length: 50 }, (_, i) => i);
let dispose: (() => void) | undefined;
let animationsEnabled: boolean;

v.beforeEach(() => {
  animationsEnabled = lng.Config.animationsEnabled;
  lng.Config.animationsEnabled = false;
});
v.afterEach(() => {
  dispose?.();
  dispose = undefined;
  lng.Config.animationsEnabled = animationsEnabled;
});

for (const [Component, axis, forward, back] of [
  [VirtualRow, 'x', 'ArrowRight', 'ArrowLeft'],
  [VirtualColumn, 'y', 'ArrowDown', 'ArrowUp'],
] as const) {
  const origin = axis === 'x' ? 37 : 19;
  async function mount(
    initialWidth: number,
    initialItems = items,
    scroll: 'edge' | 'auto' | 'always' | 'none' | 'center' = 'edge',
    initialStopLast = false,
    selected?: number,
  ) {
    const [width, setWidth] = s.createSignal(initialWidth);
    const [stopLast, setStopLast] = s.createSignal(initialStopLast);
    const [data, setData] = s.createSignal(initialItems);
    const keys = new EventTarget();
    let row!: lng.ElementNode;
    dispose = renderer.render(() => {
      useFocusManager(undefined, keys as unknown as KeyEventTarget);
      return (
        <view width={1600} height={1600}>
          <Component
            ref={row}
            autofocus
            x={37}
            y={19}
            width={axis === 'x' ? width() : 196}
            height={axis === 'y' ? width() : 196}
            flexBoundary="contain"
            each={data()}
            displaySize={Math.max(1, Math.floor((width() + 20) / 216))}
            bufferSize={3}
            gap={20}
            scroll={scroll}
            scrollStopLast={stopLast()}
            selected={selected}
          >
            {(item) => (
              <view
                id={`bound-${item()}`}
                item={item()}
                width={196}
                height={196}
              />
            )}
          </Component>
        </view>
      );
    }) as unknown as () => void;
    await flush();
    const press = async (key: string) => {
      keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
      keys.dispatchEvent(new KeyboardEvent('keyup', { key }));
      await flush();
    };
    const fragments = () => {
      const positions = row.children.map(
        (child) => row[axis] + child[axis] - origin,
      );
      return [
        positions.some((p) => p < 0 && p + 196 > 0),
        positions.some((p) => p < width() && p + 196 > width()),
      ];
    };
    return { row, press, fragments, setWidth, setStopLast, setData };
  }

  for (const mode of ['edge', 'auto'] as const) {
    for (const width of [500, 648, 795]) {
      v.it(
        `${axis}, ${mode}, ${width}: aligns the last item and returns to the start`,
        async () => {
          const { row, press } = await mount(width, items.slice(0, 15), mode);
          for (let i = 1; i < 15; i++) {
            await press(forward);
            v.expect(lng.activeElement()?.id).toBe(`bound-${i}`);
            const active = lng.activeElement()!;
            const left = row[axis] + active[axis] - origin;
            v.expect(left).toBeGreaterThanOrEqual(0);
            v.expect(left + 196).toBeLessThanOrEqual(width);
          }
          const last = row.children.find((child) => child.item === 14)!;
          v.expect(row[axis] + last[axis] + 196 - origin).toBe(width);
          v.expect(
            row[axis] + row.children[0]![axis] - origin,
          ).toBeLessThanOrEqual(0);
          for (let i = 14; i > 0; i--) await press(back);
          v.expect(row[axis]).toBe(origin);
          v.expect(lng.activeElement()?.id).toBe('bound-0');
        },
      );
    }

    v.it(
      `${axis}, ${mode}: a short list stays at its original position`,
      async () => {
        const { row, press } = await mount(795, [0, 1, 2], mode);
        await press(forward);
        await press(forward);
        v.expect(row[axis]).toBe(origin);
        v.expect(lng.activeElement()?.id).toBe('bound-2');
      },
    );

    v.it(
      `${axis}, ${mode}: initial selected at the end uses the same alignment`,
      async () => {
        const { row } = await mount(795, items.slice(0, 15), mode, false, 14);
        const last = row.children.find((child) => child.item === 14)!;
        v.expect(row[axis] + last[axis] + 196 - origin).toBe(795);
        v.expect(lng.activeElement()?.id).toBe('bound-14');
        v.expect(
          row[axis] + row.children[0]![axis] - origin,
        ).toBeLessThanOrEqual(0);
      },
    );

    v.it(
      `${axis}, ${mode}: resize followed immediately by navigation keeps focus consistent`,
      async () => {
        const { row, press, setWidth } = await mount(795, items, mode);
        for (let i = 0; i < 9; i++) await press(forward);
        setWidth(500);
        await press(forward);
        v.expect(row.cursor).toBe(10);
        v.expect(lng.activeElement()?.id).toBe('bound-10');
        v.expect(row.children[row.selected!]!.item).toBe(10);
      },
    );

    v.it(
      `${axis}, ${mode}: shrinking a scrolled list restores a short list to the start`,
      async () => {
        const { row, press, setData } = await mount(795, items, mode);
        for (let i = 0; i < 9; i++) await press(forward);
        setData([0, 1]);
        await flush();
        v.expect(row[axis]).toBe(origin);
        v.expect(lng.activeElement()?.id).toBe('bound-1');
      },
    );

    v.it(
      `${axis}, ${mode}: scrollStopLast retains native placement`,
      async () => {
        const { row, press } = await mount(795, items.slice(0, 15), mode, true);
        for (let i = 0; i < 14; i++) await press(forward);
        const last = row.children.find((child) => child.item === 14)!;
        const expectedGap = mode === 'edge' ? 167 : 383;
        v.expect(795 - (row[axis] + last[axis] + 196 - origin)).toBe(
          expectedGap,
        );
      },
    );
  }

  for (const mode of ['edge', 'auto'] as const) {
    v.it(
      `${axis}, ${mode}: changing scrollStopLast updates the tail without changing focus`,
      async () => {
        const { row, press, setStopLast } = await mount(
          795,
          items.slice(0, 15),
          mode,
        );
        for (let i = 0; i < 14; i++) await press(forward);
        const right = () => {
          const last = row.children.find((child) => child.item === 14)!;
          return row[axis] + last[axis] + 196 - origin;
        };
        v.expect(right()).toBe(795);
        setStopLast(true);
        await flush();
        v.expect(795 - right()).toBe(mode === 'edge' ? 167 : 383);
        setStopLast(false);
        await flush();
        v.expect(right()).toBe(795);
        v.expect(lng.activeElement()?.id).toBe('bound-14');
      },
    );
  }

  for (const mode of ['always', 'none', 'center'] as const) {
    v.it(
      `${axis}, ${mode}: viewport bounds do not change the native mode`,
      async () => {
        const { row, press } = await mount(795, items.slice(0, 15), mode);
        for (let i = 0; i < 14; i++) await press(forward);
        v.expect(lng.activeElement()?.id).toBe('bound-14');
        const left = row[axis] + lng.activeElement()![axis] - origin;
        v.expect(left).toBe(mode === 'always' ? 0 : 1080);
      },
    );
  }
}
