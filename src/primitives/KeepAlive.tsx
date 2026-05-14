import { Route, RoutePreloadFuncArgs, RouteProps } from '@solidjs/router';
import * as s from 'solid-js';
import { ElementNode, activeElement } from '@solidtv/solid';
import { chainFunctions } from './utils/chainFunctions.js';

export interface KeepAliveElement {
  id: string;
  owner: s.Owner | null;
  children: s.JSX.Element;
  routeSignal?: s.Signal<unknown>;
  isAlive?: s.Accessor<boolean>;
  setIsAlive?: (v: boolean) => void;
  dispose: () => void;
}

const keepAliveElements = new Map<string, KeepAliveElement>();
export const keepAliveRouteElements = new Map<string, KeepAliveElement>();

const _storeKeepAlive = (
  map: Map<string, KeepAliveElement>,
  element: KeepAliveElement,
): KeepAliveElement | undefined => {
  const existing = map.get(element.id);
  if (existing) {
    Object.assign(existing, element);
    return existing;
  }
  map.set(element.id, element);
  return element;
};

export const storeKeepAlive = (element: KeepAliveElement) =>
  _storeKeepAlive(keepAliveElements, element);
export const storeKeepAliveRoute = (element: KeepAliveElement) =>
  _storeKeepAlive(keepAliveRouteElements, element);

const _removeKeepAlive = (
  map: Map<string, KeepAliveElement>,
  id: string,
): void => {
  const element = map.get(id);
  if (element) {
    (element.children as unknown as ElementNode)?.destroy();
    element.dispose?.();
    map.delete(id);
  }
};

export const removeKeepAlive = (id: string): void =>
  _removeKeepAlive(keepAliveElements, id);
export const removeKeepAliveRoute = (id: string): void =>
  _removeKeepAlive(keepAliveRouteElements, id);

const _clearKeepAlive = (map: Map<string, KeepAliveElement>): void => {
  map.forEach((element) => {
    (element.children as unknown as ElementNode)?.destroy();
    element.dispose?.();
  });
  map.clear();
};

export const clearKeepAlive = (): void => _clearKeepAlive(keepAliveElements);
export const clearKeepAliveRoute = (): void =>
  _clearKeepAlive(keepAliveRouteElements);

interface KeepAliveProps {
  id: string;
  shouldDispose?: (key: string) => boolean;
  onRemove?: ElementNode['onRemove'];
  onRender?: ElementNode['onRender'];
  transition?: ElementNode['transition'];
}

function wrapChildren(
  props: s.ParentProps<KeepAliveProps>,
  setIsAlive?: (v: boolean) => void,
) {
  const onRemove = chainFunctions(
    props.onRemove ||
      ((elm: ElementNode) => {
        elm.alpha = 0;
      }),
    () => setIsAlive?.(false),
  );
  const onRender = chainFunctions(
    props.onRender ||
      ((elm: ElementNode) => {
        elm.alpha = 1;
      }),
    () => setIsAlive?.(true),
  );
  const transition = props.transition || { alpha: true };

  return (
    <view
      {...props}
      preserve
      onRemove={onRemove}
      onRender={onRender}
      forwardFocus={0}
      transition={transition}
    />
  );
}

const createKeepAliveComponent = (
  map: Map<string, KeepAliveElement>,
  storeFn: (element: KeepAliveElement) => KeepAliveElement | undefined,
) => {
  return (props: s.ParentProps<KeepAliveProps>) => {
    let existing = map.get(props.id);

    if (
      existing &&
      (props.shouldDispose?.(props.id) ||
        (existing.children as unknown as ElementNode)?.destroyed)
    ) {
      (existing.children as unknown as ElementNode).destroy();
      existing.dispose?.();
      map.delete(props.id);
      existing = undefined;
    }

    if (!existing || !existing.dispose) {
      return s.createRoot((dispose) => {
        const [isAlive, setIsAlive] =
          existing?.isAlive && existing?.setIsAlive
            ? [existing.isAlive, existing.setIsAlive]
            : s.createSignal(true);
        const children = wrapChildren(props, setIsAlive);
        storeFn({
          id: props.id,
          owner: s.getOwner(),
          children,
          dispose,
          isAlive,
          setIsAlive,
        });
        return children;
      });
    } else if (existing && !existing.children) {
      existing.children = s.runWithOwner(existing.owner, () =>
        wrapChildren(props, existing.setIsAlive),
      );
    }
    return existing.children;
  };
};

export const KeepAlive = createKeepAliveComponent(
  keepAliveElements,
  storeKeepAlive,
);
const KeepAliveRouteInternal = createKeepAliveComponent(
  keepAliveRouteElements,
  storeKeepAliveRoute,
);

// Cache the resolved <Route> JSX per key. Solid Router uses the routeDef
// object itself as the route key (see @solidjs/router index.js:455), so if
// KeepAliveRoute ever gets re-evaluated, a new routeDef would drift the key
// and force routeStates to dispose + recreate sibling contexts (which would
// re-invoke their components). Returning the same JSX reference keeps the
// route key stable across re-evaluations.
//
// Note: this captures `props` at first invocation. If you rely on dynamic
// changes to KeepAliveRoute props (e.g., a reactive `transition` or `preload`
// reference), use a stable wrapper around them or clear this cache when
// they change.
const keepAliveRouteCache = new Map<string, s.JSX.Element>();

export const clearKeepAliveRouteCache = (): void => {
  keepAliveRouteCache.clear();
};

export const KeepAliveRoute = <S extends string>(
  props: RouteProps<S> & {
    id?: string;
    path: string;
    component: (
      props: RouteProps<S> & { isAlive: s.Accessor<boolean> },
    ) => s.JSX.Element;
    shouldDispose?: (key: string) => boolean;
    onRemove?: ElementNode['onRemove'];
    onRender?: ElementNode['onRender'];
    transition?: ElementNode['transition'];
    preload?: (
      args: RoutePreloadFuncArgs & { isAlive: s.Accessor<boolean> },
    ) => void;
  },
) => {
  const key = props.id || props.path;

  const cached = keepAliveRouteCache.get(key);
  if (cached) {
    return cached;
  }

  let savedFocusedElement: ElementNode | undefined;

  const getExisting = () => {
    let existing = keepAliveRouteElements.get(key);
    if (!existing) {
      const [isAlive, setIsAlive] = s.createSignal(true);
      existing = {
        id: key,
        isAlive,
        setIsAlive,
      } as any;
      keepAliveRouteElements.set(key, existing!);
    }
    return existing!;
  };

  const onRemove = chainFunctions(props.onRemove, (elm: ElementNode) => {
    savedFocusedElement = activeElement() as ElementNode;
    elm.alpha = 0;
  });

  const onRender = chainFunctions(props.onRender, (elm: ElementNode) => {
    let isChild = false;
    let current = savedFocusedElement;
    while (current) {
      if (current === elm) {
        isChild = true;
        break;
      }
      current = current.parent;
    }

    if (isChild && savedFocusedElement) {
      savedFocusedElement.setFocus();
    } else {
      elm.setFocus();
    }
    elm.alpha = 1;
  });

  const preload = props.preload
    ? (preloadProps: RoutePreloadFuncArgs) => {
        let existing = getExisting();

        if (
          existing.children &&
          (props.shouldDispose?.(key) ||
            (existing.children as unknown as ElementNode)?.destroyed)
        ) {
          (existing.children as unknown as ElementNode).destroy();
          existing.dispose?.();
          keepAliveRouteElements.delete(key);
          existing = getExisting();
        }

        if (!existing.dispose) {
          return s.createRoot((dispose) => {
            existing.owner = s.getOwner();
            existing.dispose = dispose;
            return props.preload!({ ...preloadProps, isAlive: existing.isAlive! });
          });
        } else if (existing.children) {
          (existing.children as unknown as ElementNode)?.setFocus();
          return props.preload!({ ...preloadProps, isAlive: existing.isAlive! });
        } else {
          return props.preload!({
            ...preloadProps,
            isAlive: existing.isAlive!,
          });
        }
      }
    : undefined;

  const componentWrapper = (childProps: RouteProps<S>) => {
    const existing = getExisting();
    // Do NOT spread `childProps`: it has a `children` getter (the router's
    // outlet) that would be invoked eagerly, creating a <Show> subscribed to
    // the next routeStates index. That stale Show would then fire when the
    // user navigates to a sibling route whose matches populate that index,
    // causing the sibling's component to be created from the preserved
    // KeepAlive subtree. Inherit via prototype so the getter is preserved.
    const innerProps = Object.create(childProps, {
      isAlive: { value: existing.isAlive!, enumerable: true, configurable: true },
    }) as RouteProps<S> & { isAlive: s.Accessor<boolean> };
    return (
      <KeepAliveRouteInternal
        id={key}
        onRemove={onRemove}
        onRender={onRender}
        transition={props.transition}
      >
        {props.component(innerProps)}
      </KeepAliveRouteInternal>
    );
  };

  const routeElement = (
    <Route
      {...props}
      preload={preload}
      component={componentWrapper}
    />
  );

  keepAliveRouteCache.set(key, routeElement);
  return routeElement;
};
