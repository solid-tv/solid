import {
  batch,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
} from 'solid-js';
import { Config, isDev } from './config.js';
import { IRendererNode } from './dom-renderer/domRendererTypes.js';
export type * from './focusKeyTypes.js';
import { ElementNode } from './elementNode.js';
import type { KeyNameOrKeyCode, KeyMap } from './focusKeyTypes.js';
import { isFunction } from './utils.js';
import {
  activeElement,
  setActiveElement as setActiveElementSignal,
} from './activeElement.js';

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

const keyOf = (e: KeyboardEvent): KeyNameOrKeyCode => e.key || e.keyCode;

const flattenKeyMap = (
  keyMap: Partial<KeyMap>,
  targetMap: KeyMapEntries,
): void => {
  for (const name in keyMap) {
    const value = keyMap[name];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        targetMap[value[i]!] = name;
      }
    } else if (value === null) {
      // Unmap every key mapped to this name, defaults included (B4). The
      // entry keyed by the name itself goes too, as it always did.
      for (const key in targetMap) {
        if (targetMap[key] === name) delete targetMap[key];
      }
      delete targetMap[name];
    } else {
      targetMap[value as KeyNameOrKeyCode] = name;
    }
  }
};

// The handler prop names dispatch looks up for one key, built once per mapped
// name (or per `e.key` of an unmapped key) so no event concatenates strings.
interface HandlerNames {
  /** `on<Name>`; undefined for an unmapped key, which only onKeyPress hears. */
  on: string | undefined;
  onRelease: string | undefined;
  onCapture: string;
  onCaptureRelease: string;
}

const mappedHandlerNames = new Map<string, HandlerNames>();
const unmappedHandlerNames = new Map<string, HandlerNames>();

const handlerNamesOf = (
  mappedEvent: string | undefined,
  key: string,
): HandlerNames => {
  const cache = mappedEvent ? mappedHandlerNames : unmappedHandlerNames;
  const base = mappedEvent || key;
  let names = cache.get(base);
  if (names === undefined) {
    names = {
      on: mappedEvent ? 'on' + base : undefined,
      onRelease: mappedEvent ? 'on' + base + 'Release' : undefined,
      onCapture: 'onCapture' + base,
      onCaptureRelease: 'onCapture' + base + 'Release',
    };
    cache.set(base, names);
  }
  return names;
};

// Raised the first time any node is given a prop that could be a capture or a
// release handler (the renderer's setProperty reports every `on…` name). Until
// then the capture walk and the key-up bubble walk cannot find a handler, so
// they are skipped. Never lowered.
let hasCaptureHandler = false;
let hasReleaseHandler = false;

/** @internal Called by the renderer's setProperty with every `on…` prop name. */
export const noteHandlerProp = (name: string): void => {
  if (!hasCaptureHandler && name.startsWith('onCapture')) {
    hasCaptureHandler = true;
  }
  if (!hasReleaseHandler && name.endsWith('Release')) {
    hasReleaseHandler = true;
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

/**
 * The key that triggered the most recent (non-throttled) propagation pass.
 * One record, updated in place: history entries copy its fields.
 */
const _pendingHistoryKey: {
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

/**
 * Built-in "apply focus" routine: diffs the focus path, fires
 * `onFocus`/`onBlur`/`onFocusChanged`, records history, then publishes the
 * active element through the `Config.setActiveElement` hook.
 *
 * This is what `ElementNode.setFocus()` ultimately invokes. It is intentionally
 * *not* the public `setActiveElement` export — that name is the raw signal
 * setter (see {@link ./activeElement.ts}). Keeping them separate is what stops
 * a custom `Config.setActiveElement` (wired to a setter) from recursing back
 * through the focus-path logic.
 */
export const setActiveElementCore = (elm: ElementNode) => {
  const prev = activeElement();
  if (elm === prev) return;
  _focusTarget = elm;
  _focusPrev = prev;
  // The whole focus phase runs in one batch (5.1): the callbacks keep their
  // order, and the effects their signal writes trigger, like those of
  // focusPath and the active element, run once, after the last of them.
  batch(applyFocus);
};

// The focus change setActiveElementCore hands to applyFocus, so the batch
// takes no closure. applyFocus reads both on entry.
let _focusTarget: ElementNode | undefined;
let _focusPrev: ElementNode | undefined;

const applyFocus = (): void => {
  const elm = _focusTarget!;
  const prev = _focusPrev;
  _focusTarget = _focusPrev = undefined;
  updateFocusPath(elm, prev);
  recordFocusHistory(elm, prev);
  // Reset key attribution so programmatic focus changes show '—' for key fields
  _pendingHistoryKey.keyPressed = undefined;
  _pendingHistoryKey.mappedKey = undefined;
  // Publish through the swappable hook rather than writing the signal directly,
  // so the active-element signal stays decoupled from this focus manager.
  Config.setActiveElement(elm);
};

export const [focusPath, setFocusPath] = createSignal<ElementNode[]>([]);

// Each focus change takes a new generation and stamps it on every node of the
// new path; a node of the previous path without that stamp lost focus. O(depth),
// no membership scan.
let focusGen = 0;
// The new path is built here, leaf first, then published as a copy: the
// signal's value must be a fresh array per change, since readers keep it.
const pathBuffer: ElementNode[] = [];
// True while updateFocusPath runs. A focus callback that calls
// setActiveElementCore re-enters it: the inner change builds its own array,
// and the outer one, whose stamps it overwrote, falls back to a scan.
let updatingPath = false;

const updateFocusPath = (
  currentFocusedElm: ElementNode,
  prevFocusedElm: ElementNode | undefined,
) => {
  const nested = updatingPath;
  updatingPath = true;
  try {
    buildFocusPath(currentFocusedElm, prevFocusedElm, nested ? [] : pathBuffer);
  } finally {
    updatingPath = nested;
  }
};

const buildFocusPath = (
  currentFocusedElm: ElementNode,
  prevFocusedElm: ElementNode | undefined,
  fp: ElementNode[],
) => {
  const focusKey = Config.focusStateKey;
  const gen = ++focusGen;
  let length = 0;
  let current: ElementNode | undefined = currentFocusedElm;
  while (current) {
    current._focusGen = gen;
    const states = current.states;
    if (!states.has(focusKey) || current === currentFocusedElm) {
      states.add(focusKey);
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
    fp[length++] = current;
    current = current.parent;
  }
  fp.length = length;

  const prevFp = focusPath();
  for (let i = 0; i < prevFp.length; i++) {
    const elm = prevFp[i]!;
    // focusGen moves on only when a callback changed focus re-entrantly.
    if (focusGen === gen ? elm._focusGen !== gen : fp.indexOf(elm) === -1) {
      elm.states.remove(focusKey);
      elm.onBlur?.call(elm, currentFocusedElm, prevFocusedElm!, elm);
      elm.onFocusChanged?.call(
        elm,
        false,
        currentFocusedElm,
        prevFocusedElm,
        elm,
      );
    }
  }

  const newFp = fp.slice();
  if (Config.focusDebug) {
    addFocusDebug(prevFp, newFp);
  }

  setFocusPath(newFp);
};

let lastGlobalKeyPressTime = 0;
let lastInputKey: string | number | undefined;

// Per-element throttleInput applies to key presses only, like the global
// Config.throttleInput: a release is never dropped and never starts a window
// (B3).
const isElementThrottled = (elm: ElementNode, currentTime: number): boolean => {
  const throttle = elm.throttleInput;
  if (throttle === undefined) return false;
  const last = elm._lastAnyKeyPressTime;
  return last !== undefined && currentTime - last < throttle;
};

// Walk focus path root→leaf. Returns true if a capture handler claimed the
// event (or, for a repeated press, an element on the path is rate-limited).
const runCapturePhase = (
  fp: ElementNode[],
  e: KeyboardEvent,
  mappedEvent: string | undefined,
  names: HandlerNames,
  isUp: boolean,
  checkThrottle: boolean,
  currentTime: number,
): boolean => {
  const finalFocusElm = fp[0]!;
  const capture = hasCaptureHandler;
  const captureEvent = isUp ? names.onCaptureRelease : names.onCapture;
  const captureKey = isUp ? 'onCaptureKeyRelease' : 'onCaptureKey';

  for (let i = fp.length - 1; i >= 0; i--) {
    const elm = fp[i]!;
    if (checkThrottle && isElementThrottled(elm, currentTime)) return true;
    if (!capture) continue;

    const captureHandler = elm[captureEvent] || elm[captureKey];
    if (
      isFunction(captureHandler) &&
      captureHandler.call(elm, e, elm, finalFocusElm, mappedEvent) === true
    ) {
      if (!isUp) elm._lastAnyKeyPressTime = currentTime;
      return true;
    }
  }
  return false;
};

// The last element runBubblePhase saw with *any* matching handler, for the
// no-handler debug log.
let lastHandlerSeen: ElementNode | undefined;

// Walk focus path leaf→root. Returns whether the event was handled.
const runBubblePhase = (
  fp: ElementNode[],
  e: KeyboardEvent,
  mappedEvent: string | undefined,
  names: HandlerNames,
  isUp: boolean,
  checkThrottle: boolean,
  currentTime: number,
): boolean => {
  const finalFocusElm = fp[0]!;
  const eventHandlerKey = isUp ? names.onRelease : names.on;
  lastHandlerSeen = undefined;

  for (let i = 0; i < fp.length; i++) {
    const elm = fp[i]!;
    if (checkThrottle && isElementThrottled(elm, currentTime)) return true;

    let handled = false;
    if (eventHandlerKey !== undefined) {
      const eventHandler = elm[eventHandlerKey];
      if (isFunction(eventHandler)) {
        lastHandlerSeen = elm;
        handled = eventHandler.call(elm, e, elm, finalFocusElm) === true;
      }
    }
    if (!handled && !isUp) {
      const fallbackHandler = elm.onKeyPress;
      if (isFunction(fallbackHandler)) {
        lastHandlerSeen = elm;
        handled =
          fallbackHandler.call(elm, e, mappedEvent, elm, finalFocusElm) ===
          true;
      }
    }

    if (handled) {
      if (!isUp) elm._lastAnyKeyPressTime = currentTime;
      return true;
    }
  }
  return false;
};

const propagateKeyPress = (
  e: KeyboardEvent,
  mappedEvent: string | undefined,
  isUp: boolean,
): boolean => {
  const currentTime = performance.now();
  const key = keyOf(e);
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
      // Dropped on purpose, so consumed: the same answer an element's own
      // throttleInput gives below, and what a host asking through
      // Config.preventDefaultOnHandledKeys needs to hear.
      return true;
    }
    lastGlobalKeyPressTime = currentTime;
  }

  // Keyup events don't trigger focus changes, so don't record their key.
  if (!isUp) {
    _pendingHistoryKey.keyPressed = key;
    _pendingHistoryKey.mappedKey = mappedEvent;
  }

  const fp = focusPath();
  if (fp.length === 0) return false;

  const names = handlerNamesOf(mappedEvent, e.key);
  // Only a repeat of the same key can be throttled, and only on key-down.
  const checkThrottle = !isUp && sameKey;

  // Each walk runs only when it could find something; when it runs, it is
  // the same walk in the same order.
  if (
    (hasCaptureHandler || checkThrottle) &&
    runCapturePhase(fp, e, mappedEvent, names, isUp, checkThrottle, currentTime)
  ) {
    return true;
  }
  if (isUp && !hasReleaseHandler) return false;
  const handled = runBubblePhase(
    fp,
    e,
    mappedEvent,
    names,
    isUp,
    checkThrottle,
    currentTime,
  );

  if (!handled && isDev && Config.keyDebug && !isUp) {
    const detail = `key="${e.key}", mappedEvent=${mappedEvent}, isUp=${isUp}`;
    if (lastHandlerSeen) {
      console.log(`Keypress bubbled, ${detail}`, lastHandlerSeen);
    } else {
      console.log(`No event handler available for keypress: ${detail}`);
    }
  }
  // Don't keep a node alive until the next key.
  lastHandlerSeen = undefined;

  return handled;
};

// `key` is not a stable identity for a physical key across key-down and key-up.
// webOS reports Back's key-down as { key: 'GoBack', keyCode: 461 } and its
// key-up as { key: 'Unidentified', keyCode: 461 } — same key, two names, with
// only the keyCode shared. So a key is identified by *every* name its event
// carries, and two events are the same key if any identity matches.
const UNIDENTIFIED = 'Unidentified';

// An event's two identities, read as two values so dispatch builds no array.
// 'Unidentified' names no particular key. Treating it as an identity would
// conflate every key that reports it.
const keyNameId = (e: KeyboardEvent): KeyNameOrKeyCode | undefined =>
  e.key && e.key !== UNIDENTIFIED ? e.key : undefined;
const keyCodeId = (e: KeyboardEvent): KeyNameOrKeyCode | undefined =>
  e.keyCode ? e.keyCode : undefined;

const keyIdentities = (
  keyOrEvent: KeyboardEvent | KeyNameOrKeyCode,
): KeyNameOrKeyCode[] => {
  if (typeof keyOrEvent !== 'object') return [keyOrEvent];
  const ids: KeyNameOrKeyCode[] = [];
  const name = keyNameId(keyOrEvent);
  if (name !== undefined) ids.push(name);
  const code = keyCodeId(keyOrEvent);
  if (code !== undefined) ids.push(code);
  return ids;
};

// Keys whose auto-repeat key-downs are dropped before propagation.
//
// A hold action typically moves focus (opening a context menu, say) while the
// key is still physically down. Two things then go wrong, and neither can be
// fixed by the element that owns the hold, because it is no longer in the focus
// path: the trailing auto-repeats propagate down the *new* focus path and fire
// whatever just took focus, and the key-up goes there too, so the owner's
// release handler never runs.
//
// Both are propagation concerns, so the latch lives here. The release callback
// is what lets a suppressor still learn about a key-up it can no longer receive
// through the focus path.
type Suppression = {
  ids: KeyNameOrKeyCode[];
  onRelease?: () => void;
};

// Indexed under every identity of the suppressed key, so a key-up naming the
// key differently still finds it. Entries for one key share a Suppression.
const suppressedKeys = new Map<KeyNameOrKeyCode, Suppression>();

// `name` and `code` are a key's identities (see keyNameId/keyCodeId), either
// one possibly undefined.
const findSuppression = (
  name: KeyNameOrKeyCode | undefined,
  code: KeyNameOrKeyCode | undefined,
): Suppression | undefined => {
  if (suppressedKeys.size === 0) return undefined;
  let found: Suppression | undefined;
  if (name !== undefined) found = suppressedKeys.get(name);
  if (found === undefined && code !== undefined) {
    found = suppressedKeys.get(code);
  }
  return found;
};

const liftSuppression = (
  name: KeyNameOrKeyCode | undefined,
  code: KeyNameOrKeyCode | undefined,
): void => {
  const found = findSuppression(name, code);
  if (!found) return;
  // Drop every alias, not just the one that matched.
  const ids = found.ids;
  for (let i = 0; i < ids.length; i++) suppressedKeys.delete(ids[i]!);
  found.onRelease?.();
};

/**
 * Drop auto-repeat key-downs for `keyOrEvent` until the key is released.
 *
 * Suppression is lifted by the key's key-up, or by the next fresh (non-repeat)
 * key-down — the latter so platforms that swallow key-up (webOS) can't wedge a
 * key permanently. Non-repeat key-downs are never suppressed. `onRelease` runs
 * when suppression lifts, whichever way it lifts, and is delivered regardless of
 * where focus has moved in the meantime.
 *
 * Pass the `KeyboardEvent` where you have one: the key is then matched on both
 * its name and its keyCode, which is what lets a key-up reporting a different
 * `key` for the same physical key (webOS Back) still lift the suppression.
 *
 * `useHold` calls this itself when a hold fires; call it directly only when
 * implementing hold behavior outside that primitive.
 */
export const suppressKeyUntilRelease = (
  keyOrEvent: KeyboardEvent | KeyNameOrKeyCode,
  onRelease?: () => void,
): void => {
  const ids = keyIdentities(keyOrEvent);
  if (ids.length === 0) return;
  const suppression: Suppression = { ids, onRelease };
  for (const id of ids) suppressedKeys.set(id, suppression);
};

/**
 * Lift suppression added by {@link suppressKeyUntilRelease} early, running its
 * release callback.
 */
export const releaseKeySuppression = (
  keyOrEvent: KeyboardEvent | KeyNameOrKeyCode,
): void => {
  if (typeof keyOrEvent !== 'object') liftSuppression(keyOrEvent, undefined);
  else liftSuppression(keyNameId(keyOrEvent), keyCodeId(keyOrEvent));
};

// Returns whether the app consumed the event: a handler took it, or the focus
// manager dropped it on purpose (a suppressed repeat, a throttled press).
const handleKeyEvents = (
  keydown?: KeyboardEvent,
  keyup?: KeyboardEvent,
): boolean => {
  if (keydown) {
    const name = keyNameId(keydown);
    const code = keyCodeId(keydown);
    if (keydown.repeat) {
      if (findSuppression(name, code)) return true;
    } else {
      // A fresh press starts a new gesture, so the previous one is over even
      // though its key-up never arrived. Settle it before handling this press.
      liftSuppression(name, code);
    }

    return propagateKeyPress(
      keydown,
      keyMapEntries[keydown.key] || keyMapEntries[keydown.keyCode],
      false,
    );
  }
  if (keyup) {
    // The key is up: whatever was suppressing its repeats is done. Settle it
    // before propagating, so a suppressor that is still in the focus path sees
    // its own release callback rather than a second one via the key-up below.
    liftSuppression(keyNameId(keyup), keyCodeId(keyup));

    return propagateKeyPress(
      keyup,
      keyMapEntries[keyup.key] || keyMapEntries[keyup.keyCode],
      true,
    );
  }
  return false;
};

/**
 * What the focus manager reads off a key event. A browser's `KeyboardEvent`
 * has these; a host without a DOM raises objects that carry at least them,
 * and key handlers receive whichever object the host raised.
 */
export interface KeyEventLike {
  readonly key: string;
  readonly keyCode: number;
  readonly repeat: boolean;
  /**
   * Called on an event the app consumed when
   * `Config.preventDefaultOnHandledKeys` is set; optional, since a host's
   * own event objects need not have it.
   */
  preventDefault?(): void;
}

/**
 * Where {@link useFocusManager} listens for `keydown` and `keyup`: `document`
 * in a browser, or anything with the same two methods on a host without one,
 * such as a native key bridge.
 */
export interface KeyEventTarget {
  addEventListener(
    type: 'keydown' | 'keyup',
    listener: (event: KeyEventLike) => void,
  ): void;
  removeEventListener(
    type: 'keydown' | 'keyup',
    listener: (event: KeyEventLike) => void,
  ): void;
}

// The element Config.setActiveElement (as useFocusManager sets it) hands to
// publishActiveElement, so a focus change allocates no closure.
let _activeToPublish: ElementNode | undefined;

const publishActiveElement = (): void => {
  setActiveElementSignal(_activeToPublish);
};

// The event being dispatched, handed to dispatchKeyDown/dispatchKeyUp so a key
// event allocates no closure. Each reads it on entry, so a handler that raises
// another key event cannot disturb the one in progress.
let _dispatchEvent: KeyEventLike | undefined;

// Handlers are typed as KeyboardEvent throughout; on a host that raises its
// own objects they see those, which carry the fields read here.
const dispatchKeyDown = (): void => {
  const event = _dispatchEvent!;
  if (
    handleKeyEvents(event as KeyboardEvent, undefined) &&
    Config.preventDefaultOnHandledKeys
  ) {
    event.preventDefault?.();
  }
};

const dispatchKeyUp = (): void => {
  const event = _dispatchEvent!;
  if (
    handleKeyEvents(undefined, event as KeyboardEvent) &&
    Config.preventDefaultOnHandledKeys
  ) {
    event.preventDefault?.();
  }
};

export const useFocusManager = (
  userKeyMap?: Partial<KeyMap>,
  target?: KeyEventTarget,
) => {
  if (userKeyMap) {
    flattenKeyMap(userKeyMap, keyMapEntries);
  }

  // Before the target parameter existed the second argument was ignored, and
  // an object that cannot listen (the removed hold options, say) still is.
  const eventTarget: KeyEventTarget =
    target !== undefined && isFunction(target.addEventListener)
      ? target
      : document;

  // Capture the calling owner so signal updates and key-event reactions
  // can run inside it — needed for programmatic .setFocus(), post-mutation
  // focus, and any effect subscribers that rely on onCleanup.
  const owner = getOwner();
  // Drive the active-element signal inside this owner so its effect subscribers
  // have a parent for cleanup. Consumers replacing the focus manager can wire
  // Config.setActiveElement themselves instead of calling useFocusManager.
  Config.setActiveElement = (elm) => {
    _activeToPublish = elm;
    runWithOwner(owner, publishActiveElement);
    _activeToPublish = undefined;
  };

  // Key handlers run inside the owner too: runWithOwner batches their signal
  // writes, so effects run once, after the handler.
  const keyPressHandler = (event: KeyEventLike) => {
    _dispatchEvent = event;
    runWithOwner(owner, dispatchKeyDown);
    _dispatchEvent = undefined;
  };
  const keyUpHandler = (event: KeyEventLike) => {
    _dispatchEvent = event;
    runWithOwner(owner, dispatchKeyUp);
    _dispatchEvent = undefined;
  };

  eventTarget.addEventListener('keydown', keyPressHandler);
  eventTarget.addEventListener('keyup', keyUpHandler);

  onCleanup(() => {
    eventTarget.removeEventListener('keydown', keyPressHandler);
    eventTarget.removeEventListener('keyup', keyUpHandler);
    suppressedKeys.clear();
  });
};
