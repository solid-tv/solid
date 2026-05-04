import * as s from 'solid-js';
import * as utils from '../../utils.js';

export type ScrollMode = 'auto' | 'edge' | 'always' | 'none';

export type VirtualWindowOptions<T> = {
  items: s.Accessor<readonly T[]>;
  displaySize: number;
  buffer?: () => number; // default: () => 2
  scroll?: () => ScrollMode; // default: () => 'auto'
  scrollIndex?: () => number; // default: () => 0
  wrap?: boolean;
  debugInfo?: boolean;
};

export type WindowSlice<T> = {
  items: T[];
  start: number;
  selected: number;
  shiftBy: number;
  atStart: boolean;
  atEnd: boolean;
  cursor: number;
};

export type VirtualWindow<T> = {
  slice: s.Accessor<WindowSlice<T>>;
  cursor: s.Accessor<number>;
  /** Advance by a raw (slice-relative) delta. Normalizes for wrap mode internally. */
  navigate: (rawDelta: number) => void;
  /** Jump to an absolute index with delta=0 (no animation bias). */
  scrollToIndex: (index: number) => void;
};

const EMPTY_SLICE: WindowSlice<never> = {
  items: [],
  start: 0,
  selected: 0,
  shiftBy: 0,
  atStart: true,
  atEnd: true,
  cursor: 0,
};

export function createVirtualWindow<T>(
  opts: VirtualWindowOptions<T>,
): VirtualWindow<T> {
  const bufferSize = opts.buffer ?? (() => 2);
  const scrollType = opts.scroll ?? (() => 'auto' as ScrollMode);
  const scrollIndex = opts.scrollIndex ?? (() => 0);
  const items = opts.items;
  const itemCount = () => items().length;

  const [cursor, setCursor] = s.createSignal(0);
  const [slice, setSlice] = s.createSignal<WindowSlice<T>>(
    EMPTY_SLICE as WindowSlice<T>,
  );

  function normalizeDeltaForWindow(delta: number, windowLen: number): number {
    if (!windowLen) return 0;
    const half = windowLen / 2;
    if (delta > half) return delta - windowLen;
    if (delta < -half) return delta + windowLen;
    return delta;
  }

  function buildItems(start: number, length: number): T[] {
    const total = itemCount();
    if (opts.wrap) {
      return Array.from(
        { length },
        (_, i) => items()[utils.mod(start + i, total)],
      ) as T[];
    }
    return items().slice(start, start + length) as T[];
  }

  function computeSlice(
    c: number,
    delta: number,
    prev: WindowSlice<T>,
  ): WindowSlice<T> {
    const total = itemCount();

    if (total === 0) {
      return EMPTY_SLICE as WindowSlice<T>;
    }

    if (total <= opts.displaySize) {
      return {
        items: items() as T[],
        start: 0,
        selected: utils.clamp(c, 0, total - 1),
        shiftBy: 0,
        atStart: c <= 0,
        atEnd: c >= total - 1,
        cursor: utils.clamp(c, 0, total - 1),
      };
    }

    const buf = bufferSize();
    const length = opts.displaySize + buf;
    const si = scrollIndex();
    const scroll = scrollType();
    let start = prev.start;
    let selected = prev.selected;
    let atStart = prev.atStart;
    let shiftBy = -delta;

    switch (scroll) {
      case 'always':
        if (opts.wrap) {
          start = utils.mod(c - 1, total);
          selected = 1;
        } else {
          start = utils.clamp(
            c - buf,
            0,
            Math.max(0, total - opts.displaySize - buf),
          );
          if (delta === 0 && c > 3) {
            shiftBy = c < 3 ? -c : -2;
            selected = 2;
          } else {
            selected =
              c < buf
                ? c
                : c >= total - opts.displaySize
                  ? c - (total - opts.displaySize) + buf
                  : buf;
          }
        }
        break;

      case 'auto':
        if (opts.wrap) {
          if (delta === 0) {
            selected = si || 1;
            start = utils.mod(c - (si || 1), total);
          } else {
            start = utils.mod(c - (prev.selected || 1), total);
          }
        } else {
          if (delta < 0) {
            if (prev.start > 0 && prev.selected >= opts.displaySize) {
              start = prev.start;
              selected = prev.selected - 1;
            } else if (prev.start > 0) {
              start = prev.start - 1;
              selected = prev.selected;
            } else if (prev.start === 0 && !prev.atStart) {
              start = 0;
              selected = prev.selected - 1;
              atStart = true;
            } else if (selected >= opts.displaySize - 1) {
              start = 0;
              selected = prev.selected - 1;
            } else {
              start = 0;
              selected = prev.selected - 1;
              shiftBy = 0;
            }
          } else if (delta > 0) {
            if (prev.selected < si) {
              start = prev.start;
              selected = prev.selected + 1;
              shiftBy = 0;
            } else if (prev.selected === si || atStart) {
              start = prev.start;
              selected = prev.selected + 1;
              atStart = false;
            } else if (prev.start === 0 && prev.selected === 0) {
              start = 0;
              selected = 1;
              atStart = false;
            } else if (prev.start >= total - opts.displaySize) {
              start = prev.start;
              selected = c - start;
              shiftBy = 0;
            } else {
              start = prev.start + 1;
              selected = Math.max(prev.selected, si + 1);
            }
          } else {
            // Initial setup / delta === 0
            if (c > 0) {
              start = Math.min(c - (si || 1), total - opts.displaySize - buf);
              selected = Math.max(si || 1, c - start);
              shiftBy = total - c < 3 ? c - total : -1;
              atStart = false;
            } else {
              if (c !== prev.cursor) {
                start = c;
                if (c === 0) {
                  atStart = true;
                  selected = 0;
                }
              } else {
                start = prev.start;
                selected = prev.selected;
              }
            }
          }
        }
        break;

      case 'edge': {
        const startScrolling = Math.max(
          1,
          opts.displaySize + (atStart ? -1 : 0),
        );
        if (opts.wrap) {
          if (delta > 0) {
            if (prev.selected < startScrolling) {
              selected = prev.selected + 1;
              shiftBy = 0;
            } else if (prev.selected === startScrolling && atStart) {
              selected = prev.selected + 1;
              atStart = false;
            } else {
              start = utils.mod(prev.start + 1, total);
              selected = prev.selected;
            }
          } else if (delta < 0) {
            if (prev.selected > 1) {
              selected = prev.selected - 1;
              shiftBy = 0;
            } else {
              start = utils.mod(prev.start - 1, total);
              selected = 1;
            }
          } else {
            start = utils.mod(c - 1, total);
            selected = 1;
            shiftBy = -1;
            atStart = false;
          }
        } else {
          if (delta === 0 && c > 0) {
            selected = c > startScrolling ? startScrolling : c;
            start = Math.max(0, c - startScrolling + 1);
            shiftBy = c > startScrolling ? -1 : 0;
            atStart = c < startScrolling;
          } else if (delta > 0) {
            if (prev.selected < startScrolling) {
              selected = prev.selected + 1;
              shiftBy = 0;
            } else if (prev.selected === startScrolling && atStart) {
              selected = prev.selected + 1;
              atStart = false;
            } else {
              start = prev.start + 1;
              selected = prev.selected;
              atStart = false;
            }
          } else if (delta < 0) {
            if (prev.selected > 1) {
              selected = prev.selected - 1;
              shiftBy = 0;
            } else if (c > 1) {
              start = Math.max(0, c - 1);
              selected = 1;
            } else if (c === 1) {
              start = 0;
              selected = 1;
            } else {
              start = 0;
              selected = 0;
              shiftBy = atStart ? 0 : shiftBy;
              atStart = true;
            }
          }
        }
        break;
      }

      case 'none':
      default:
        start = 0;
        selected = c;
        shiftBy = 0;
        break;
    }

    let newItems = prev.items;
    if (start !== prev.start || newItems.length !== length) {
      newItems = buildItems(start, length);
    }

    const state: WindowSlice<T> = {
      items: newItems,
      start,
      selected,
      shiftBy,
      atStart,
      atEnd: !opts.wrap && c >= total - 1,
      cursor: c,
    };

    if (opts.debugInfo) {
      console.log('[Virtual]', {
        cursor: c,
        delta,
        start,
        selected,
        shiftBy,
        items: state.items,
      });
    }

    return state;
  }

  function navigate(rawDelta: number) {
    const total = itemCount();
    if (total === 0) return;

    const windowLen = slice().items.length;
    const delta = opts.wrap
      ? normalizeDeltaForWindow(rawDelta, windowLen)
      : rawDelta;

    const newCursor = opts.wrap
      ? utils.mod(cursor() + delta, total)
      : utils.clamp(cursor() + delta, 0, total - 1);

    setCursor(newCursor);
    setSlice((prev) => computeSlice(newCursor, delta, prev));
  }

  function scrollToIndex(index: number) {
    const total = itemCount();
    const safe = total === 0 ? 0 : utils.clamp(index, 0, total - 1);
    setCursor(safe);
    setSlice((prev) => computeSlice(safe, 0, prev));
  }

  return { slice, cursor, navigate, scrollToIndex };
}
