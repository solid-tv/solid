/**
 * The cost of ElementNode's forwarded-prop accessors (design 3.6.6), on real
 * renderer v2 handles: 100 rendered <view>s, read and written in a tight
 * loop. Unthrottled; prints the best of 15 repetitions (no timing assertion).
 *
 *   npx vitest run --config=bench/micro/vitest.config.ts --reporter=verbose
 *
 * To compare two versions of src/core/elementNode.ts, run it at each (for
 * the loop-made accessors before 3.6.6: `git show d342c37:src/core/elementNode.ts`).
 * The `[accessor-micro]` line is the result. On an M4 Pro, Chromium 141
 * headless, 2026-10-03 (six runs each): loop-made accessors (d342c37)
 * 15.9-16.3 ms read / 14.7-15.5 ms write; written out (3.6.6)
 * 1.00-1.20 ms read / 1.40-1.60 ms write.
 */
import * as v from 'vitest';
import * as s from 'solid-js';
import type { ElementNode } from '@solidtv/solid';
import { render } from '../../tests/webgl/setup.js';

const NODES = 100;
const LOOPS = 2000;

v.test('accessor micro', () => {
  let row!: ElementNode;
  const dispose = render(() => (
    <view ref={row} width={1920} height={300}>
      <s.For each={Array.from({ length: NODES }, (_, i) => i)}>
        {(i) => (
          <view x={i * 20} y={i} width={200} height={100} alpha={1} scale={1} />
        )}
      </s.For>
    </view>
  ));
  const kids = row.children as ElementNode[];
  // 8 reads per node: x, width, y, height, alpha, scale, w, h.
  const read = () => {
    let sum = 0;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]!;
      sum +=
        c.x + c.width / 2 + c.y + c.height / 2 + c.alpha + c.scale + c.w + c.h;
    }
    return sum;
  };
  // 2 writes per node: x and alpha.
  const write = (k: number) => {
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]!;
      c.x = i * 20 + k;
      c.alpha = k & 1 ? 0.5 : 1;
    }
  };
  // Warm up until both are optimized.
  for (let w = 0; w < 3000; w++) {
    read();
    write(w);
  }
  const bestOf = (fn: () => void) => {
    let best = Infinity;
    for (let r = 0; r < 15; r++) {
      const t0 = performance.now();
      fn();
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };
  let sink = 0;
  const readMs = bestOf(() => {
    for (let n = 0; n < LOOPS; n++) sink += read();
  });
  const writeMs = bestOf(() => {
    for (let n = 0; n < LOOPS; n++) write(n);
  });
  console.info(
    `[accessor-micro] read ${readMs.toFixed(2)} ms (${LOOPS * NODES * 8} reads), ` +
      `write ${writeMs.toFixed(2)} ms (${LOOPS * NODES * 2} writes)`,
  );
  v.expect(sink).toBeGreaterThan(0);
  dispose();
});
