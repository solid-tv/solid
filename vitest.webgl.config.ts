// Real-renderer tests: Vitest browser mode in headless Chromium, drawing
// through @solidtv/renderer (WebGL, SDF text), not the DOM renderer.
//
//   pnpm test:webgl   (vitest run --config=vitest.webgl.config.ts)
//
// Needs Playwright's Chromium: `npx playwright install chromium`.
// The default `vitest run` (vitest.config.ts, jsdom) excludes tests/webgl.
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import solid from 'vite-plugin-solid';

export default defineConfig({
  define: {
    // Solid: build without the DOM renderer, as a WebGL app does.
    SOLIDTV_DOM_RENDERING: false,
    // Renderer build flags (src/common/flags.ts): production build, no
    // inspector, no bounds events, as the bench and the demo app build it.
    __DEV__: false,
    __enableInspector__: false,
    __emitBoundsEvents__: false,
    __enableCompressedTextures__: false,
  },
  plugins: [
    solid({
      hot: false,
      solid: {
        moduleName: '@solidtv/solid',
        generate: 'universal',
        builtIns: [],
      },
    }),
  ],
  test: {
    include: ['tests/webgl/**/*.test.tsx'],
    watch: false,
    browser: {
      enabled: true,
      headless: true,
      // A failure's screenshot of the canvas says nothing the assertion
      // does not, and would litter the tree with __screenshots__.
      screenshotFailures: false,
      // https://vitest.dev/guide/browser/playwright
      provider: playwright({
        launchOptions: {
          // Headless Chromium has no GPU: run WebGL on SwiftShader.
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
  resolve: {
    conditions: ['@solidtv/source', 'browser', 'development'],
    dedupe: ['solid-js', 'solid-js/universal', 'solid-js/store'],
  },
});
