// Builds the benchmark app for one arm: BENCH_ARM=A|B|C (default C).
//
// Every arm compiles its Solid from source (the `src/` of the arm's tree) and
// consumes its renderer through the renderer's built `dist`, as apps do. The
// build settings mirror solid-demo-app's modern bundle (chrome>=64, class
// fields lowered to plain assignment, terser with mangling off) so the numbers
// carry over to the demo app and to devices.
//
// The bundle is split into four chunks with fixed names, so that a profiler
// sample or an allocation can be charged to its owner by script URL
// (bench/harness/analyze.mjs):
//   assets/reactivity.js  solid-js
//   assets/framework.js   the arm's @solidtv/solid source and its @solid-primitives
//   assets/renderer.js    the arm's @solidtv/renderer dist
//   assets/user.js        the entry: bench/src (main, arm bootstrap, scenarios)
// BENCH_CHUNKS=0 builds a single chunk instead (into dist/<arm>-nochunks), to
// check that the split does not move the timings.
//
// BENCH_INSTRUMENT=1 builds the count-mode variant into dist/<arm>-count: the
// arm's flex layout function (the default export of src/core/flex.ts and
// flexLayout.ts) is wrapped to count its calls in `window.__benchCount.flex`.
// Every other count is patched in at runtime by bench/harness/probe.mjs.
// Timing, allocation and profile runs never load this build.
//
// Flex: solid-demo-app's .env sets VITE_USE_NEW_FLEX=true, so apps run
// src/core/flexLayout.ts (elementNode.ts picks it when
// `import.meta.env.VITE_USE_NEW_FLEX` is non-empty). Every arm is built the
// same way by default; BENCH_FLEX=old builds src/core/flex.ts instead, into
// dist/<arm>[-count]-flexold.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Alias, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import hexColorTransform from '@lightningtv/vite-hex-transform';
import { ARMS } from './prepare-arms.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arm = (process.env.BENCH_ARM ?? 'C') as keyof typeof ARMS;
if (!(arm in ARMS)) {
  throw new Error(`BENCH_ARM must be one of ${Object.keys(ARMS).join(', ')}`);
}
const { rendererMajor } = ARMS[arm];
// The renderer bootstrap (engines, shader registration) for the arm's
// renderer major: src/arm-v1.ts (arm A) or src/arm-v2.ts (arms B and C).
const armInit = resolve(here, `src/arm-v${rendererMajor}.ts`);
if (!existsSync(armInit)) {
  throw new Error(
    `arm ${arm}: no bench bootstrap for @solidtv/renderer ${rendererMajor}.x (${armInit})`,
  );
}
// The arms' real paths: the bundler's module ids are real paths, and
// `bench/.arms` can be a symlink (a worktree sharing another's arms), so a
// path joined from it would match no id (no chunks, no flex hook).
const solid = realpathSync(ARMS[arm].solid);
const renderer = realpathSync(ARMS[arm].renderer);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const instrument = process.env.BENCH_INSTRUMENT === '1';
const chunks = process.env.BENCH_CHUNKS !== '0';
const flex = process.env.BENCH_FLEX === 'old' ? 'old' : 'new';
const outName =
  arm +
  (instrument ? '-count' : '') +
  (flex === 'old' ? '-flexold' : '') +
  (chunks ? '' : '-nochunks');
const solidSrc = join(solid, 'src') + sep;
const rendererRoot = renderer + sep;

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

/**
 * Count mode only: wraps the default export of the arm's flex layout modules
 * so that each call (one flex pass over one container) counts. It matches
 * `export default function (` in src/core/flex.ts and flexLayout.ts, as in
 * every arm. A module without it is left alone with a warning, as is a
 * build in which neither module was transformed (a path that matches no
 * module id), and the runner reports flex passes as n/a (`flexHooks` stays 0).
 */
function countFlexPasses(): Plugin {
  const files = new Set(
    ['flex.ts', 'flexLayout.ts'].map((f) => join(solid, 'src', 'core', f)),
  );
  const head = /export default function\s*\(/;
  let hooked = 0;
  return {
    name: 'bench-count-flex',
    enforce: 'pre',
    buildEnd() {
      if (hooked === 0) {
        this.warn(
          `flex pass hook not installed: none of ${[...files].join(', ')} was transformed`,
        );
      }
    },
    transform(code, id) {
      const file = id.split('?')[0]!;
      if (!files.has(file)) {
        return null;
      }
      if (!head.test(code)) {
        this.warn(
          `flex pass hook not installed: no default function in ${file}`,
        );
        return null;
      }
      hooked++;
      return (
        code.replace(head, 'function __benchFlexPass(') +
        `
if (typeof window !== 'undefined' && window.__benchCount !== undefined) {
  window.__benchCount.flexHooks++;
}
export default function (node) {
  const count = window.__benchCount;
  if (count !== undefined) count.flex++;
  return __benchFlexPass(node);
}
`
      );
    },
  };
}

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
    __BENCH_INSTRUMENT__: instrument,
    __BENCH_FLEX__: JSON.stringify(flex),
    'import.meta.env.VITE_USE_NEW_FLEX': JSON.stringify(
      flex === 'new' ? 'true' : '',
    ),
  },
  plugins: [
    ...(instrument ? [countFlexPasses()] : []),
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
        replacement: armInit,
      },
    ],
    conditions: ['@solidtv/source', 'browser'],
    dedupe: ['solid-js', 'solid-js/universal', 'solid-js/store'],
  },
  build: {
    outDir: resolve(here, 'dist', outName),
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
      output: {
        // Fixed names: the harness charges samples to chunks by URL.
        entryFileNames: 'assets/user.js',
        chunkFileNames: 'assets/[name].js',
        codeSplitting: chunks
          ? {
              // Otherwise a group takes its modules' dependencies with it:
              // the framework chunk would swallow the renderer.
              includeDependenciesRecursively: false,
              groups: [
                {
                  name: 'reactivity',
                  test: /[\\/]node_modules[\\/]solid-js[\\/]/,
                  priority: 4,
                },
                {
                  name: 'framework',
                  test: (id: string) =>
                    id.startsWith(solidSrc) ||
                    /[\\/]node_modules[\\/]@solid-primitives[\\/]/.test(id),
                  priority: 3,
                },
                {
                  name: 'renderer',
                  test: (id: string) => id.startsWith(rendererRoot),
                  priority: 2,
                },
              ],
            }
          : false,
      },
    },
    terserOptions: {
      mangle: false,
      // BENCH_TERSER_COMPRESS='{"reduce_funcs":false}' tries other compress
      // options against the demo app's defaults.
      compress:
        process.env.BENCH_TERSER_COMPRESS !== undefined
          ? JSON.parse(process.env.BENCH_TERSER_COMPRESS)
          : undefined,
      format: { comments: false, beautify: true },
    },
  },
});
