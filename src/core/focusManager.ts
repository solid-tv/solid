import { createSignal, getOwner, onCleanup, runWithOwner } from 'solid-js';
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
      // Unmap every key mapped to this name, defaults included (B4). The
      // entry keyed by the name itself goes too, as it always did.
      for (const mapped in newTargetMap) {
        if (newTargetMap[mapped] === key) delete newTargetMap[mapped];
      }
      delete newTargetMap[key];
    } else {
      newTargetMap[value as KeyNameOrKeyCode] = key;
    }
  }
  return newTargetMap;
};

// The handler prop names dispatch looks up for one key, built at the key's
// first event (per mapped name, or per `e.key` of an unmapped key) so that no
// event concatenates strings.
interface HandlerNames {
  /** `on<Name>`; undefined for an unmapped key, which only onKeyPress hears. */
  on: string | undefined;
  onRelease: string | undefined;
  onCapture: string;
  onCaptureRelease: string;
}

const mappedHandlerNames = new Map<string, HandlerNames>();
const unmappedHandlerNames = new Map<string, HandlerNames>();

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

const updateFocusPath = (
  currentFocusedElm: ElementNode,
  prevFocusedElm: ElementNode | undefined,
) => {
  let current: ElementNode | undefined = currentFocusedElm;
  // fp escapes through the focusPath signal, so it must be a fresh array; the
  // membership test below runs on paths of a handful of elements every single
  // keypress, where a linear scan beats allocating and hashing a Set.
  const fp: ElementNode[] = [];
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
    current = current.parent;
  }

  const prevFp = focusPath();
  for (let i = 0; i < prevFp.length; i++) {
    const elm = prevFp[i]!;
    if (fp.indexOf(elm) === -1) {
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
  }

  if (Config.focusDebug) {
    addFocusDebug(prevFp, fp);
  }

  _signalWrapper(() => setFocusPath(fp));
};

let lastGlobalKeyPressTime = 0;
let lastInputKey: string | number | undefined;

// Per-element throttleInput applies to key presses only, like the global
// Config.throttleInput: a release is never dropped and never starts a window
// (B3).
const isElementThrottled = (
  elm: ElementNode,
  sameKey: boolean,
  currentTime: number,
): boolean =>
  elm.throttleInput !== undefined &&
  sameKey &&
  elm._lastAnyKeyPressTime !== undefined &&
  currentTime - elm._lastAnyKeyPressTime < elm.throttleInput;

const propagateKeyPress = (
  e: KeyboardEvent,
  mappedEvent?: string,
  isUp: boolean = false,
): boolean => {
  const currentTime = performance.now();
  const key: KeyNameOrKeyCode = e.key || e.keyCode;
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

  // The handler prop names for this key, built at its first event. This and
  // the two walks below are written out here rather than in helpers: a
  // helper with this one call site becomes a closure per event under
  // terser's default reduce_funcs.
  const keyBase = mappedEvent || e.key;
  const names = mappedEvent ? mappedHandlerNames : unmappedHandlerNames;
  let handlerNames = names.get(keyBase);
  if (handlerNames === undefined) {
    handlerNames = {
      on: mappedEvent ? 'on' + keyBase : undefined,
      onRelease: mappedEvent ? 'on' + keyBase + 'Release' : undefined,
      onCapture: 'onCapture' + keyBase,
      onCaptureRelease: 'onCapture' + keyBase + 'Release',
    };
    names.set(keyBase, handlerNames);
  }

  // Capture phase: walk the focus path root→leaf. A capture handler that
  // returns true claims the event, as does an element that is rate-limited.
  let finalFocusElm = fp[0]!;
  const captureEvent = isUp
    ? handlerNames.onCaptureRelease
    : handlerNames.onCapture;
  const captureKey = isUp ? 'onCaptureKeyRelease' : 'onCaptureKey';

  for (let i = fp.length - 1; i >= 0; i--) {
    const elm = fp[i]!;
    if (!isUp && isElementThrottled(elm, sameKey, currentTime)) return true;

    const captureHandler = elm[captureEvent] || elm[captureKey];
    if (
      isFunction(captureHandler) &&
      captureHandler.call(elm, e, elm, finalFocusElm, mappedEvent) === true
    ) {
      if (!isUp) elm._lastAnyKeyPressTime = currentTime;
      return true;
    }
  }

  // Bubble phase: walk the focus path leaf→root, reading its leaf again as
  // the capture phase did. lastHandlerSeen is the last element that had
  // *any* matching handler, for the no-handler debug log.
  finalFocusElm = fp[0]!;
  const eventHandlerKey = isUp ? handlerNames.onRelease : handlerNames.on;
  let lastHandlerSeen: ElementNode | undefined;

  for (let i = 0; i < fp.length; i++) {
    const elm = fp[i]!;
    if (!isUp && isElementThrottled(elm, sameKey, currentTime)) return true;

    let handled = false;
    if (eventHandlerKey) {
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

  if (isDev && Config.keyDebug && !isUp) {
    const detail = `key="${e.key}", mappedEvent=${mappedEvent}, isUp=${isUp}`;
    if (lastHandlerSeen) {
      console.log(`Keypress bubbled, ${detail}`, lastHandlerSeen);
    } else {
      console.log(`No event handler available for keypress: ${detail}`);
    }
  }

  return false;
};

// `key` is not a stable identity for a physical key across key-down and key-up.
// webOS reports Back's key-down as { key: 'GoBack', keyCode: 461 } and its
// key-up as { key: 'Unidentified', keyCode: 461 } — same key, two names, with
// only the keyCode shared. So a key is identified by *every* name its event
// carries, and two events are the same key if any identity matches.
const UNIDENTIFIED = 'Unidentified';

// An event's two identities, read as two values so that key dispatch builds
// no array; undefined when the event does not carry that one.
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

// The suppression of an event's key: looked up under its name, then its
// keyCode (keyNameId, keyCodeId), either of which may be undefined.
const findSuppression = (
  name: KeyNameOrKeyCode | undefined,
  code: KeyNameOrKeyCode | undefined,
): Suppression | undefined => {
  let found: Suppression | undefined;
  if (name !== undefined) found = suppressedKeys.get(name);
  if (found === undefined && code !== undefined) {
    found = suppressedKeys.get(code);
  }
  return found;
};

const liftSuppression = (found: Suppression | undefined): void => {
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
  liftSuppression(
    typeof keyOrEvent !== 'object'
      ? suppressedKeys.get(keyOrEvent)
      : findSuppression(keyNameId(keyOrEvent), keyCodeId(keyOrEvent)),
  );
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
      liftSuppression(findSuppression(name, code));
    }

    return propagateKeyPress(
      keydown,
      keyMapEntries[keydown.key] || keyMapEntries[keydown.keyCode],
    );
  }
  if (keyup) {
    // The key is up: whatever was suppressing its repeats is done. Settle it
    // before propagating, so a suppressor that is still in the focus path sees
    // its own release callback rather than a second one via the key-up below.
    liftSuppression(findSuppression(keyNameId(keyup), keyCodeId(keyup)));

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

// The key event being dispatched, handed to dispatchKeyDown/dispatchKeyUp so
// that a key event allocates no closure. Each takes it on entry, so a handler
// that raises another key event cannot disturb the one in progress.
let _dispatchEvent: KeyEventLike | undefined;

// Handlers are typed as KeyboardEvent throughout; on a host that raises its
// own objects they see those, which carry the fields read here.
const dispatchKeyDown = (): void => {
  const event = _dispatchEvent!;
  _dispatchEvent = undefined;
  if (
    handleKeyEvents(event as KeyboardEvent, undefined) &&
    Config.preventDefaultOnHandledKeys
  ) {
    event.preventDefault?.();
  }
};

const dispatchKeyUp = (): void => {
  const event = _dispatchEvent!;
  _dispatchEvent = undefined;
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
  const ownerContext = (cb: () => void) => {
    runWithOwner(owner, cb);
  };
  _signalWrapper = ownerContext;
  // Drive the active-element signal inside this owner so its effect subscribers
  // have a parent for cleanup. Consumers replacing the focus manager can wire
  // Config.setActiveElement themselves instead of calling useFocusManager.
  Config.setActiveElement = (elm) =>
    ownerContext(() => setActiveElementSignal(elm));

  // One listener per event type, run inside the owner like ownerContext,
  // with no closure per event.
  const keyPressHandler = (event: KeyEventLike) => {
    _dispatchEvent = event;
    runWithOwner(owner, dispatchKeyDown);
  };
  const keyUpHandler = (event: KeyEventLike) => {
    _dispatchEvent = event;
    runWithOwner(owner, dispatchKeyUp);
  };

  eventTarget.addEventListener('keydown', keyPressHandler);
  eventTarget.addEventListener('keyup', keyUpHandler);

  onCleanup(() => {
    eventTarget.removeEventListener('keydown', keyPressHandler);
    eventTarget.removeEventListener('keyup', keyUpHandler);
    suppressedKeys.clear();
  });
};
