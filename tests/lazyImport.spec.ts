import { describe, it, expect, vi } from 'vitest';
import { lazy } from '../src/primitives/LazyImport.ts';

// `preload()` is the seam: it drives the same `load()` the render paths use, so
// the retry can be exercised without standing up a renderer.

const Page = () => null;
const mod = { default: Page };

describe('lazy() preload rejection handling', () => {
  // A warmed route that fails to fetch must not surface as an uncaught
  // exception. `preload()`'s internal `.then` is a fire-and-forget side effect,
  // so without its own catch it raises an unhandledRejection even when the
  // caller catches the promise it was handed.
  //
  // The listener goes on `process`, not `window`: under the jsdom environment a
  // Node-level promise rejection is reported there, and a `window`
  // 'unhandledrejection' listener never fires — a version of this test written
  // that way passes whether or not the bug is present.
  it('does not raise an unhandled rejection when a preload fails', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const fn = vi.fn().mockRejectedValue(new Error('chunk gone'));
      await expect(lazy(fn).preload()).rejects.toThrow('chunk gone');

      // Node reports a rejection as unhandled a macrotask after the fact.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
