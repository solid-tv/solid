// Scenario: a details panel whose title, description and metadata text
// change on every key press, laid out with flex, as on a hero or details
// screen (modelled on solid-demo-app's ContentBlock and Entity page).
import type { NodeStyles, TextStyles } from '@solidtv/solid';
import { Row } from '@solidtv/solid/primitives';
import { createSignal, For } from 'solid-js';
import type { Scenario } from '../../scenario.js';
import { DETAILS } from './data.js';

const PANEL_WIDTH = 1200;
const TEXT_WIDTH = 1100;

// The panel sizes its height to its children; the cast line below the
// description moves when the description wraps to a different line count.
const panel = {
  x: 120,
  y: 60,
  width: PANEL_WIDTH,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
} satisfies NodeStyles;

// One line, so no `loaded` listener: maxLines 1 gives it a maxHeight.
const title = {
  width: PANEL_WIDTH,
  contain: 'width',
  maxLines: 1,
  fontSize: 56,
  lineHeight: 68,
  fontWeight: 700,
  color: '#e6e8ebff',
} satisfies TextStyles;

// A flex row of text children with no width, so it lays out once they have
// their sizes, as the demo's Metadata row does.
const metadataRow = {
  display: 'flex',
  gap: 14,
  height: 36,
  alignItems: 'center',
} satisfies NodeStyles;

const metaText = {
  fontSize: 24,
  lineHeight: 32,
  color: '#e6e8ebff',
} satisfies TextStyles;

const separator = {
  ...metaText,
  color: '#7f848dff',
} satisfies TextStyles;

// A flex badge nested in the metadata row: its width follows its text. The
// inset is the text's margins, not `padding`: the two flex engines centre a
// padded container's children differently (flexLayout.ts offsets the centre
// by the padding), and margins lay out the same in both.
const badge = {
  display: 'flex',
  height: 32,
  alignItems: 'center',
  color: '#ffffff33',
} satisfies NodeStyles;

const badgeText = {
  marginLeft: 10,
  marginRight: 10,
  fontSize: 20,
  lineHeight: 24,
  color: '#ffffffff',
} satisfies TextStyles;

const description = {
  width: TEXT_WIDTH,
  contain: 'width',
  maxLines: 3,
  fontSize: 26,
  lineHeight: 38,
  color: '#c8ccd2ff',
} satisfies TextStyles;

const castLine = {
  width: TEXT_WIDTH,
  contain: 'width',
  maxLines: 1,
  fontSize: 22,
  lineHeight: 30,
  color: '#7f848dff',
} satisfies TextStyles;

const item = {
  width: 192,
  height: 270,
  color: '#252c37ff',
  $focus: { color: '#4a7bd0ff' },
} satisfies NodeStyles;

/** Right x7 then Left x7 over the 8 items: a cycle of 14 returns to item 0. */
const CYCLE = 2 * (DETAILS.length - 1);

const [selected, setSelected] = createSignal(0);
const details = () => DETAILS[selected()]!;

/**
 * The Row's onSelectedChanged sets the selected item inside the key handler,
 * so all of a press's text changes (title, four metadata texts, description,
 * cast) happen within the op. The Row does not scroll: all 8 items fit.
 *
 * The 8 items repeat, so after the first pass every layout is a layout-cache
 * hit on both renderers: this measures the update path (text set, walk,
 * `loaded`, flex) rather than text measurement.
 */
export const detailsPanel: Scenario = {
  id: 'text-details-panel',
  title:
    'Details panel (flex column: title, metadata flex row with separators and a badge, 3-line description, cast) updated by Right x7 / Left x7 on a Row of 8',
  text: true,
  App: () => (
    <>
      <view style={panel}>
        <text style={title}>{details().title}</text>
        <view style={metadataRow}>
          <text style={metaText}>{details().year}</text>
          <text style={separator}>|</text>
          <text style={metaText}>{details().runtime}</text>
          <text style={separator}>|</text>
          <text style={metaText}>{details().genres}</text>
          <view style={badge}>
            <text style={badgeText}>{details().rating}</text>
          </view>
        </view>
        <text style={description}>{details().description}</text>
        <text style={castLine}>Starring: {details().cast}</text>
      </view>
      <Row
        autofocus
        x={120}
        y={720}
        gap={24}
        scroll="none"
        onSelectedChanged={(idx) => setSelected(idx)}
      >
        <For each={DETAILS}>{() => <view style={item} />}</For>
      </Row>
    </>
  ),
  step: (i) => (i % CYCLE < CYCLE / 2 ? 'ArrowRight' : 'ArrowLeft'),
  warmup: 2 * CYCLE,
  measured: 4 * CYCLE,
};
