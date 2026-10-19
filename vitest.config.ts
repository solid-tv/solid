import { configDefaults, defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig(() => ({
  define: {
    __DEV__: false,
  },
  plugins: [
    solidPlugin({
      hot: false,
      solid: {
        moduleName: '@solidtv/solid',
        generate: 'universal',
        builtIns: [],
      },
    }),
  ],
  test: {
    watch: false,
    // Real-renderer tests run in a browser: vitest.webgl.config.ts.
    exclude: [
      ...configDefaults.exclude,
      'tests/webgl/**',
      'bench/**',
      // .claude/** holds nested git worktrees with their own copies of tests.
      '.claude/**',
    ],
    isolate: false,
    passWithNoTests: true,
    environment: 'jsdom',
  },
  resolve: {
    conditions: ['@solidtv/source', 'browser', 'development'],
    alias: [
      // @solidjs/router ships its factory as untranspiled .jsx under the
      // `solid` condition, so vite-plugin-solid compiles it with our
      // moduleName. That is semantically fine — the router's JSX is all
      // component tags, which compile to renderer-agnostic createComponent
      // calls — but under pnpm's strict layout the router cannot resolve
      // `@solidtv/solid` from inside node_modules. Point it at the source.
      {
        find: /^@solidtv\/solid$/,
        replacement: new URL('./src/index.ts', import.meta.url).pathname,
      },
    ],
  },
}));
