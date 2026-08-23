import * as v from 'vitest';
import {
  createHashRouter,
  hashParser,
  SUPPORTS_PROXY,
  createMemoWithoutProxy,
  collectDynamicParams,
} from '../src/primitives/router.ts';

// Exercises the real @solidjs/router (no stub), which is the point of
// un-gating this entry point.
v.describe('router', () => {
  v.test('createHashRouter builds a usable router instance', () => {
    const Router = createHashRouter({
      routes: [
        { path: '/', component: () => null },
        { path: '/show/:id', component: () => null },
      ],
    });

    v.assert.equal(typeof Router, 'function', 'instance is a component');
    v.assert.equal(typeof Router.match, 'function', 'exposes match()');
    v.assert.equal(Router.routes.length, 2);

    const matched = Router.match('/show/42');
    v.assert.ok(matched.length > 0, 'matches a dynamic route');
  });

  v.test('hashParser resolves in-page anchors against the current hash', () => {
    v.assert.equal(hashParser('/#/browse'), '/browse');
    v.assert.equal(hashParser('http://x/#/browse'), '/browse');
  });

  v.test('collectDynamicParams pulls :params out of route patterns', () => {
    const branches = [
      {
        routes: [
          { pattern: '/show/:id' },
          { pattern: '/show/:id/season/:season' },
        ],
        score: 0,
        matcher: () => null,
      },
    ] as unknown as Parameters<typeof collectDynamicParams>[0];

    v.assert.deepEqual(collectDynamicParams(branches), ['id', 'season']);
  });

  // The Chrome 38 path: without Proxy the router's params/query objects are
  // built from an explicit key list instead of a trapping proxy.
  v.test('createMemoWithoutProxy exposes keys as reactive getters', async () => {
    const s = await import('solid-js');
    s.createRoot(() => {
      // ownedWrite: this test writes from inside createRoot, which Solid 2.0
      // otherwise rejects.
      const [id, setId] = s.createSignal('1', { ownedWrite: true });
      const params = createMemoWithoutProxy(() => ({ id: id() }), ['id']);

      v.assert.equal(params.id, '1');
      v.assert.deepEqual(Object.keys(params), ['id']);

      setId('2');
      s.flush();
      v.assert.equal(params.id, '2', 'getter stays reactive');
    });
  });

  v.test('SUPPORTS_PROXY reflects the engine', () => {
    v.assert.equal(SUPPORTS_PROXY, typeof Proxy === 'function');
  });
});
