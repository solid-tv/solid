import {
  createSignal,
  createResource,
  createMemo,
  untrack,
  Component,
  JSX,
  sharedConfig,
} from 'solid-js';

// Native ESM's failure message, and ONLY native ESM's. It names exactly one
// module, and that module is always the one handed to `import()` — never one of
// its dependencies. Chrome says `Failed to fetch dynamically imported module:
// <url>` and Firefox `error loading dynamically imported module: <url>`; both
// carry the phrase this matches on.
//
// SystemJS is deliberately NOT matched here. Its message is
// `<failedUrl>, <parentUrl> (SystemJS …)`, and when the failure is a dependency
// of the requested chunk the FIRST url is that dependency. Cache-busting it
// would re-import the wrong module, and `lazy` would then read `.default` off
// it — a blank route, or worse, someone else's component. SystemJS needs no
// cache-buster anyway: it drops the failed load from its registry, so simply
// calling `fn` again re-fetches.
const NATIVE_ESM_CHUNK =
  /dynamically imported module:?\s*(https?:\/\/\S+?\.js)/i;

/**
 * The chunk URL to retry under a cache-buster, or `undefined` when the failure
 * is one where re-running the loader is the right move instead.
 *
 * @internal Exported for tests. The primitives barrel re-exports `lazy` by
 * name, so this stays out of the package's public API.
 */
export const cacheBustableUrl = (error: unknown): string | undefined =>
  NATIVE_ESM_CHUNK.exec(
    error instanceof Error ? error.message : String(error),
  )?.[1];

/** @internal Exported for tests — see `cacheBustableUrl`. */
export const cacheBust = (url: string): string =>
  `${url}${url.indexOf('?') === -1 ? '?' : '&'}chunkRetry=1`;

/**
 * A dynamic `import()`, built at runtime instead of written inline.
 *
 * This is not a style choice, and it must not be "simplified" back to a literal
 * `import(url)`. The token has to stay inside a string, because this file is
 * bundled into apps that cannot parse it:
 *
 * A TV app targeting an old engine may build with no SystemJS transform at all
 * — plain `iife` output plus a syntax-only `build.target`. Rollup cannot rewrite
 * a dynamic import in that format, and a `\/* @vite-ignore *\/` one is invisible
 * to Vite's analysis by design, so the literal survives into the bundle. Dynamic
 * `import()` arrived in Chrome 63; on anything older the whole script fails to
 * *parse*, and the app never boots. That is not hypothetical: it shipped, and it
 * took every Samsung Tizen 4.0 set (Chrome 56) offline until it was rolled back.
 *
 * Inside a `Function` body the token is just text until it is compiled, and that
 * compilation is what the `try` guards. Old engines throw a SyntaxError here and
 * a CSP without `unsafe-eval` throws an EvalError; either way we return `null`
 * and the caller re-runs the loader instead — the same fallback every SystemJS
 * failure already takes. Resolved once and cached, including the `null`.
 */
let nativeImport: ((url: string) => Promise<unknown>) | null | undefined;

const getNativeImport = (): ((url: string) => Promise<unknown>) | null => {
  if (nativeImport === undefined) {
    try {
      nativeImport = new Function('u', 'return import(u)') as (
        url: string,
      ) => Promise<unknown>;
    } catch {
      nativeImport = null;
    }
  }
  return nativeImport;
};

// lazy load a function component asynchronously
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
): T & { preload: () => Promise<{ default: T }> } {
  let comp: () => T | undefined;
  let p: Promise<{ default: T }> | undefined;

  // Retry the import exactly once before giving up. On a TV the chunk fetch is
  // the fragile part — a brief dropout as the viewer presses OK on a rail
  // rejects the import, and because `p` memoises the promise that single
  // rejection is replayed for the rest of the session: the route never renders
  // again, not even on a later navigation. One retry turns the common transient
  // failure into a marginally slower navigation.
  //
  // How it retries depends on which module system failed, because the two need
  // opposite things.
  //
  // SystemJS — the `@vitejs/plugin-legacy` output older TV browsers run — drops
  // the failed load from its registry, so re-running `fn` genuinely re-fetches.
  // That is also the ONLY safe option there: its message names the failed
  // dependency before the chunk that pulled it in, so a URL lifted out of it is
  // frequently not the module we asked for.
  //
  // Native ESM does the opposite. The module map memoises the *failure*, so a
  // second `import()` of the same specifier resolves straight to the cached
  // rejection without ever touching the network — the retry is a no-op exactly
  // where it is needed. It also names one module and only one, the one handed to
  // `import()`, so a cache-busted re-import of it is both safe and necessary: a
  // distinct URL gets a fresh module-map entry and really re-fetches.
  //
  // The cost there is a duplicate module record for this one chunk. Its own
  // imports are unaffected — they resolve to their normal, already-cached URLs —
  // so the duplication does not spread, and it only happens on a retry that
  // would otherwise have left the route dead.
  const load = (): Promise<{ default: T }> =>
    fn().catch((error: unknown) => {
      const url = cacheBustableUrl(error);
      if (url === undefined) return fn();
      // Null when this engine cannot compile a dynamic import, or a CSP forbids
      // compiling one — see `getNativeImport`. Re-running the loader is then the
      // best available retry, exactly as it is for every SystemJS failure.
      const importer = getNativeImport();
      if (importer === null) return fn();
      return importer(cacheBust(url)) as Promise<{ default: T }>;
    });

  const wrap: T & { preload?: () => void } = ((props: any) => {
    const ctx = sharedConfig.context;
    if (ctx) {
      const [s, set] = createSignal<T>();
      sharedConfig.count || (sharedConfig.count = 0);
      sharedConfig.count++;
      (p || (p = load()))
        .then((mod) => {
          !sharedConfig.done && (sharedConfig.context = ctx);
          sharedConfig.count!--;
          set(() => mod.default);
          sharedConfig.context = undefined;
        })
        .catch(() => {});
      comp = s;
    } else if (!comp) {
      const [s] = createResource<T>(() =>
        (p || (p = load())).then((mod) => mod.default),
      );
      comp = s;
    }
    let Comp: T | undefined;
    return createMemo(() => {
      Comp = comp();
      return Comp
        ? untrack(() => {
            if (!ctx || sharedConfig.done) return Comp!(props);
            const c = sharedConfig.context;
            sharedConfig.context = ctx;
            const r = Comp!(props);
            sharedConfig.context = c;
            return r;
          })
        : null;
    }) as unknown as JSX.Element;
  }) as T;
  // The `.then` here is a fire-and-forget side effect (it caches the resolved
  // component); `p` is what the caller gets back. Without the `.catch` that
  // side-effect promise has no rejection handler of its own, so a failed
  // preload raises an unhandledrejection even when the caller dutifully catches
  // the promise it was handed — a warmed route that fails to fetch would report
  // as an uncaught exception. Mirrors the `.catch(() => {})` on the hydration
  // path above; the real failure still reaches the caller through `p`.
  wrap.preload = () =>
    p ||
    ((p = load()).then((mod) => (comp = () => mod.default)).catch(() => {}), p);
  return wrap as T & { preload: () => Promise<{ default: T }> };
}
