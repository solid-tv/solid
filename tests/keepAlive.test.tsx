import * as v from 'vitest';
import * as lng from '@solidtv/solid';

// @solidjs/router is aliased to tests/stubs/solidjs-router.ts, whose <Route>
// hands its props straight back — which is all this test needs.
import {
  KeepAliveRoute,
  keepAliveRouteElements,
  removeKeepAliveRoute,
  clearKeepAliveRoute,
  clearKeepAliveRouteCache,
} from '../src/primitives/KeepAlive.jsx';
import { renderer } from './setup.js';

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// Renders the route's component wrapper and returns the KeepAlive <view>,
// which carries the chained onRemove/onRender we want to exercise.
const renderRoute = (path: string) => {
  const routeProps = KeepAliveRoute({
    path,
    component: () => (
      <view width={100} height={100}>
        <view width={100} height={100} />
      </view>
    ),
  }) as any;

  let outer!: lng.ElementNode;
  const dispose = renderer.render(() => (
    <view ref={outer} width={1920} height={1080}>
      {routeProps.component({})}
    </view>
  ));

  return { keepAliveView: outer.children[0] as lng.ElementNode, dispose };
};

v.describe('KeepAliveRoute saved focus', () => {
  v.afterEach(() => {
    clearKeepAliveRoute();
    clearKeepAliveRouteCache();
  });

  v.test('stores the focused element on the map entry, then releases it on re-entry', async () => {
    const { keepAliveView, dispose } = renderRoute('/stores');
    await wait();

    const focused = keepAliveView.children[0]!.children[0] as lng.ElementNode;
    focused.setFocus();
    await wait();
    v.expect(lng.activeElement()).toBe(focused);

    keepAliveView.onRemove!(keepAliveView);
    v.expect(keepAliveRouteElements.get('/stores')!.savedFocusedElement).toBe(
      focused,
    );

    keepAliveView.onRender!(keepAliveView);
    await wait();
    v.expect(lng.activeElement()).toBe(focused);
    // Pointer dropped once it has been used — nothing left to retain.
    v.expect(
      keepAliveRouteElements.get('/stores')!.savedFocusedElement,
    ).toBeUndefined();

    dispose();
  });

  v.test('dropping the map entry drops the saved element with it', async () => {
    const { keepAliveView, dispose } = renderRoute('/dropped');
    await wait();

    const focused = keepAliveView.children[0]!.children[0] as lng.ElementNode;
    focused.setFocus();
    await wait();

    keepAliveView.onRemove!(keepAliveView);
    v.expect(keepAliveRouteElements.get('/dropped')!.savedFocusedElement).toBe(
      focused,
    );

    // No closure holds the pointer, so removing the entry is enough to make
    // the saved element collectable. Re-entering falls back to the route
    // element instead of refocusing a node from the torn-down subtree.
    removeKeepAliveRoute('/dropped');
    v.expect(keepAliveRouteElements.has('/dropped')).toBe(false);

    keepAliveView.onRender!(keepAliveView);
    await wait();
    v.expect(lng.activeElement()).not.toBe(focused);

    dispose();
  });
});
