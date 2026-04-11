import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig(({ mode }) => ({
  define: {
    __DEV__: false,
    LIGHTNING_DOM_RENDERING: true,
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
  },
}));
