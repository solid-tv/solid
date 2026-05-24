import { createSignal, getOwner, onCleanup, runWithOwner } from 'solid-js';
import { Config, isDev } from './config.js';
import { IRendererNode } from './dom-renderer/domRendererTypes.js';
export type * from './focusKeyTypes.js';
import { ElementNode } from './elementNode.js';
import type {
  KeyNameOrKeyCode,
  KeyHoldOptions,
  KeyMap,
} from './focusKeyTypes.js';
import { isFunction } from './utils.js';

export const [activeElement, setActiveElementSignal] = createSignal<
  ElementNode | undefined
>(undefined);

let _signalWrapper: (cb: () => void) => void = (cb) => cb();

type KeyMapEntries = Record<KeyNameOrKeyCode, string>;

const keyMapEntries: KeyMapEntries = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Enter: 'Enter',
  l: 'Last',
  ' ': 'Space',
  Backspace: 'Back',
  Escape: 'Escape',
};

const keyHoldMapEntries: Record<KeyNameOrKeyCode, string> = {
  // Enter: 'EnterHold',
};

const flattenKeyMap = (
  keyMap: Partial<KeyMap>,
  targetMap: KeyMapEntries,
): KeyMapEntries => {
  const newTargetMap = targetMap;
  for (const [key, value] of Object.entries(keyMap)) {
    if (Array.isArray(value)) {
      value.forEach((v) => {
        newTargetMap[v] = key;
      });
    } else if (value === null) {
      delete newTargetMap[key];
    } else {
      newTargetMap[value as KeyNameOrKeyCode] = key;
    }
  }
  return newTargetMap;
};

let needFocusDebugStyles = true;
const addFocusDebug = (
  prevFocusPath: ElementNode[],
  newFocusPath: ElementNode[],
) => {
  if (needFocusDebugStyles) {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = `
      [data-focus="3"] {
        border: 2px solid rgba(255, 33, 33, 0.2);
        border-radius: 5px;
        transition: border-color 0.3s ease;
      }

      [data-focus="2"] {
        border: 2px solid rgba(255, 33, 33, 0.4);
        border-radius: 5px;
        transition: border-color 0.3s ease;
      }

      [data-focus="1"] {
        border: 4px solid rgba(255, 33, 33, 0.9);
        border-radius: 5px;
        transition: border-color 0.5s ease;
      }
    `;
    document.head.appendChild(style);
    needFocusDebugStyles = false;
  }

  prevFocusPath.forEach((elm) => {
    elm.data = {
      ...elm.data,
      focus: undefined,
    };
  });

  newFocusPath.forEach((elm, i) => {
    elm.data = {
      ...elm.data,
      focus: i + 1,
    };
  });
};

// ---------------------------------------------------------------------------
// Focus History
// ---------------------------------------------------------------------------

export interface FocusHistoryEntry {
  timestamp: number;
  keyPressed: string | number | undefined;
  mappedKey: string | undefined;
  prev: ElementNode | undefined;
  next: ElementNode;
}

const MAX_FOCUS_HISTORY = 50;
const focusHistory: FocusHistoryEntry[] = [];

/**
 * WeakMap keyed by ElementNode so entries are automatically eligible for GC
 * when the element is no longer referenced elsewhere.
 */
const elementFocusData = new WeakMap<
  ElementNode,
  { focusCount: number; lastFocusedAt: number }
>();

/** The key that triggered the most recent (non-throttled) propagation pass. */
let _pendingHistoryKey: {
  keyPressed: string | number | undefined;
  mappedKey: string | undefined;
} = { keyPressed: undefined, mappedKey: undefined };

const getElementLabel = (elm: ElementNode | undefined): string => {
  if (!elm) return 'None';
  // ElementNode exposes _id internally; componentName comes from the Babel devtools plugin
  const id = elm.id ?? elm._id;
  return id ?? elm.componentName ?? 'Unknown';
};

const recordFocusHistory = (
  next: ElementNode,
  prev: ElementNode | undefined,
): void => {
  if (isDev && Config.focusHistoryDebug > 0) {
    const now = performance.now();

    // Update WeakMap metadata for the element gaining focus
    const existing = elementFocusData.get(next);
    elementFocusData.set(next, {
      focusCount: (existing?.focusCount ?? 0) + 1,
      lastFocusedAt: now,
    });

    const entry: FocusHistoryEntry = {
      timestamp: now,
      keyPressed: _pendingHistoryKey.keyPressed,
      mappedKey: _pendingHistoryKey.mappedKey,
      prev,
      next,
    };

    focusHistory.push(entry);
    if (focusHistory.length > MAX_FOCUS_HISTORY) {
      focusHistory.shift();
    }

    printFocusHistory(Config.focusHistoryDebug);
  }
};

/** Returns a snapshot of the focus history ring buffer (up to 50 entries). */
export const getFocusHistory = (): Readonly<FocusHistoryEntry[]> =>
  focusHistory;

if (isDev) {
  console.log(
    'DEBUG: Last focus target stored in $f, use inspect($f) to jump to it in the Elements panel. Enable with Config.focusHistoryDebug = n',
  );
}
/**
 * Prints the last `count` focus history entries as a console.table.
 * Callable at any time from the browser console:  `printFocusHistory(20)`
 */
export const printFocusHistory = (count: number): void => {
  const entries = focusHistory.slice(-count);
  console.table(
    entries.map((e) => ({
      prev: getElementLabel(e.prev),
      key: e.mappedKey ?? e.keyPressed ?? '—',
      next: getElementLabel(e.next),
      nextElm: e.next,
      nextDiv: (e.next.lng as IRendererNode).div,
    })),
  );

  // 2. Expose the most recent element for easy inspection
  const lastEntry = entries[entries.length - 1];
  if (lastEntry) {
    const lastElm = (lastEntry.next.lng as IRendererNode)?.div;
    if (lastElm) {
      (window as any).$f = lastElm;
    }
  }
};

// ---------------------------------------------------------------------------

export const setActiveElement = (elm: ElementNode) => {
  const prev = activeElement();
  if (elm === prev) return;
  updateFocusPath(elm, prev);
  recordFocusHistory(elm, prev);
  // Reset key attribution so programmatic focus changes show '—' for key fields
  _pendingHistoryKey = { keyPressed: undefined, mappedKey: undefined };
  _signalWrapper(() => setActiveElementSignal(elm));
};

export const [focusPath, setFocusPath] = createSignal<ElementNode[]>([]);

const updateFocusPath = (
  currentFocusedElm: ElementNode,
  prevFocusedElm: ElementNode | undefined,
) => {
  let current: ElementNode | undefined = currentFocusedElm;
  const fp: ElementNode[] = [];
  const fpSet = new Set<ElementNode>();
  while (current) {
    if (
      !current.states.has(Config.focusStateKey) ||
      current === currentFocusedElm
    ) {
      current.states.add(Config.focusStateKey);
      current.onFocus?.call(
        current,
        currentFocusedElm,
        prevFocusedElm,
        current,
      );
      current.onFocusChanged?.call(
        current,
        true,
        currentFocusedElm,
        prevFocusedElm,
        current,
      );
    }
    fp.push(current);
    fpSet.add(current);
    current = current.parent;
  }

  const prevFp = focusPath();
  prevFp.forEach((elm) => {
    if (!fpSet.has(elm)) {
      elm.states.remove(Config.focusStateKey);
      elm.onBlur?.call(elm, currentFocusedElm, prevFocusedElm!, elm);
      elm.onFocusChanged?.call(
        elm,
        false,
        currentFocusedElm,
        prevFocusedElm,
        elm,
      );
    }
  });

  if (Config.focusDebug) {
    addFocusDebug(prevFp, fp);
  }

  _signalWrapper(() => setFocusPath(fp));
};

let lastGlobalKeyPressTime = 0;
let lastInputKey: string | number | undefined;

/**
 * Key-handler consume contract (1.3+):
 *
 * A focus-path handler that runs is considered to have consumed the event.
 * Traversal stops at that element. To opt back into bubbling — for handlers
 * that observe but don't act (logging, analytics, instrumentation) — the
 * handler must explicitly `return false`.
 *
 *   - `return false`            → not consumed; event bubbles to the next ancestor.
 *   - any other return          → consumed (default).
 *     (`undefined`, `true`, void, etc.)
 *
 * @internal exported for tests. Not part of the public API; signature may
 * change in any minor.
 */
export const _isHandlerConsumed = (result: unknown): boolean =>
  result !== false;

const isElementThrottled = (
  elm: ElementNode,
  sameKey: boolean,
  currentTime: number,
): boolean =>
  elm.throttleInput !== undefined &&
  sameKey &&
  elm._lastAnyKeyPressTime !== undefined &&
  currentTime - elm._lastAnyKeyPressTime < elm.throttleInput;

// Walk focus path root→leaf. Returns true if a capture handler claimed the
// event (or an element on the path is currently rate-limited).
const runCapturePhase = (
  fp: ElementNode[],
  e: KeyboardEvent,
  mappedEvent: string | undefined,
  isUp: boolean,
  sameKey: boolean,
  currentTime: number,
): boolean => {
  const finalFocusElm = fp[0]!;
  const keyBase = mappedEvent || e.key;
  const captureEvent = `onCapture${keyBase}${isUp ? 'Release' : ''}`;
  const captureKey = isUp ? 'onCaptureKeyRelease' : 'onCaptureKey';

  for (let i = fp.length - 1; i >= 0; i--) {
    const elm = fp[i]!;
    if (isElementThrottled(elm, sameKey, currentTime)) return true;

    const captureHandler = elm[captureEvent] || elm[captureKey];
    if (isFunction(captureHandler)) {
      const result = captureHandler.call(
        elm,
        e,
        elm,
        finalFocusElm,
        mappedEvent,
      );
      if (_isHandlerConsumed(result)) {
        elm._lastAnyKeyPressTime = currentTime;
        return true;
      }
    }
  }
  return false;
};

// Walk focus path leaf→root. Returns whether the event was handled and the
// last element that had *any* matching handler (for the no-handler debug log).
const runBubblePhase = (
  fp: ElementNode[],
  e: KeyboardEvent,
  mappedEvent: string | undefined,
  isHold: boolean,
  isUp: boolean,
  sameKey: boolean,
  currentTime: number,
): { handled: boolean; lastHandlerSeen: ElementNode | undefined } => {
  const finalFocusElm = fp[0]!;
  const eventHandlerKey = mappedEvent
    ? isUp
      ? `on${mappedEvent}Release`
      : `on${mappedEvent}`
    : undefined;
  const fallbackHandlerKey: 'onKeyHold' | 'onKeyPress' | undefined = isUp
    ? undefined
    : isHold
      ? 'onKeyHold'
      : 'onKeyPress';

  let lastHandlerSeen: ElementNode | undefined;

  for (let i = 0; i < fp.length; i++) {
    const elm = fp[i]!;
    if (isElementThrottled(elm, sameKey, currentTime)) {
      return { handled: true, lastHandlerSeen };
    }

    let handled = false;
    if (eventHandlerKey) {
      const eventHandler = elm[eventHandlerKey];
      if (isFunction(eventHandler)) {
        lastHandlerSeen = elm;
        handled = _isHandlerConsumed(
          eventHandler.call(elm, e, elm, finalFocusElm),
        );
      }
    }
    if (!handled && fallbackHandlerKey) {
      const fallbackHandler = elm[fallbackHandlerKey];
      if (isFunction(fallbackHandler)) {
        lastHandlerSeen = elm;
        handled = _isHandlerConsumed(
          fallbackHandler.call(elm, e, mappedEvent, elm, finalFocusElm),
        );
      }
    }

    if (handled) {
      elm._lastAnyKeyPressTime = currentTime;
      return { handled: true, lastHandlerSeen };
    }
  }
  return { handled: false, lastHandlerSeen };
};

const propagateKeyPress = (
  e: KeyboardEvent,
  mappedEvent?: string,
  isHold: boolean = false,
  isUp: boolean = false,
): boolean => {
  const currentTime = performance.now();
  const key = e.key || e.keyCode;
  const sameKey = lastInputKey === key;
  lastInputKey = key;

  if (!isUp && Config.throttleInput) {
    if (
      sameKey &&
      currentTime - lastGlobalKeyPressTime < Config.throttleInput
    ) {
      if (isDev && Config.keyDebug) {
        console.log(
          `Keypress throttled by global Config.throttleInput: ${Config.throttleInput}ms`,
        );
      }
      return false;
    }
    lastGlobalKeyPressTime = currentTime;
  }

  // Keyup events don't trigger focus changes, so don't record their key.
  if (!isUp) {
    _pendingHistoryKey = { keyPressed: key, mappedKey: mappedEvent };
  }

  const fp = focusPath();
  if (fp.length === 0) return false;

  if (runCapturePhase(fp, e, mappedEvent, isUp, sameKey, currentTime)) {
    return true;
  }

  const { handled, lastHandlerSeen } = runBubblePhase(
    fp,
    e,
    mappedEvent,
    isHold,
    isUp,
    sameKey,
    currentTime,
  );
  if (handled) return true;

  if (isDev && Config.keyDebug && !isUp) {
    const detail = `key="${e.key}", mappedEvent=${mappedEvent}, isHold=${isHold}, isUp=${isUp}`;
    if (lastHandlerSeen) {
      console.log(`Keypress bubbled, ${detail}`, lastHandlerSeen);
    } else {
      console.log(`No event handler available for keypress: ${detail}`);
    }
  }

  return false;
};

const DEFAULT_KEY_HOLD_THRESHOLD = 500; // ms
const keyHoldTimeouts: { [key: KeyNameOrKeyCode]: number | true } = {};

const handleKeyEvents = (
  delay: number,
  keydown?: KeyboardEvent,
  keyup?: KeyboardEvent,
) => {
  if (keydown) {
    const key: KeyNameOrKeyCode = keydown.key || keydown.keyCode;
    const mappedKeyHoldEvent =
      keyHoldMapEntries[keydown.key] || keyHoldMapEntries[keydown.keyCode];
    const mappedKeyEvent =
      keyMapEntries[keydown.key] || keyMapEntries[keydown.keyCode];
    if (mappedKeyHoldEvent) {
      if (!keyHoldTimeouts[key]) {
        keyHoldTimeouts[key] = window.setTimeout(() => {
          keyHoldTimeouts[key] = true;
          propagateKeyPress(keydown, mappedKeyHoldEvent, true);
        }, delay);
      }
      return;
    }

    propagateKeyPress(keydown, mappedKeyEvent, false);
  } else if (keyup) {
    const key: KeyNameOrKeyCode = keyup.key || keyup.keyCode;
    const mappedKeyEvent =
      keyMapEntries[keyup.key] || keyMapEntries[keyup.keyCode];
    if (keyHoldTimeouts[key] === true) {
      delete keyHoldTimeouts[key];
    } else if (keyHoldTimeouts[key]) {
      clearTimeout(keyHoldTimeouts[key]);
      delete keyHoldTimeouts[key];
      // trigger key down event when hold didn't finish
      propagateKeyPress(keyup, mappedKeyEvent, false);
    }

    propagateKeyPress(keyup, mappedKeyEvent, false, true);
  }
};

export const useFocusManager = (
  userKeyMap?: Partial<KeyMap>,
  keyHoldOptions?: KeyHoldOptions,
) => {
  if (userKeyMap) {
    flattenKeyMap(userKeyMap, keyMapEntries);
  }
  if (keyHoldOptions?.userKeyHoldMap) {
    flattenKeyMap(keyHoldOptions.userKeyHoldMap, keyHoldMapEntries);
  }

  // Capture the calling owner so signal updates and key-event reactions
  // can run inside it — needed for programmatic .setFocus(), post-mutation
  // focus, and any effect subscribers that rely on onCleanup.
  const owner = getOwner();
  const ownerContext = (cb: () => void) => {
    runWithOwner(owner, cb);
  };
  _signalWrapper = ownerContext;

  const delay = keyHoldOptions?.holdThreshold || DEFAULT_KEY_HOLD_THRESHOLD;
  const runKeyEvent = handleKeyEvents.bind(null, delay);

  const keyPressHandler = (event: KeyboardEvent) =>
    ownerContext(() => runKeyEvent(event, undefined));
  const keyUpHandler = (event: KeyboardEvent) =>
    ownerContext(() => runKeyEvent(undefined, event));

  document.addEventListener('keydown', keyPressHandler);
  document.addEventListener('keyup', keyUpHandler);

  onCleanup(() => {
    document.removeEventListener('keydown', keyPressHandler);
    document.removeEventListener('keyup', keyUpHandler);
    for (const timeout of Object.values(keyHoldTimeouts)) {
      if (timeout && timeout !== true) clearTimeout(timeout);
    }
  });
};
