// Builds the benchmark app for one arm: BENCH_ARM=A|B|C (default C).
//
// Every arm compiles its Solid from source (the `src/` of the arm's tree) and
// consumes its renderer through the renderer's built `dist`, as apps do. The
// build settings mirror solid-demo-app's modern bundle (chrome>=64, class
// fields lowered to plain assignment, terser with mangling off) so the numbers
// carry over to the demo app and to devices.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Alias } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import hexColorTransform from '@lightningtv/vite-hex-transform';
import { ARMS } from './prepare-arms.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arm = (process.env.BENCH_ARM ?? 'C') as keyof typeof ARMS;
if (!(arm in ARMS)) {
  throw new Error(`BENCH_ARM must be one of ${Object.keys(ARMS).join(', ')}`);
}
const { solid, renderer, rendererMajor } = ARMS[arm];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** `@solidtv/renderer` and each of its subpath exports, from the arm's package.json. */
function rendererAliases(): Alias[] {
  const pkg = JSON.parse(readFileSync(join(renderer, 'package.json'), 'utf8'));
  const aliases: Alias[] = [];
  for (const [subpath, target] of Object.entries(
    pkg.exports as Record<string, string>,
  )) {
    const name = '@solidtv/renderer' + subpath.slice(1);
    aliases.push({
      find: new RegExp(`^${escape(name)}$`),
      replacement: join(renderer, target),
    });
  }
  return aliases;
}

const solidAliases: Alias[] = [
  ['@solidtv/solid/primitives/router', 'src/primitives/routerIndex.ts'],
  ['@solidtv/solid/primitives', 'src/primitives/index.ts'],
  ['@solidtv/solid/devtools', 'src/devtools/index.ts'],
  ['@solidtv/solid', 'src/index.ts'],
].map(([find, target]) => ({
  find: new RegExp(`^${escape(find)}$`),
  replacement: join(solid, target),
}));

export default defineConfig({
  root: here,
  base: './',
  define: {
    __DEV__: false,
    __enableInspector__: false,
    __emitBoundsEvents__: false,
    __enableCompressedTextures__: false,
    __renderTextBatching__: true,
    SOLIDTV_DOM_RENDERING: false,
    __BENCH_ARM__: JSON.stringify(arm),
    __BENCH_RENDERER_MAJOR__: rendererMajor,
  },
  plugins: [
    // '#rrggbbaa' literals become numbers at build time, as in solid-demo-app.
    hexColorTransform({ include: [resolve(here, 'src/**/*.{ts,tsx}')] }),
    solidPlugin({
      hot: false,
      solid: {
        moduleName: '@solidtv/solid',
        generate: 'universal',
        builtIns: [],
      },
    }),
  ],
  resolve: {
    alias: [
      ...solidAliases,
      ...rendererAliases(),
      {
        find: /^bench-arm-init$/,
        replacement: resolve(here, `src/arm-v${rendererMajor}.ts`),
      },
    ],
    conditions: ['@solidtv/source', 'browser'],
    dedupe: ['solid-js', 'solid-js/universal', 'solid-js/store'],
  },
  build: {
    outDir: resolve(here, 'dist', arm),
    emptyOutDir: true,
    target: 'chrome64',
    minify: 'terser',
    sourcemap: false,
    modulePreload: false,
    rolldownOptions: {
      transform: {
        assumptions: {
          setPublicClassFields: true,
          noDocumentAll: true,
        },
      },
    },
    terserOptions: {
      mangle: false,
      format: { comments: false, beautify: true },
    },
  },
});
