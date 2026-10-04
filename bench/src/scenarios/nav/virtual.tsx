// Scenario: a VirtualRow and a VirtualGrid, where presses move the window.
import type { ElementNode, NodeStyles } from '@solidtv/solid';
import { VirtualGrid, VirtualRow } from '@solidtv/solid/primitives';
import {
  backAndForth,
  focusPath,
  makeItems,
  placeholderColor,
  pos,
  thumbnail,
  type Item,
  type NavScenario,
} from './shared.js';

// solid-demo-app components/index.tsx posterStyles (the TitleRow's Poster).
const poster = {
  width: 185,
  height: 278,
  scale: 1,
  color: '#b0b0b0ff',
  placeholderColor,
  borderRadius: 8,
  transition: {
    scale: { duration: 200, easing: 'linear' },
  },
  $focus: { scale: 1.1, color: '#ffffffff' },
} satisfies NodeStyles;

function Poster(props: { item: Item }) {
  return <view src={props.item.src} item={props.item} style={poster} />;
}

const rowItems = makeItems(60, 'Row item');

let virtualRow: ElementNode | undefined;

function itemTitles(list: ElementNode | undefined): string {
  const children = (list?.children ?? []) as (ElementNode & { item?: Item })[];
  return children.map((c) => c.item?.title.split(' ').pop()).join(',');
}

// Modelled on the TMDB page's TitleRow: VirtualRow gap 20, displaySize 8,
// bufferSize 3. With scroll=auto the window moves on every press after the first.
const virtualRowScenario: NavScenario = {
  id: 'virtual-row',
  title:
    'VirtualRow of 60 Poster tiles (displaySize 8, bufferSize 3, scroll=auto): Right x10 then Left x10, the window moves',
  App: () => (
    <view x={160} y={300}>
      <VirtualRow
        ref={virtualRow}
        autofocus
        gap={20}
        displaySize={8}
        bufferSize={3}
        scroll="auto"
        each={rowItems}
      >
        {(item) => <Poster item={item()} />}
      </VirtualRow>
    </view>
  ),
  step: backAndForth(10, 'ArrowRight', 'ArrowLeft'),
  warmup: 20,
  measured: 60,
  probe: () => ({
    focus: focusPath(),
    row: pos(virtualRow),
    selected: virtualRow?.selected,
    items: itemTitles(virtualRow),
  }),
};

const gridItems = makeItems(140, 'Grid item');

let virtualGrid: ElementNode | undefined;

function Thumbnail(props: { item: Item }) {
  return <view src={props.item.src} item={props.item} style={thumbnail} />;
}

// Modelled on the Browse page: VirtualGrid of Thumbnails, 7 columns x 2 rows,
// buffer 2, gap 50, scroll=always, inside a clipping container.
const virtualGridScenario: NavScenario = {
  id: 'virtual-grid',
  title:
    'VirtualGrid of 140 Thumbnail tiles (7 columns, 2 rows, buffer 2, scroll=always): Down x8 then Up x8, the window moves',
  App: () => (
    <view clipping width={1920} height={1000} y={80}>
      <VirtualGrid
        ref={virtualGrid}
        autofocus
        y={24}
        x={160}
        width={1620}
        columns={7}
        rows={2}
        buffer={2}
        gap={50}
        scroll="always"
        each={gridItems}
      >
        {(item) => <Thumbnail item={item()} />}
      </VirtualGrid>
    </view>
  ),
  step: backAndForth(8, 'ArrowDown', 'ArrowUp'),
  warmup: 32,
  measured: 64,
  probe: () => {
    const children = (virtualGrid?.children ?? []) as ElementNode[];
    return {
      focus: focusPath(),
      grid: pos(virtualGrid),
      selected: virtualGrid?.selected,
      mounted: children.length,
      first: itemTitles(virtualGrid).split(',')[0],
    };
  },
};

export const virtualScenarios: NavScenario[] = [
  virtualRowScenario,
  virtualGridScenario,
];
