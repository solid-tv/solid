// The scroll controller must finish on the real renderer as well as the DOM one.
import * as v from 'vitest';
import * as s from 'solid-js';
import { activeElement, Config, type ElementNode } from '@solidtv/solid';
import {
  VirtualRow,
  VirtualColumn,
  useFocusManager,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { render, renderer, settle } from './setup.js';

for (const [Component, axis, key, target] of [
  [VirtualRow, 'x', 'ArrowRight', -180],
  [VirtualColumn, 'y', 'ArrowDown', -80],
] as const) {
  v.it.each(['scheduled', 'running'] as const)(
    `${axis}: changing duration to 0 finishes a %s scroll on WebGL`,
    async (state) => {
      const animationsEnabled = Config.animationsEnabled;
      Config.animationsEnabled = true;
      const [duration, setDuration] = s.createSignal(10000);
      const keys = new EventTarget();
      let row!: ElementNode;
      const dispose = render(() => {
        useFocusManager(undefined, keys as unknown as KeyEventTarget);
        return (
          <view width={1920} height={1080}>
            <Component
              ref={row}
              autofocus
              x={50}
              y={50}
              each={Array.from({ length: 12 }, (_, i) => i)}
              displaySize={4}
              transitionLeft={false}
              transitionRight={false}
              transitionUp={false}
              transitionDown={false}
              animationSettings={{ duration: duration() }}
            >
              {(item) => (
                <view
                  id={`item-${item()}`}
                  item={item()}
                  width={200}
                  height={100}
                />
              )}
            </Component>
          </view>
        );
      });
      try {
        await settle();
        keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
        // Navigation and applyShift run in microtasks, before an animation frame.
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        v.expect(row.cursor).toBe(1);
        if (state === 'running') {
          // Advance the real controller deterministically, without a wall-clock wait.
          renderer.animationManager.step(1);
          v.expect(row[axis]).toBeLessThan(50);
        }
        v.expect(row[axis]).toBeGreaterThan(target);

        setDuration(0);
        v.expect(row[axis]).toBe(target);
        await settle();
        v.expect(row[axis]).toBe(target);
        v.expect(activeElement()?.id).toBe('item-1');

        keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
        await settle();
        v.expect(row.cursor).toBe(2);
        v.expect(activeElement()?.id).toBe('item-2');
        v.expect(row[axis]).toBe(target);
      } finally {
        dispose();
        Config.animationsEnabled = animationsEnabled;
      }
    },
  );
}
