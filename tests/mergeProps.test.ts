import * as v from 'vitest';

// Reactive spreads (`<Comp {...fn()} />`) reach mergeProps as a function. On
// engines without Proxy (Chrome 38 / webOS 3) solid-js's fallback enumerates
// that function instead of the object it returns, dropping every spread prop.
// The wrapper resolves function sources first. See src/mergeProps.ts.
v.describe('mergeProps (Proxy-free safe)', () => {
  v.afterEach(() => {
    v.vi.unstubAllGlobals();
    v.vi.resetModules();
  });

  v.test(
    'delegates to solid-js mergeProps when Proxy is available',
    async () => {
      const { mergeProps, SUPPORTS_PROXY } =
        await import('../src/mergeProps.js');
      v.expect(SUPPORTS_PROXY).toBe(true);
      const merged = mergeProps({ a: 1 }, { b: 2 }) as Record<string, unknown>;
      v.expect(merged.a).toBe(1);
      v.expect(merged.b).toBe(2);
    },
  );

  v.test(
    'preserves function-source (reactive spread) props without Proxy',
    async () => {
      v.vi.stubGlobal('Proxy', undefined);
      v.vi.resetModules();
      const { mergeProps, SUPPORTS_PROXY } =
        await import('../src/mergeProps.js');
      v.expect(SUPPORTS_PROXY).toBe(false);

      const spread = () => ({
        upCount: 4,
        get buffer() {
          return 5;
        },
      });
      const merged = mergeProps(spread, { scroll: 'always' }) as Record<
        string,
        unknown
      >;

      v.expect(merged.scroll).toBe('always'); // direct prop survives
      v.expect(merged.upCount).toBe(4); // spread prop (was dropped before)
      v.expect(merged.buffer).toBe(5); // spread getter preserved
    },
  );
});
