import { Config, isDev } from './config.js';
export type * from './focusKeyTypes.js';
import { ElementNode } from './elementNode.js';
import type {
  KeyNameOrKeyCode,
  KeyHoldOptions,
  KeyMap,
} from './focusKeyTypes.js';
import { isFunction } from './utils.js';

const keyMapEntries: Record<KeyNameOrKeyCode, string> = {
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

const flattenKeyMap = (keyMap: any, targetMap: any): void => {
  for (const [key, value] of Object.entries(keyMap)) {
    if (Array.isArray(value)) {
      value.forEach((v) => {
        targetMap[v] = key;
      });
    } else if (value === null) {
      delete targetMap[key];
    } else {
      targetMap[value as keyof any] = key;
    }
  }
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
  const id = (elm as any).id ?? elm._id;
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
      nextDiv: (e.next.lng as any).div as HTMLDivElement,
    })),
  );

  // 2. Expose the most recent element for easy inspection
  const lastEntry = entries[entries.length - 1];
  if (lastEntry) {
    const lastElm = (lastEntry.next.lng as any)?.div;
    if (lastElm) {
      (window as any).$f = lastElm;
    }
  }
};

// ---------------------------------------------------------------------------

let activeElement: ElementNode | undefined;
export const setActiveElement = (elm: ElementNode) => {
  if (elm === activeElement) return;
  const prev = activeElement;
  updateFocusPath(elm, activeElement);
  activeElement = elm;
  recordFocusHistory(elm, prev);
  // Reset key attribution so programmatic focus changes show '—' for key fields
  _pendingHistoryKey = { keyPressed: undefined, mappedKey: undefined };
  // Callback for libraries to use signals / refs
  Config.setActiveElement(elm);
};

let focusPath: ElementNode[] = [];
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

  focusPath.forEach((elm) => {
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
    addFocusDebug(focusPath, fp);
  }

  focusPath = fp;
  return fp;
};

let lastGlobalKeyPressTime = 0;
let lastInputKey: string | number | undefined;

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

  // Record the key for focus-history attribution (keyup presses don't trigger focus changes)
  if (!isUp) {
    _pendingHistoryKey = { keyPressed: key, mappedKey: mappedEvent };
  }

  const numItems = focusPath.length;
  if (numItems === 0) return false;

  let handlerAvailable: ElementNode | undefined;
  const finalFocusElm = focusPath[0]!;
  const keyBase = mappedEvent || (e.key as string);
  const captureEvent = `onCapture${keyBase}${isUp ? 'Release' : ''}`;
  const captureKey = isUp ? 'onCaptureKeyRelease' : 'onCaptureKey';

  for (let i = numItems - 1; i >= 0; i--) {
    const elm = focusPath[i]!;

    // Check throttle for capture phase
    if (elm.throttleInput) {
      if (
        sameKey &&
        elm._lastAnyKeyPressTime !== undefined &&
        currentTime - elm._lastAnyKeyPressTime < elm.throttleInput
      ) {
        return true;
      }
    }

    const captureHandler = elm[captureEvent] || elm[captureKey];
    if (
      isFunction(captureHandler) &&
      captureHandler.call(elm, e, elm, finalFocusElm, mappedEvent) === true
    ) {
      elm._lastAnyKeyPressTime = currentTime;
      return true;
    }
  }

  let eventHandlerKey: string | undefined;
  let fallbackHandlerKey: 'onKeyHold' | 'onKeyPress' | undefined;

  if (mappedEvent) {
    eventHandlerKey = isUp ? `on${mappedEvent}Release` : `on${mappedEvent}`;
  }

  if (!isUp) {
    fallbackHandlerKey = isHold ? 'onKeyHold' : 'onKeyPress';
  }

  for (let i = 0; i < numItems; i++) {
    const elm = focusPath[i]!;

    // Check throttle for bubbling phase
    if (elm.throttleInput) {
      if (
        sameKey &&
        elm._lastAnyKeyPressTime !== undefined &&
        currentTime - elm._lastAnyKeyPressTime < elm.throttleInput
      ) {
        return true;
      }
    }

    let handled = false;

    if (eventHandlerKey) {
      const eventHandler = elm[eventHandlerKey];
      if (isFunction(eventHandler)) {
        handlerAvailable = elm;
        if (eventHandler.call(elm, e, elm, finalFocusElm) === true) {
          handled = true;
        }
      }
    }

    // Check for the fallback handler if its key is defined and not already handled by specific key handler
    if (!handled && fallbackHandlerKey) {
      const fallbackHandler = elm[fallbackHandlerKey];
      if (isFunction(fallbackHandler)) {
        handlerAvailable = elm;
        if (
          fallbackHandler.call(elm, e, mappedEvent, elm, finalFocusElm) === true
        ) {
          handled = true;
        }
      }
    }

    if (handled) {
      elm._lastAnyKeyPressTime = currentTime;
      return true;
    }
  }

  if (isDev && Config.keyDebug && !isUp) {
    if (handlerAvailable) {
      console.log(
        `Keypress bubbled, key="${e.key}", mappedEvent=${mappedEvent}, isHold=${isHold}, isUp=${isUp}`,
        handlerAvailable,
      );
    } else {
      console.log(
        `No event handler available for keypress: key="${e.key}", mappedEvent=${mappedEvent}, isHold=${isHold}, isUp=${isUp}`,
      );
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

interface FocusManagerOptions {
  userKeyMap?: Partial<KeyMap>;
  keyHoldOptions?: KeyHoldOptions;
  ownerContext?: (cb: () => void) => void;
}

export const useFocusManager = ({
  userKeyMap,
  keyHoldOptions,
  ownerContext = (cb) => {
    cb();
  },
}: FocusManagerOptions = {}) => {
  if (userKeyMap) {
    flattenKeyMap(userKeyMap, keyMapEntries);
  }

  if (keyHoldOptions?.userKeyHoldMap) {
    flattenKeyMap(keyHoldOptions.userKeyHoldMap, keyHoldMapEntries);
  }

  const delay = keyHoldOptions?.holdThreshold || DEFAULT_KEY_HOLD_THRESHOLD;
  const runKeyEvent = handleKeyEvents.bind(null, delay);

  // Owner context is for frameworks that need effects
  const keyPressHandler = (event: KeyboardEvent) =>
    ownerContext(() => {
      runKeyEvent(event, undefined);
    });

  const keyUpHandler = (event: KeyboardEvent) =>
    ownerContext(() => {
      runKeyEvent(undefined, event);
    });

  document.addEventListener('keyup', keyUpHandler);
  document.addEventListener('keydown', keyPressHandler);

  return {
    cleanup: () => {
      document.removeEventListener('keydown', keyPressHandler);
      document.removeEventListener('keyup', keyUpHandler);
      for (const [_, timeout] of Object.entries(keyHoldTimeouts)) {
        if (timeout && timeout !== true) clearTimeout(timeout);
      }
    },
    focusPath: () => focusPath,
  };
};
