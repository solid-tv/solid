import { Row } from '@solidtv/solid/primitives';
import { For } from 'solid-js';
import type { Scenario } from '../scenario.js';

const tile = {
  width: 200,
  height: 120,
  color: '#334455ff',
  $focus: { color: '#ffffffff' },
} as const;

/** A tiny row to prove the build and runner end to end. Not a reported scenario. */
const smoke: Scenario = {
  id: 'smoke',
  title: 'Smoke: one Row of 10 tiles, Right x9 then Left x9',
  App: () => (
    <Row autofocus x={40} y={40} gap={20} width={1840} height={120}>
      <For each={Array.from({ length: 10 }, (_, i) => i)}>
        {(i) => (
          <view style={tile}>
            <text x={10} y={10} fontSize={24}>
              Tile {i}
            </text>
          </view>
        )}
      </For>
    </Row>
  ),
  step: (i) => (i % 18 < 9 ? 'ArrowRight' : 'ArrowLeft'),
  warmup: 18,
  measured: 36,
};

export default smoke;
