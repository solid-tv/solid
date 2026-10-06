// Scenario: a Column of 10 Rows x 20 tiles, with right/left and
// down/up presses, and `scroll` auto and always.
import type { ElementNode } from '@solidtv/solid';
import { Column, Row } from '@solidtv/solid/primitives';
import { For } from 'solid-js';
import {
  backAndForth,
  focusPath,
  plainTile,
  pos,
  type NavScenario,
} from './shared.js';

type Scroll = 'auto' | 'always' | 'edge';

const ROWS = Array.from({ length: 10 }, (_, i) => i);
const TILES = Array.from({ length: 20 }, (_, i) => i);

let column: ElementNode | undefined;

function RowsScene(props: { rowScroll: Scroll; columnScroll: Scroll }) {
  return (
    <Column
      ref={column}
      autofocus
      x={160}
      y={80}
      width={1760}
      gap={40}
      scroll={props.columnScroll}
    >
      <For each={ROWS}>
        {() => (
          <Row height={278} gap={20} scroll={props.rowScroll}>
            <For each={TILES}>{() => <view style={plainTile} />}</For>
          </Row>
        )}
      </For>
    </Column>
  );
}

function probe() {
  const rows = (column?.children ?? []) as ElementNode[];
  return {
    focus: focusPath(),
    column: pos(column),
    rowX: rows.map((r) => pos(r)[0]),
    rowSelected: rows.map((r) => r.selected),
  };
}

function rowsScenario(
  id: string,
  title: string,
  rowScroll: Scroll,
  columnScroll: Scroll,
  step: (i: number) => string,
  warmup: number,
  measured: number,
): NavScenario {
  return {
    id,
    title,
    App: () => <RowsScene rowScroll={rowScroll} columnScroll={columnScroll} />,
    step,
    warmup,
    measured,
    probe,
  };
}

// Rows grow to their content (4080px), so `auto` and `always` both move the
// row on every press. `edge` moves it only when the next tile is off screen:
// tiles 0-8 are on screen, so Right x4 / Left x4 from tile 0 never shifts.
export const rowsScenarios: NavScenario[] = [
  rowsScenario(
    'rows-lr-noshift',
    'Column of 10 Rows x 20 tiles, Row scroll=edge: Right x4 then Left x4 in row 0, no list shift',
    'edge',
    'auto',
    backAndForth(4, 'ArrowRight', 'ArrowLeft'),
    24,
    64,
  ),
  rowsScenario(
    'rows-lr-auto',
    'Column of 10 Rows x 20 tiles, Row scroll=auto: Right x10 then Left x10 in row 0, row shifts every press',
    'auto',
    'auto',
    backAndForth(10, 'ArrowRight', 'ArrowLeft'),
    20,
    60,
  ),
  rowsScenario(
    'rows-lr-always',
    'Column of 10 Rows x 20 tiles, Row scroll=always: Right x10 then Left x10 in row 0, row shifts every press',
    'always',
    'always',
    backAndForth(10, 'ArrowRight', 'ArrowLeft'),
    20,
    60,
  ),
  rowsScenario(
    'rows-ud-auto',
    'Column of 10 Rows x 20 tiles, Column scroll=auto: Down x9 then Up x9 across rows',
    'auto',
    'auto',
    backAndForth(9, 'ArrowDown', 'ArrowUp'),
    18,
    72,
  ),
  rowsScenario(
    'rows-ud-always',
    'Column of 10 Rows x 20 tiles, Column scroll=always: Down x9 then Up x9 across rows',
    'always',
    'always',
    backAndForth(9, 'ArrowDown', 'ArrowUp'),
    18,
    72,
  ),
];
