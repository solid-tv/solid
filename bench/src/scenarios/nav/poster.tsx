// Brief scenario: node creation for a Poster tile: an image, text, `$focus`
// and a border. Modelled on solid-demo-app's PosterTitle (image + title with
// forwardStates) with styles.Thumbnail's border and focus.
import type { ElementNode, NodeStyles, TextStyles } from '@solidtv/solid';
import { Row } from '@solidtv/solid/primitives';
import { createSignal, For } from 'solid-js';
import {
  placeholderColor,
  theme,
  type Item,
  type NavScenario,
} from './shared.js';

const posterStyle = {
  width: 185,
  height: 278,
  scale: 1,
  placeholderColor,
  borderRadius: 8,
  border: { width: 0, color: '#00000000' },
  transition: {
    scale: { duration: 200, easing: 'linear' },
  },
  $focus: {
    scale: 1.1,
    border: { color: theme.primaryLight, width: 6, gap: 4, align: 'outside' },
  },
} satisfies NodeStyles;

// components/index.tsx posterTitleStyles, in Roboto.
const posterTitle = {
  fontSize: 22,
  lineHeight: 22,
  height: 22,
  x: 10,
  y: 288,
  contain: 'width',
  width: 185,
  maxLines: 2,
  alpha: 1,
} satisfies TextStyles;

function Poster(props: { item: Item }) {
  return (
    <view
      src={props.item.src}
      item={props.item}
      style={posterStyle}
      forwardStates
    >
      <text style={posterTitle}>{props.item.title}</text>
    </view>
  );
}

/** A batch of 10 posters; each call returns new objects, so `For` recreates them. */
function batch(name: string): Item[] {
  return Array.from({ length: 10 }, (_, i) => ({
    src: `./images/poster-${i}.png`,
    title: `${name} poster ${i}`,
  }));
}

const batchA = batch('Alpha');
const batchB = batch('Bravo');
const empty: Item[] = [];

let row: ElementNode | undefined;

function posterScenario(
  id: string,
  title: string,
  initial: Item[],
  next: (i: number) => Item[],
): NavScenario {
  const [items, setItems] = createSignal(initial);
  return {
    id,
    title,
    App: () => (
      <Row ref={row} x={160} y={300} gap={20}>
        <For each={items()}>{(item) => <Poster item={item} />}</For>
      </Row>
    ),
    step: (i) => {
      setItems(next(i));
      return null;
    },
    warmup: 30,
    measured: 60,
    probe: () => {
      const posters = (row?.children ?? []) as ElementNode[];
      return {
        mounted: posters.length,
        titles: posters.map(
          (p) => (p.children[0] as ElementNode | undefined)?.text,
        ),
        rowWidth: row?.width,
      };
    },
  };
}

export const posterScenarios: NavScenario[] = [
  // One op = unmount 10 posters and mount 10 new ones (alternating between two
  // batches of distinct item objects), as a list window replaces its contents.
  posterScenario(
    'poster-swap',
    'Row of 10 Poster tiles (image, text, $focus, border): each op unmounts the 10 and mounts 10 new ones',
    batchA,
    (i) => (i % 2 === 0 ? batchB : batchA),
  ),
  // Ops alternate: even ops unmount the 10 posters, odd ops mount them again
  // (new nodes for the same items). Split the samples by op parity to get
  // destroy (even) vs create (odd). It starts mounted because an emptied Row
  // keeps its flex width, so a cycle from mounted returns to the start state.
  posterScenario(
    'poster-mount',
    'Row of 10 Poster tiles (image, text, $focus, border): even ops unmount the 10, odd ops mount them',
    batchA,
    (i) => (i % 2 === 0 ? empty : batchA),
  ),
];
