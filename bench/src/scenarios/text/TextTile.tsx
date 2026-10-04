import type { NodeStyles, TextStyles } from '@solidtv/solid';
import type { TileText } from './data.js';

export const TILE_WIDTH = 200;

/**
 * A flex column that sizes its height to its children: artwork, a title of up
 * to two lines and a one-line subtitle. Text sits 12px in from the card edge.
 */
const tile = {
  width: TILE_WIDTH,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  color: '#1a1f27ff',
  $focus: { color: '#2c4f7cff' },
} satisfies NodeStyles;

const art = {
  width: TILE_WIDTH,
  height: 112,
  color: '#252c37ff',
} satisfies NodeStyles;

// As the demo app's PosterTitle: a width, contain 'width' and maxLines. No
// height, so the title's height (one or two lines) comes from its layout and
// the column waits for its `loaded`.
const title = {
  x: 12,
  width: TILE_WIDTH - 24,
  contain: 'width',
  maxLines: 2,
  fontSize: 24,
  lineHeight: 30,
  color: '#e6e8ebff',
} satisfies TextStyles;

// No width: flex skips the column until this text has its size.
const subtitle = {
  x: 12,
  fontSize: 20,
  lineHeight: 26,
  marginBottom: 12,
  color: '#9aa0a6ff',
} satisfies TextStyles;

export function TextTile(props: { item: TileText }) {
  return (
    <view style={tile}>
      <view style={art} />
      <text style={title}>{props.item.title}</text>
      <text style={subtitle}>{props.item.subtitle}</text>
    </view>
  );
}
