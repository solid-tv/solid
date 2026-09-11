import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  cacheBust,
  cacheBustableUrl,
  lazy,
} from '../src/primitives/LazyImport.ts';

// `preload()` is the seam: it drives the same `load()` the render paths use, so
// the retry can be exercised without standing up a renderer.

const Page = () => null;
const mod = { default: Page };

// Real production failure messages, one per module system.
const NATIVE_ESM_ERROR = new Error(
  'Failed to fetch dynamically imported module: https://ott.angel.com/vizio/assets/Theater.page-Bl9KRTxZ.js',
);
const FIREFOX_ESM_ERROR = new Error(
  'error loading dynamically imported module: https://ott.angel.com/vizio/assets/Theater.page-Bl9KRTxZ.js',
);
// SystemJS error #3, direct: `<failedUrl>, <parentUrl> (SystemJS …)` with no parent.
const SYSTEMJS_ERROR = new Error(
  'https://ott.angel.com/webos/assets/Theater.page-legacy-C2p81iuu.js,  (SystemJS https://github.com/systemjs/systemjs/blob/main/docs/errors.md#3)',
);
// SystemJS error #3 for a DEPENDENCY: the first URL is the dependency that
// failed, the second is the route chunk that pulled it in. Taken verbatim from
// production — this is the shape that made the old first-URL match wrong.
const SYSTEMJS_DEPENDENCY_ERROR = new Error(
  'https://ott.angel.com/webos/assets/TheaterPlayer.nav-legacy-1MzaTqJc.js, https://ott.angel.com/webos/assets/DiscoverV2Hero.page-legacy-CKnRyt-q.js (SystemJS https://github.com/systemjs/systemjs/blob/main/docs/errors.md#3)',
);

describe('cacheBustableUrl', () => {
  it('returns the chunk named by a native ESM failure', () => {
    expect(cacheBustableUrl(NATIVE_ESM_ERROR)).toBe(
      'https://ott.angel.com/vizio/assets/Theater.page-Bl9KRTxZ.js',
    );
  });

  it("matches Firefox's wording as well as Chrome's", () => {
    expect(cacheBustableUrl(FIREFOX_ESM_ERROR)).toBe(
      'https://ott.angel.com/vizio/assets/Theater.page-Bl9KRTxZ.js',
    );
  });

  // The regression this file exists for. SystemJS names the failed DEPENDENCY
  // first; cache-busting it would re-import the wrong module and `lazy` would
  // read `.default` off it. SystemJS re-fetches on a plain re-run anyway, so the
  // right answer for every SystemJS shape is "no cache-bustable URL".
  it('refuses the dependency URL in a SystemJS dependency failure', () => {
    expect(cacheBustableUrl(SYSTEMJS_DEPENDENCY_ERROR)).toBeUndefined();
  });

  it('refuses a direct SystemJS failure too', () => {
    expect(cacheBustableUrl(SYSTEMJS_ERROR)).toBeUndefined();
  });

  it('returns undefined when the message names no chunk', () => {
    expect(cacheBustableUrl(new Error('boom'))).toBeUndefined();
    expect(cacheBustableUrl('not an error at all')).toBeUndefined();
    // Safari phrases it without naming the module at all.
    expect(
      cacheBustableUrl(new Error('Importing a module script failed.')),
    ).toBeUndefined();
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

  // Native ESM: the retry must NOT re-run the loader, because re-running the
  // same specifier is exactly the no-op that leaves it broken — the module map
  // serves the memoised failure. The loader staying on one call is what proves
  // the cache-busting branch ran.
  //
  // The import itself cannot resolve here — Node's ESM loader only accepts
  // `file:` and `data:` — so the promise rejects. That rejection is the test
  // environment's, not the behaviour under test, hence no assertion on its
  // message; `cacheBustableUrl` and `cacheBust` above pin the URL requested.
  it('re-imports under a cache-busting URL after a native ESM failure', async () => {
    const fn = vi.fn().mockRejectedValue(NATIVE_ESM_ERROR);

    await expect(lazy(fn).preload()).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // SystemJS: re-running the loader is both sufficient (the registry entry is
  // dropped, so it really re-fetches) and necessary (its message may name a
  // dependency rather than the requested chunk).
  it.each([
    ['direct', SYSTEMJS_ERROR],
    ['dependency', SYSTEMJS_DEPENDENCY_ERROR],
  ])(
    're-runs the loader after a SystemJS %s failure',
    async (_label, error) => {
      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(mod);

      await expect(lazy(fn).preload()).resolves.toBe(mod);
      expect(fn).toHaveBeenCalledTimes(2);
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

describe('dynamic import is never written as a literal token', () => {
  // The regression that took every Samsung Tizen 4.0 set (Chrome 56) offline.
  // A `/* @vite-ignore */ import(url)` written inline survives into bundles that
  // have no SystemJS transform — plain `iife` output with a syntax-only
  // `build.target`. Dynamic import arrived in Chrome 63, so older engines fail
  // to PARSE the whole script and the app never boots.
  //
  // A low-tech canary rather than a parser: it fails loudly if anyone
  // "simplifies" the Function-built importer back to the inline form.
  // Resolved from the repo root: under Vite, `import.meta.url` is not a
  // file: URL, so readFileSync cannot take it directly.
  const source = readFileSync(
    resolve(process.cwd(), 'src/primitives/LazyImport.ts'),
    'utf8',
  );

  it('does not contain the inline @vite-ignore import that shipped the outage', () => {
    expect(source).not.toContain('import(/* @vite-ignore */');
  });

  it('builds the importer through Function so the token stays inside a string', () => {
    expect(source).toContain("new Function('u', 'return import(u)')");
  });
});

describe('getNativeImport fallback', () => {
  // Chrome 56 throws a SyntaxError compiling the body; a CSP without
  // unsafe-eval throws an EvalError. Both must degrade to re-running the loader
  // rather than surfacing, so the retry is never worse than not cache-busting.
  it('re-runs the loader when Function cannot compile a dynamic import', async () => {
    const RealFunction = globalThis.Function;

    try {
      // The importer is resolved once and cached at module scope, so the module
      // has to be re-instantiated with Function already stubbed.
      vi.resetModules();
      globalThis.Function = function BlockedFunction() {
        throw new EvalError('Refused to evaluate a string as JavaScript');
      } as unknown as FunctionConstructor;

      const fresh = await import('../src/primitives/LazyImport.ts');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(NATIVE_ESM_ERROR)
        .mockResolvedValue(mod);

      await expect(fresh.lazy(fn).preload()).resolves.toBe(mod);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.Function = RealFunction;
      vi.resetModules();
    }
  });
});
