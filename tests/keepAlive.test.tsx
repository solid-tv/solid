import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';

v.vi.mock('@solidjs/router', () => ({
  Route: (props: any) => props,
}));

import { renderer } from './setup.js';

v.describe('KeepAlive memory & pointer management', () => {
  let KeepAliveModule: typeof import('../src/primitives/KeepAlive.js');

  v.beforeAll(async () => {
    KeepAliveModule = await import('../src/primitives/KeepAlive.js');
  });

  v.afterEach(() => {
    KeepAliveModule.clearKeepAlive();
    KeepAliveModule.clearKeepAliveRoute();
  });

  v.test('clearKeepAliveRoute clears savedFocusedElement and all pointers on KeepAliveElement', () => {
    const dummyNode = new lng.ElementNode(renderer.stage);
    const mockDispose = v.vi.fn();
    const mockElement: import('../src/primitives/KeepAlive.js').KeepAliveElement = {
      id: 'test-route',
      children: dummyNode as any,
      owner: s.getOwner(),
      savedFocusedElement: dummyNode,
      dispose: mockDispose,
      isAlive: (() => true) as any,
      setIsAlive: v.vi.fn(),
    };

    KeepAliveModule.storeKeepAliveRoute(mockElement);
    v.expect(KeepAliveModule.keepAliveRouteElements.get('test-route')?.savedFocusedElement).toBe(dummyNode);

    KeepAliveModule.clearKeepAliveRoute();

    v.expect(KeepAliveModule.keepAliveRouteElements.size).toBe(0);
    v.expect(mockDispose).toHaveBeenCalled();
    v.expect(mockElement.savedFocusedElement).toBeUndefined();
    v.expect(mockElement.children).toBeUndefined();
    v.expect(mockElement.owner).toBeUndefined();
    v.expect(mockElement.dispose).toBeUndefined();
    v.expect(mockElement.isAlive).toBeUndefined();
    v.expect(mockElement.setIsAlive).toBeUndefined();
  });

  v.test('removeKeepAliveRoute clears savedFocusedElement and all pointers for a specific route', () => {
    const dummyNode1 = new lng.ElementNode(renderer.stage);
    const dummyNode2 = new lng.ElementNode(renderer.stage);

    const elem1: import('../src/primitives/KeepAlive.js').KeepAliveElement = {
      id: 'route-1',
      children: dummyNode1 as any,
      savedFocusedElement: dummyNode1,
      dispose: v.vi.fn(),
    };
    const elem2: import('../src/primitives/KeepAlive.js').KeepAliveElement = {
      id: 'route-2',
      children: dummyNode2 as any,
      savedFocusedElement: dummyNode2,
      dispose: v.vi.fn(),
    };

    KeepAliveModule.storeKeepAliveRoute(elem1);
    KeepAliveModule.storeKeepAliveRoute(elem2);

    KeepAliveModule.removeKeepAliveRoute('route-1');

    v.expect(KeepAliveModule.keepAliveRouteElements.has('route-1')).toBe(false);
    v.expect(elem1.savedFocusedElement).toBeUndefined();
    v.expect(elem1.children).toBeUndefined();
    v.expect(elem1.dispose).toBeUndefined();

    v.expect(KeepAliveModule.keepAliveRouteElements.has('route-2')).true;
    v.expect(elem2.savedFocusedElement).toBe(dummyNode2);
  });
});
