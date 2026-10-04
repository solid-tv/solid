// Shared pieces of the key-press, state-change and node-creation scenarios.
// Styles are modelled on solid-demo-app's styles.ts and theme.ts.
import {
  activeElement,
  type ElementNode,
  type NodeStyles,
} from '@solidtv/solid';
import type { Scenario } from '../../scenario.js';

/**
 * A scenario plus `probe`, a debugging aid outside the Scenario contract: it
 * returns a JSON snapshot of the scene's state (which element has focus, list
 * offsets, mounted counts) so a check can confirm that the workload does what
 * it says and that a full cycle returns to the start state. The runner does
 * not call it.
 */
export type NavScenario = Scenario & { probe: () => unknown };

/** `forward` n times, then `back` n times: a cycle of 2n returns to the start. */
export function backAndForth(
  n: number,
  forward: string,
  back: string,
): (i: number) => string {
  return (i) => (i % (2 * n) < n ? forward : back);
}

/** Child indices from the root down to the focused element. */
export function focusPath(): number[] {
  const path: number[] = [];
  let node: ElementNode | undefined = activeElement();
  while (node?.parent) {
    path.unshift(node.parent.children.indexOf(node));
    node = node.parent;
  }
  return path;
}

/** Target and live (renderer) position of a node, rounded. */
export function pos(node: ElementNode | undefined): number[] {
  if (!node) return [];
  return [
    Math.round(node.x ?? 0),
    Math.round(node.y ?? 0),
    Math.round(node.lng.x ?? 0),
    Math.round(node.lng.y ?? 0),
  ];
}

/** Ten 185x278 poster images, generated into bench/public/images. */
export const posterImages = Array.from(
  { length: 10 },
  (_, i) => `./images/poster-${i}.png`,
);

// placeholderColor is typed as a number (the renderer's), so the card colour
// has a numeric twin for it.
export const placeholderColor = 0x252c37ff;

export const theme = {
  primary: '#2c4f7cff',
  primaryLight: '#4a7bd0ff',
  card: '#252c37ff',
  textPrimary: '#e6e8ebff',
} as const;

/** A plain tile the size of the demo's Thumbnail, with a `$focus` colour. */
export const plainTile = {
  width: 185,
  height: 278,
  color: theme.card,
  $focus: { color: theme.primaryLight },
} satisfies NodeStyles;

/** solid-demo-app styles.Thumbnail (roundPoster on, `$hover`/`$pressed` dropped). */
export const thumbnail = {
  width: 185,
  height: 278,
  scale: 1,
  zIndex: 2,
  placeholderColor,
  transition: {
    scale: { duration: 250, easing: 'linear' },
  },
  borderRadius: 16,
  border: { width: 0, color: '#00000000' },
  $focus: {
    scale: 1.1,
    border: { color: theme.primaryLight, width: 6, gap: 4, align: 'outside' },
  },
} satisfies NodeStyles;

export interface Item {
  src: string;
  title: string;
}

/** `count` deterministic items cycling through the poster images. */
export function makeItems(count: number, prefix = 'Item'): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    src: posterImages[i % posterImages.length]!,
    title: `${prefix} ${i}`,
  }));
}
