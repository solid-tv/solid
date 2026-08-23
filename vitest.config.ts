import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig(({ mode }) => ({
  define: {
    __DEV__: false,
    SOLIDTV_DOM_RENDERING: true,
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
