import { describe, it, expect, vi } from 'vitest';
import {
  cacheBust,
  chunkUrlFromError,
  lazy,
} from '../src/primitives/LazyImport.ts';

// `preload()` is the seam: it drives the same `load()` the render paths use, so
// the retry can be exercised without standing up a renderer.

const Page = () => null;
const mod = { default: Page };

// The two real failure messages, one per module system.
const NATIVE_ESM_ERROR = new Error(
  'Failed to fetch dynamically imported module: https://ott.angel.com/vizio/assets/Theater.page-Bl9KRTxZ.js',
);
const SYSTEMJS_ERROR = new Error(
  'https://ott.angel.com/webos/assets/Theater.page-legacy-C2p81iuu.js,  (SystemJS https://github.com/systemjs/systemjs/blob/main/docs/errors.md#3)',
);

describe('chunkUrlFromError', () => {
  it('reads the chunk URL out of a native ESM failure', () => {
    expect(chunkUrlFromError(NATIVE_ESM_ERROR)).toBe(
      'https://ott.angel.com/vizio/assets/Theater.page-Bl9KRTxZ.js',
    );
  });

  // The SystemJS message wraps the URL in punctuation — a trailing comma, then
  // its own docs link. The `.js` anchor is what stops the match running past
  // the chunk into that comma; dropping it yields a URL that 404s on retry.
  it('reads the chunk URL, not the docs link, out of a SystemJS failure', () => {
    expect(chunkUrlFromError(SYSTEMJS_ERROR)).toBe(
      'https://ott.angel.com/webos/assets/Theater.page-legacy-C2p81iuu.js',
    );
  });

  it('returns undefined when the message names no chunk', () => {
    expect(chunkUrlFromError(new Error('boom'))).toBeUndefined();
    expect(chunkUrlFromError('not an error at all')).toBeUndefined();
  });
});

describe('cacheBust', () => {
  it('starts a query string when the URL has none', () => {
    expect(cacheBust('https://x/a.js')).toBe('https://x/a.js?chunkRetry=1');
  });

  it('appends to an existing query string', () => {
    expect(cacheBust('https://x/a.js?v=1')).toBe(
      'https://x/a.js?v=1&chunkRetry=1',
    );
  });
});

describe('lazy() chunk-load retry', () => {
  it('does not retry an import that succeeds', async () => {
    const fn = vi.fn().mockResolvedValue(mod);

    await expect(lazy(fn).preload()).resolves.toBe(mod);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // When the failure names a chunk, the retry must NOT re-run the loader:
  // re-running the same specifier is exactly the no-op that leaves Vizio
  // broken, because native ESM serves the memoised failure from the module map.
  // The loader staying on one call is what proves the cache-busting branch ran.
  //
  // The import itself cannot resolve here — Node's ESM loader only accepts
  // `file:` and `data:` — so the promise rejects. That rejection is the test
  // environment's, not the behaviour under test, hence no assertion on its
  // message; `chunkUrlFromError` and `cacheBust` above pin the URL that is
  // actually requested.
  it.each([
    ['native ESM', NATIVE_ESM_ERROR],
    ['SystemJS', SYSTEMJS_ERROR],
  ])(
    're-imports under a cache-busting URL after a %s failure',
    async (_label, error) => {
      const fn = vi.fn().mockRejectedValue(error);

      await expect(lazy(fn).preload()).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  // A loader that is not a URL import at all — a test stub, a custom resolver —
  // has no URL to bust, so re-running it is the best available retry.
  it('re-runs the loader when the failure names no chunk URL', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(mod);

    await expect(lazy(fn).preload()).resolves.toBe(mod);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Bounded at one retry: a TV that has genuinely lost its connection should
  // surface the failure rather than sit on a blank screen retrying.
  it('gives up after exactly one retry and rejects with the second error', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'));

    await expect(lazy(fn).preload()).rejects.toThrow('second');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // `p` memoises the promise, so a component mounting after a preload — or
  // several routes preloading at once — must not refetch the chunk.
  it('loads the chunk once across repeated preloads', async () => {
    const fn = vi.fn().mockResolvedValue(mod);
    const Comp = lazy(fn);

    await Promise.all([Comp.preload(), Comp.preload()]);
    await Comp.preload();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

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
