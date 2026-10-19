import { configDefaults, defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import solid from 'vite-plugin-solid';

export default defineConfig(() => ({
  define: {
    __DEV__: true,
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
      // publicApi reads files through node:fs.
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
