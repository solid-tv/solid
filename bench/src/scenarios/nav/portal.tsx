// Scenario: `onFocusChanged` driving reactive text colours, modelled on
// solid-demo-app's pages/Portal.tsx (the Examples page): a Column of 4 Rows of
// DemoTiles, each tile tracking focus in a signal that recolours its 3 texts.
import type { ElementNode, NodeStyles, TextStyles } from '@solidtv/solid';
import { Column, Row } from '@solidtv/solid/primitives';
import { createSignal, For } from 'solid-js';
import { backAndForth, focusPath, pos, type NavScenario } from './shared.js';

interface Demo {
  title: string;
  description: string;
}

const d = (title: string, description: string): Demo => ({
  title,
  description,
});

const rows: { title: string; demos: Demo[] }[] = [
  {
    title: 'Core Concepts',
    demos: [
      d('Focus Basics', 'Quick guide on Focus'),
      d('Key Handling', 'Understanding Key Handling'),
      d('Focus Handling', 'Dealing with Focus Handling'),
      d('Loop Basics', 'Understanding For, Index, Lazy and List'),
      d('Layout Basics', 'Quick guide on Layout'),
      d('Positioning', 'Positioning Elements'),
      d('Create Elements', 'Testing Show + children + inserting text'),
      d('Destroy', 'Using onDestroy to animate destruction'),
      d('Viewport', 'Events going in and out of viewport'),
    ],
  },
  {
    title: 'Text',
    demos: [
      d('Text', 'Text layout with flexbox'),
      d('TextPoster', 'Text layout with flex and Poster'),
      d(
        'Text Centering',
        'verticalAlign, textBaselineMode, and flex alignment',
      ),
      d('Custom Buttons', '6 custom buttons with text and icons'),
    ],
  },
  {
    title: 'Flexbox & Styling',
    demos: [
      d('Flex Row', 'Flex Row Implementation'),
      d('Flex Column', 'Flex Column Implementation'),
      d('Flex Grow', 'Flex Grow Examples'),
      d('Flex Row Vertical Align', 'Flex Row Vertical Align Implementation'),
      d(
        'Flex Column Vertical Align',
        'Flex Column Vertical Align Implementation',
      ),
      d('Flex Menu', 'Flex Menu On Right Implementation'),
      d('Flex Layout Tests', 'Complicated flex layouts'),
      d('Gradients', 'Basic Gradients'),
      d('Transitions', 'Comparing different Transitions'),
      d('Complex Flex', 'Complex Flex Layout with ~400 Nodes'),
    ],
  },
  {
    title: 'Patterns & Examples',
    demos: [
      d('TMDB', 'TMDB Example'),
      d('Login and Forms', 'Login with forms Example'),
      d('Small Image', 'Performance test for loading images'),
      d('Large Image', 'Performance test for loading 4 large images'),
      d('Nested Modal', 'Nested Right Modal Example'),
      d('Components', 'Reusable Components'),
      d('Grid', 'Infinite Scroll Grid'),
      d('Virtual', 'Virtual Rows'),
    ],
  },
];

// styles.RowTitle, with Portal's fontSize 42.
const rowTitle = {
  height: 44,
  width: 300,
  marginBottom: -54,
  fontSize: 42,
  color: '#f0f0f0ff',
  zIndex: 2,
} satisfies TextStyles;

const container = {
  width: 370,
  height: 320,
  borderRadius: 6,
  color: '#182b44ff',
  transition: { color: true },
  $focus: { color: '#ffffffff' },
} satisfies NodeStyles;

function DemoTile(props: { index: number } & Demo) {
  const [hasFocus, setHasFocus] = createSignal(false);
  return (
    <view onFocusChanged={setHasFocus} style={container}>
      <view x={30}>
        <text
          y={30}
          fontSize={84}
          color={hasFocus() ? '#000000ff' : '#ffffffff'}
        >
          {String(props.index)}
        </text>
        <text
          y={140}
          fontSize={42}
          width={340}
          maxHeight={42}
          contain="both"
          color={hasFocus() ? '#000000ff' : '#ffffffff'}
        >
          {props.title}
        </text>
        <text
          y={200}
          fontSize={28}
          width={330}
          contain="width"
          color={hasFocus() ? '#000000ff' : '#ffffffff'}
        >
          {props.description}
        </text>
      </view>
    </view>
  );
}

let column: ElementNode | undefined;

function App() {
  return (
    <view colorTop="#446b9eff" colorBottom="#2c4f7cff">
      <view x={120}>
        <view src="./images/icon.png" width={90} height={90} y={40} />
        <text fontSize={90} x={110} y={40}>
          Examples
        </text>
        <view y={140} height={1} width={1800} color="#e8d7f9ff" />
      </view>
      <view clipping y={146} x={150}>
        <Column ref={column} scroll="auto" y={20} x={20} gap={20} autofocus>
          <For each={rows}>
            {(row) => (
              <view forwardFocus={1} height={400}>
                <text style={rowTitle}>{row.title}</text>
                <Row
                  y={48}
                  gap={40}
                  height={320}
                  flexBoundary="contain"
                  scroll="always"
                >
                  <For each={row.demos}>
                    {(demo, i) => <DemoTile index={i()} {...demo} />}
                  </For>
                </Row>
              </view>
            )}
          </For>
        </Column>
      </view>
    </view>
  );
}

function firstRow(): ElementNode | undefined {
  return (column?.children[0] as ElementNode | undefined)?.children[1] as
    | ElementNode
    | undefined;
}

const portalFocusText: NavScenario = {
  id: 'portal-focus-text',
  title:
    'Portal page: 4 Rows of DemoTiles, onFocusChanged recolours 3 texts per tile, Row scroll=always: Right x4 then Left x4 in row 0',
  App,
  step: backAndForth(4, 'ArrowRight', 'ArrowLeft'),
  warmup: 24,
  measured: 64,
  probe: () => {
    const tiles = (firstRow()?.children ?? []) as ElementNode[];
    return {
      focus: focusPath(),
      row: pos(firstRow()),
      // Colour of each tile's title text in row 0: 0 = black (focused).
      titleColors: tiles.map(
        (t) =>
          ((t.children[0] as ElementNode).children[1] as ElementNode).color,
      ),
    };
  },
};

export default portalFocusText;
