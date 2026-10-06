// Scenario: a `$focus` with `scale`, a `border` object, `borderRadius`
// and a scale transition, modelled on solid-demo-app's styles.Thumbnail.
import type { ElementNode } from '@solidtv/solid';
import { Row } from '@solidtv/solid/primitives';
import { For } from 'solid-js';
import {
  backAndForth,
  focusPath,
  makeItems,
  pos,
  thumbnail,
  type NavScenario,
} from './shared.js';

// One row of the Browse page's VirtualGrid: 7 columns, gap 50, at x 160.
const items = makeItems(7);

let row: ElementNode | undefined;

const thumbnailFocus: NavScenario = {
  id: 'thumbnail-focus',
  title:
    'Row of 7 Thumbnail tiles (image, $focus scale 1.1 + border, borderRadius 16, 250ms scale transition), scroll=none: Right x6 then Left x6',
  App: () => (
    <Row ref={row} autofocus x={160} y={400} gap={50} scroll="none">
      <For each={items}>
        {(item) => <view src={item.src} style={thumbnail} />}
      </For>
    </Row>
  ),
  step: backAndForth(6, 'ArrowRight', 'ArrowLeft'),
  warmup: 24,
  measured: 72,
  probe: () => ({
    focus: focusPath(),
    row: pos(row),
    scale: ((row?.children ?? []) as ElementNode[]).map(
      (c) => Math.round((c.lng.scale ?? 1) * 100) / 100,
    ),
  }),
};

export default thumbnailFocus;
