import { configDefaults, defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import solid from 'vite-plugin-solid';

export default defineConfig(({ mode }) => ({
  define: {
    __DEV__: true,
    VITE_SOLIDTV_DOM_RENDERING: true,
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
    exclude: [
      ...configDefaults.exclude,
      // vitest.webgl.config.ts runs these; bench/.arms holds copies of tests.
      'tests/webgl/**',
      'bench/**',
      // .claude/** holds nested git worktrees with their own copies of tests.
      '.claude/**',
      // Contract tests that pin the DOM renderer of the jsdom run
      // (vitest.config.ts defines SOLIDTV_DOM_RENDERING; here Solid renders
      // through WebGL, so they fail), and publicApi (node:fs). The other
      // contract files pass here.
      'tests/contract-lazy.test.tsx',
      'tests/contract-nodes.test.tsx',
      'tests/contract-row-column.test.tsx',
      'tests/contract-states.test.tsx',
      'tests/contract-styles.test.tsx',
      'tests/contract-text.test.tsx',
      'tests/publicApi.test.ts',
    ],
    browser: {
      enabled: true,
      provider: playwright(),
      // https://vitest.dev/guide/browser/playwright
      instances: [
        {
          browser: 'chromium',
          headless: false,
        },
      ],
    },
  },
  resolve: {
    conditions: ['@solidtv/source', 'browser', 'development'],
  },
}));
