// Scenario: a NavDrawer-style toggle: `states` add and remove on 10
// children with `forwardStates`, and a width transition.
//
// Modelled on solid-demo-app's LeftNavWrapper + components/NavDrawer: Left
// from the first page tile bubbles to the wrapper's onLeft, which focuses the
// drawer; the drawer's onFocus adds `$focus` to the backdrop (width 200 -> 1600
// with a transition) and `$active` to each button (width 100 -> 328,
// forwarded to its label: alpha 0 -> 1). Right from the drawer bubbles to the
// wrapper's onRight, which refocuses the page tile, and onBlur undoes it all.
import {
  activeElement,
  type ElementNode,
  type NodeStyles,
  type TextStyles,
} from '@solidtv/solid';
import { Column, Row } from '@solidtv/solid/primitives';
import { For } from 'solid-js';
import {
  focusPath,
  plainTile,
  pos,
  theme,
  type NavScenario,
} from './shared.js';

// NavDrawer.styles.ts
const drawerColumn = {
  flexDirection: 'column',
  display: 'flex',
  width: 140,
  height: 600,
  y: 120,
  gap: 20,
  zIndex: 101,
  transition: {
    x: { duration: 250, easing: 'ease-in-out' },
  },
  x: 24,
  $focus: { width: 500 },
} satisfies NodeStyles;

const backdropStyle = {
  zIndex: 99,
  color: '#000000ff',
  src: './images/sidenav.png',
  alpha: 0,
  width: 200,
  height: 1080,
  $focus: { alpha: 1, width: 1600 },
  transition: { alpha: true, width: true },
} satisfies NodeStyles;

const navButton = {
  zIndex: 102,
  height: 70,
  width: 100,
  borderRadius: 0,
  color: '#00000000',
  $focus: { color: theme.primaryLight, borderRadius: 8 },
  $active: { width: 328 },
} satisfies NodeStyles;

const navButtonText = {
  x: 112,
  fontSize: 38,
  lineHeight: 70,
  alpha: 0,
  color: theme.textPrimary,
  $active: { alpha: 1 },
} satisfies TextStyles;

const LABELS = [
  'Trending',
  'Movies',
  'TV',
  'Examples',
  'Benchmark',
  'Search',
  'Live',
  'Sports',
  'Kids',
  'Settings',
];

const TILES = Array.from({ length: 7 }, (_, i) => i);

let wrapper: ElementNode | undefined;
let drawer: ElementNode | undefined;
let backdrop: ElementNode | undefined;
let pageRow: ElementNode | undefined;
let lastFocused: ElementNode | undefined;

function NavButton(props: { children: string }) {
  return (
    <view forwardStates style={navButton}>
      <view src="./images/icon.png" width={48} height={48} x={26} y={11} />
      <text style={navButtonText}>{props.children}</text>
    </view>
  );
}

function onDrawerFocus(this: ElementNode) {
  backdrop!.states.add('$focus');
  this.children.forEach((c) => c.states!.add('$active'));
  (this.children[this.selected || 0] as ElementNode).setFocus();
}

function onDrawerBlur(this: ElementNode) {
  backdrop!.states.remove('$focus');
  this.selected = 0;
  this.children.forEach((c) => c.states!.remove('$active'));
}

function focusNavDrawer() {
  if (drawer!.states.has('$focus')) return false;
  lastFocused = activeElement();
  drawer!.setFocus();
  return true;
}

function App() {
  return (
    <view
      ref={wrapper}
      width={1920}
      height={1080}
      onLeft={focusNavDrawer}
      onRight={() => {
        if (drawer!.states.has('$focus')) {
          (lastFocused ?? pageRow!).setFocus();
          return true;
        }
        return false;
      }}
    >
      <Column
        ref={drawer}
        onFocus={onDrawerFocus}
        onBlur={onDrawerBlur}
        style={drawerColumn}
        scroll="none"
      >
        <For each={LABELS}>{(label) => <NavButton>{label}</NavButton>}</For>
      </Column>
      <view skipFocus ref={backdrop} style={backdropStyle} />
      <view x={200} y={400}>
        <Row ref={pageRow} autofocus gap={20} scroll="none">
          <For each={TILES}>{() => <view style={plainTile} />}</For>
        </Row>
      </view>
    </view>
  );
}

const navDrawerToggle: NavScenario = {
  id: 'navdrawer-toggle',
  title:
    'NavDrawer of 10 forwardStates buttons: Left opens it ($active on 10 buttons, backdrop $focus width 200->1600 transition), Right closes it',
  App,
  step: (i) => (i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight'),
  warmup: 30,
  measured: 60,
  probe: () => {
    const buttons = (drawer?.children ?? []) as ElementNode[];
    return {
      focus: focusPath(),
      drawerStates: [...(drawer?.states ?? [])],
      backdropStates: [...(backdrop?.states ?? [])],
      backdropWidth: [backdrop?.width, Math.round(backdrop?.lng.w ?? 0)],
      drawerWidth: drawer?.width,
      buttonWidths: buttons.map((b) => b.width),
      activeButtons: buttons.filter((b) => b.states.has('$active')).length,
      labelAlpha: buttons.map(
        (b) => (b.children[1] as ElementNode | undefined)?.alpha,
      ),
      page: pos(pageRow),
      wrapper: pos(wrapper),
    };
  },
};

export default navDrawerToggle;
