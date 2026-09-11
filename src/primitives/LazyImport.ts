import {
  createSignal,
  createResource,
  createMemo,
  untrack,
  Component,
  JSX,
  sharedConfig,
} from 'solid-js';

// The chunk URL, as named in the failure message by either module system:
// native ESM reports `Failed to fetch dynamically imported module: <url>`,
// SystemJS reports `<url>,  (SystemJS https://…/errors.md#3)`. The first
// http(s) URL ending in `.js` is the chunk in both cases — SystemJS's trailing
// docs link has no `.js` in it, so it cannot be matched by mistake.
const CHUNK_URL = /https?:\/\/\S+?\.js/;

/**
 * @internal Exported for tests. The primitives barrel re-exports `lazy` by
 * name, so this stays out of the package's public API.
 */
export const chunkUrlFromError = (error: unknown): string | undefined =>
  CHUNK_URL.exec(error instanceof Error ? error.message : String(error))?.[0];

/** @internal Exported for tests — see `chunkUrlFromError`. */
export const cacheBust = (url: string): string =>
  `${url}${url.indexOf('?') === -1 ? '?' : '&'}chunkRetry=1`;

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
  // The retry re-imports under a cache-busting URL rather than re-running `fn`,
  // because re-running only works on one of the two module systems we ship to.
  // Under SystemJS — the `@vitejs/plugin-legacy` output older TV browsers run —
  // the failed load is dropped from the registry, so calling `fn` again really
  // does re-fetch. Native ESM does the opposite: the module map memoises the
  // *failure*, so a second `import()` of the same specifier resolves straight to
  // the cached rejection without ever touching the network, and the retry is a
  // no-op precisely where it is needed. A distinct URL gets a fresh module-map
  // entry and actually re-fetches.
  //
  // The cost is a duplicate module record for this one chunk. Its own imports
  // are unaffected — they resolve to their normal, already-cached URLs — so the
  // duplication does not spread, and it only happens on a retry that would
  // otherwise have left the route dead.
  //
  // `fn` is still the fallback when the message names no URL: no worse than not
  // retrying, and it keeps non-URL loaders (tests, custom resolvers) working.
  const load = (): Promise<{ default: T }> =>
    fn().catch((error: unknown) => {
      const url = chunkUrlFromError(error);
      if (url === undefined) return fn();
      return import(/* @vite-ignore */ cacheBust(url)) as Promise<{
        default: T;
      }>;
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
