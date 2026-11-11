import * as v from 'vitest';
import * as s from 'solid-js';
import { activeElement, Config, type ElementNode } from '@solidtv/solid';
import {
  VirtualRow,
  VirtualColumn,
  useFocusManager,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { render, settle } from './setup.js';

for (const [Component, axis, key] of [
  [VirtualRow, 'x', 'ArrowRight'],
  [VirtualColumn, 'y', 'ArrowDown'],
] as const) {
  for (const mode of ['edge', 'auto'] as const) {
    v.it(
      `${axis}, ${mode}: viewport bounds align the end through animated resize`,
      async () => {
        const animationsEnabled = Config.animationsEnabled;
        Config.animationsEnabled = false;
        const keys = new EventTarget();
        const [viewport, setViewport] = s.createSignal(795);
        let row!: ElementNode;
        const dispose = render(() => {
          useFocusManager(undefined, keys as unknown as KeyEventTarget);
          return (
            <view x={37} y={19} clipping width={viewport()} height={viewport()}>
              <Component
                ref={row}
                autofocus
                width={axis === 'x' ? viewport() : 196}
                height={axis === 'y' ? viewport() : 196}
                flexBoundary="contain"
                each={Array.from({ length: 50 }, (_, i) => i)}
                displaySize={Math.floor((viewport() + 20) / 216)}
                bufferSize={3}
                gap={20}
                scroll={mode}
              >
                {(item) => (
                  <view
                    id={`peek-${item()}`}
                    item={item()}
                    width={196}
                    height={196}
                  />
                )}
              </Component>
            </view>
          );
        });
        try {
          await settle();
          for (let i = 0; i < 9; i++) {
            keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
            keys.dispatchEvent(new KeyboardEvent('keyup', { key }));
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          await settle();
          v.expect(activeElement()?.id).toBe('peek-9');
          v.expect(row.children.length).toBeLessThanOrEqual(9);

          Config.animationsEnabled = true;
          keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
          keys.dispatchEvent(new KeyboardEvent('keyup', { key }));
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          // Resize before the queued animation's first frame. Its old target
          // must not overwrite the recalculated viewport position on later frames.
          setViewport(500);
          await settle();
          v.expect(activeElement()?.id).toBe('peek-10');
          (
            row as unknown as { scrollToIndex(index: number): void }
          ).scrollToIndex(49);
          await settle();
          const last = row.children[row.children.length - 1]!;
          v.expect(row[axis] + last[axis] + 196).toBe(500);
          v.expect(activeElement()?.id).toBe('peek-49');
          keys.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: key === 'ArrowRight' ? 'ArrowLeft' : 'ArrowUp',
            }),
          );
          keys.dispatchEvent(
            new KeyboardEvent('keyup', {
              key: key === 'ArrowRight' ? 'ArrowLeft' : 'ArrowUp',
            }),
          );
          await settle();
          keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
          keys.dispatchEvent(new KeyboardEvent('keyup', { key }));
          await settle();
          const finalItem = row.children.find((child) => child.item === 49)!;
          // settle() waits for layout, but the renderer can keep animating
          // while frameRequested is false. Wait for the final geometry too.
          await v.vi.waitFor(
            () => {
              v.expect(row[axis] + finalItem[axis] + 196).toBe(500);
            },
            { timeout: 2000, interval: 16 },
          );
          v.expect(activeElement()?.id).toBe('peek-49');
        } finally {
          dispose();
          Config.animationsEnabled = animationsEnabled;
        }
      },
    );
  }
}
