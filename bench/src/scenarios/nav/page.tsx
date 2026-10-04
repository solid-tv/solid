// Scenarios: node creation for a whole page, the shape of a route
// change. A Browse-like page: a Column of 7 titled Rows x 20 Poster tiles.
// Each tile is poster.tsx's (an image, a title, `$focus`, a border and
// `forwardStates`) with a subtitle and a badge added, four nodes in all, so a
// page is about 600 nodes (582: the tiles' 560, the 7 Rows, their wrappers and
// titles, and the Column).
//
// Rows are 400px tall from y=40: rows 0-2 are on screen, rows 3-6 start below
// the bottom of the 1080px screen. Posters are 205px apart from x=160: about
// the first 10 of a Row are in bounds. Most of a page is therefore out of
// bounds, as most of a route's tree is (a swap lays out 63 of its 287 texts),
// and text under an out-of-bounds parent is where renderers differ.
import type { ElementNode, NodeStyles, TextStyles } from '@solidtv/solid';
import { Column, Row } from '@solidtv/solid/primitives';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { posterStyle, posterTitle } from './poster.js';
import { focusPath, posterImages, theme, type NavScenario } from './shared.js';

const ROWS = 7;
const TILES = 20;

interface Tile {
  src: string;
  title: string;
  meta: string;
}
interface PageRow {
  title: string;
  tiles: Tile[];
}

/** A page's data: `name` and `year` make every string differ between pages. */
function makePage(name: string, year: number): PageRow[] {
  return Array.from({ length: ROWS }, (_, r) => ({
    title: `${name} row ${r}`,
    tiles: Array.from({ length: TILES }, (_, t) => ({
      src: posterImages[(r + t) % posterImages.length]!,
      title: `${name} poster ${r}-${t}`,
      meta: `${year + ((r * TILES + t) % 25)} | ${(
        6 +
        ((r * 7 + t * 3) % 40) / 10
      ).toFixed(1)}`,
    })),
  }));
}

const pageA = makePage('Alpha', 2000);
const pageB = makePage('Bravo', 2010);

const rowTitle = {
  fontSize: 28,
  lineHeight: 28,
  height: 28,
  color: theme.textPrimary,
} satisfies TextStyles;

const tileMeta = {
  fontSize: 16,
  lineHeight: 16,
  height: 16,
  x: 10,
  y: 316,
  contain: 'width',
  width: 185,
  color: theme.textPrimary,
} satisfies TextStyles;

const tileBadge = {
  x: 10,
  y: 10,
  width: 44,
  height: 24,
  color: '#000000cc',
} satisfies NodeStyles;

function PageTile(props: { tile: Tile }) {
  return (
    <view
      src={props.tile.src}
      item={props.tile}
      style={posterStyle}
      forwardStates
    >
      <text style={posterTitle}>{props.tile.title}</text>
      <text style={tileMeta}>{props.tile.meta}</text>
      <view style={tileBadge} />
    </view>
  );
}

let column: ElementNode | undefined;

function Page(props: { rows: PageRow[] }) {
  let self: ElementNode | undefined;
  onCleanup(() => {
    if (column === self) {
      column = undefined;
    }
  });
  return (
    <Column
      ref={(el: ElementNode) => (column = self = el)}
      autofocus
      x={160}
      y={40}
      width={1760}
    >
      <For each={props.rows}>
        {(row) => (
          <view height={400} forwardFocus={1}>
            <text skipFocus style={rowTitle}>
              {row.title}
            </text>
            <Row y={50} height={278} gap={20}>
              <For each={row.tiles}>{(tile) => <PageTile tile={tile} />}</For>
            </Row>
          </view>
        )}
      </For>
    </Column>
  );
}

/** Nodes under and including `node`; a `<text>`'s string child is not a node. */
function count(node: ElementNode): number {
  let n = 1;
  for (const child of node.children as ElementNode[]) {
    if ((child as { _type?: string })._type !== 'text') {
      n += count(child);
    }
  }
  return n;
}

function probe() {
  const rows = (column?.children ?? []) as ElementNode[];
  return {
    mounted: column !== undefined,
    rows: rows.length,
    nodes: column === undefined ? 0 : count(column),
    firstTitle: (rows[0]?.children[0] as ElementNode | undefined)?.text,
    focus: focusPath(),
  };
}

// Even ops unmount the page, odd ops mount it again (new nodes, the same
// data). Split the samples by op kind to get destroy vs create. It starts
// mounted, so a cycle of 2 ops returns to the start state.
const [mounted, setMounted] = createSignal(true);
const pageMount: NavScenario = {
  id: 'page-mount',
  title:
    'Browse-like page (Column of 7 Rows x 20 Poster tiles, about 600 nodes): even ops unmount it, odd ops mount it',
  text: true,
  App: () => (
    <Show when={mounted()}>
      <Page rows={pageA} />
    </Show>
  ),
  step: (i) => {
    setMounted(i % 2 !== 0);
    return null;
  },
  opKind: (i) => (i % 2 === 0 ? 'destroy' : 'create'),
  warmup: 10,
  measured: 20,
  cycle: 2,
  probe,
};

// One op replaces the page with a second page of the same shape and different
// strings, as a route change does: the old page's nodes are destroyed and the
// new page's created. Ops alternate between the two pages; it starts on A.
const [second, setSecond] = createSignal(false);
const pageSwap: NavScenario = {
  id: 'page-swap',
  title:
    'Browse-like page (Column of 7 Rows x 20 Poster tiles, about 600 nodes): each op replaces it with a page of the same shape and new strings',
  text: true,
  App: () => (
    <Show when={!second()} fallback={<Page rows={pageB} />}>
      <Page rows={pageA} />
    </Show>
  ),
  step: (i) => {
    setSecond(i % 2 === 0);
    return null;
  },
  warmup: 10,
  measured: 20,
  cycle: 2,
  probe,
};

export const pageScenarios: NavScenario[] = [pageMount, pageSwap];
