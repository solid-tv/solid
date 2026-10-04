// Micro-benchmarks on the real renderer: the browser setup of
// vitest.webgl.config.ts (headless Chromium, renderer v2, WebGL), with
// bench/micro as the only test directory. `npx vitest run` excludes bench/
// and `pnpm test:webgl` only includes tests/webgl, so neither runs these.
//
//   npx vitest run --config=bench/micro/vitest.config.ts
import { fileURLToPath } from 'node:url';
import webgl from '../../vitest.webgl.config';

export default {
  ...webgl,
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    ...webgl.test,
    include: ['bench/micro/**/*.test.tsx'],
  },
};
