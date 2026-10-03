// Benchmark entry: ?scenario=<id> mounts one scenario. The runner drives it
// through window.__bench.
import { Config, createRenderer, loadFonts } from '@solidtv/solid';
import { useFocusManager } from '@solidtv/solid/primitives';
import { registerShaders, rendererOptions } from 'bench-arm-init';
import { scenarios } from './scenarios/index.js';

declare const __BENCH_ARM__: string;

const params = new URLSearchParams(location.search);
const id = params.get('scenario') ?? 'smoke';
const scenario = scenarios.find((s) => s.id === id);
if (scenario === undefined) {
  throw new Error(`unknown scenario ${id}`);
}

Config.animationsEnabled = params.get('animations') !== 'false';
Config.fontSettings.fontFamily = 'Roboto';
Config.fontSettings.fontSize = 32;
Config.fontSettings.color = '#f6f6f6ff';

Config.rendererOptions = rendererOptions({
  appWidth: 1920,
  appHeight: 1080,
  deviceLogicalPixelRatio: 1,
  fpsUpdateInterval: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const fontsLoaded = loadFonts([
  {
    type: 'msdf',
    fontFamily: 'Roboto',
    atlasDataUrl: './fonts/Roboto-Regular.msdf.json',
    atlasUrl: './fonts/Roboto-Regular.msdf.png',
    metrics: { ascender: 1000, descender: 100, lineGap: 0, unitsPerEm: 1000 },
  },
  {
    type: 'msdf',
    fontFamily: 'Roboto700',
    atlasDataUrl: './fonts/Roboto-Bold.msdf.json',
    atlasUrl: './fonts/Roboto-Bold.msdf.png',
    metrics: { ascender: 1000, descender: 100, lineGap: 0, unitsPerEm: 1000 },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any);

const { renderer, render } = createRenderer(undefined, 'app');
registerShaders(renderer);

const App = scenario.App;
render(() => {
  useFocusManager();
  return <App />;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__bench = {
  arm: __BENCH_ARM__,
  scenario,
  renderer,
  fontsLoaded,
  Config,
};
