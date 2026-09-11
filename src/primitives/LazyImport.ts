import {
  createSignal,
  createResource,
  createMemo,
  untrack,
  Component,
  JSX,
  sharedConfig,
} from 'solid-js';

// lazy load a function component asynchronously
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
): T & { preload: () => Promise<{ default: T }> } {
  let comp: () => T | undefined;
  let p: Promise<{ default: T }> | undefined;
  const wrap: T & { preload?: () => void } = ((props: any) => {
    const ctx = sharedConfig.context;
    if (ctx) {
      const [s, set] = createSignal<T>();
      sharedConfig.count || (sharedConfig.count = 0);
      sharedConfig.count++;
      (p || (p = fn()))
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
        (p || (p = fn())).then((mod) => mod.default),
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
    ((p = fn()).then((mod) => (comp = () => mod.default)).catch(() => {}), p);
  return wrap as T & { preload: () => Promise<{ default: T }> };
}
