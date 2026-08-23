import { getOwner, runWithOwner, createMemo } from 'solid-js';
import {
  createRouter,
  hashHistory,
  type Params,
  type RouteDefinition,
  type RouteDescription,
  type RouteMatch,
  type RouterConfig,
  type SearchParams,
} from '@solidjs/router';

export function hashParser(str: string) {
  const to = str.replace(/^.*?#/, '');
  // Hash-only hrefs like `#foo` from plain anchors will come in as `/#foo` whereas a link to
  // `/foo` will be `/#/foo`. Check if the to starts with a `/` and if not append it as a hash
  // to the current path so we can handle these in-page anchors correctly.
  if (!to.startsWith('/')) {
    const [, path = '/'] = window.location.hash.split('#', 2);
    return `${path}#${to}`;
  }
  return to;
}

export function bindEvent(
  target: EventTarget,
  type: string,
  handler: EventListener,
) {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

export type HashRouterConfig<
  R extends readonly RouteDefinition[] = RouteDefinition[],
> = Omit<RouterConfig<R>, 'history'> & {
  /**
   * Use the Proxy-free params/query implementation even where `Proxy` exists.
   * Off by default; it is selected automatically on engines without `Proxy`.
   */
  forceProxy?: boolean;
  /**
   * Query keys to expose when running without `Proxy`. Without `Proxy` the
   * key set cannot be discovered lazily, so unlisted query params are not
   * reactive. Ignored when `Proxy` is available.
   */
  queryParams?: string[];
};

/**
 * Hash-based router for TV devices, where apps are frequently served from a
 * path that cannot use history routing.
 *
 * Solid Router 2.0 builds routers from a route tree plus a history adapter and
 * ships `hashHistory()` itself, so this is now a thin factory over
 * `createRouter` rather than the hand-rolled component SolidTV shipped in 1.x.
 * What it still adds is the Proxy-free params/query path for Chrome 38 —
 * `queryWrapper`/`paramsWrapper` remain the supported hooks for that.
 *
 * ```tsx
 * const Router = createHashRouter({
 *   routes: [{ path: '/', component: Home }],
 * });
 *
 * render(() => <Router>{(props) => <App>{props.children}</App>}</Router>);
 * ```
 */
export function createHashRouter<
  const R extends readonly RouteDefinition[] = RouteDefinition[],
>(config: HashRouterConfig<R>) {
  const { forceProxy, queryParams, ...rest } = config;
  const history = hashHistory();

  if (forceProxy === true || !SUPPORTS_PROXY) {
    history.utils = {
      ...history.utils,
      queryWrapper: (getQuery: () => SearchParams) =>
        createMemoWithoutProxy(
          getQuery as () => Record<string, unknown>,
          queryParams,
        ) as SearchParams,
      paramsWrapper: (getParams: () => Params, branches: () => Branch[]) =>
        createMemoWithoutProxy(
          getParams as () => Record<string, unknown>,
          collectDynamicParams(branches()),
        ) as Params,
    };
  }

  return createRouter({ ...rest, history } as RouterConfig<R>);
}

export const SUPPORTS_PROXY = typeof Proxy === 'function';
export function createMemoWithoutProxy<
  T extends Record<string | symbol, unknown>,
>(fn: () => T, allKeys?: string[]): T {
  const map = new Map();
  const owner = getOwner()!;
  const target = {} as T;

  const handler = (property: keyof T) => {
    if (!map.has(property)) {
      runWithOwner(owner, () =>
        map.set(
          property,
          createMemo(() => fn()[property]),
        ),
      );
    }
    return map.get(property)!();
  };

  const keys = allKeys ? allKeys : (Object.keys(fn()) as (keyof T)[]);

  keys.forEach((key) => {
    Object.defineProperty(target, key, {
      get: () => handler(key),
      enumerable: true,
      configurable: true,
    });
  });

  return target;
}

// Structurally the router's own `Branch`, which it does not re-export.
export interface Branch {
  routes: RouteDescription[];
  score: number;
  matcher: (location: string) => RouteMatch[] | null;
}

export const collectDynamicParams = (branches: Branch[]) => {
  const dynamicParams: string[] = [];

  branches.forEach((branch) => {
    branch.routes.forEach((route) => {
      if (route.pattern) {
        const matches = route.pattern.match(/:(\w+)/g);
        if (matches) {
          matches.forEach((param) => {
            const p = param.slice(1); // Remove the `:`
            if (!dynamicParams.includes(p)) dynamicParams.push(p);
          });
        }
      }
    });
  });

  return dynamicParams;
};
