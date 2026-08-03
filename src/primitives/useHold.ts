import { createMemo } from 'solid-js';
import {
  suppressKeyUntilRelease,
  keyDeliversKeyUp,
  noteKeyUpDelivered,
} from '../core/focusManager.js';
import type { ElementNode } from '../core/elementNode.js';

/**
 * A hold callback. Receives the `KeyboardEvent` that began the press, the
 * element whose handler was invoked, and the focused (leaf) element at that
 * moment — the same arguments a `KeyHandler` gets. All three are `undefined`
 * when `startHold` was called without them.
 */
export type HoldCallback = (
  e?: KeyboardEvent,
  target?: ElementNode,
  handlerElm?: ElementNode,
) => void;

export type HoldHandler = (
  e?: KeyboardEvent,
  target?: ElementNode,
  handlerElm?: ElementNode,
) => boolean;

export type UseHoldProps = {
  onHold: HoldCallback;
  onEnter: HoldCallback;
  onRelease?: HoldCallback;
  holdThreshold?: number;
  performOnEnterImmediately?: boolean;
  /**
   * Whether a hold must be confirmed by an auto-repeat key-down.
   *
   * - `'auto'` (default): use auto-repeat if the key needs it, otherwise resolve
   *   by timer. A key that has been seen delivering key-up needs no auto-repeat —
   *   reaching the threshold without a key-up means it is still down. A key that
   *   swallows key-up does need one, since a finished press is otherwise
   *   indistinguishable from one still held.
   * - `false`: always resolve by timer, matching the legacy `keyHoldOptions`
   *   behavior. Deterministic from the very first press.
   * - `true`: require an auto-repeat, never resolving a repeat-less press as a
   *   hold.
   *
   * `'auto'` infers from keys seen earlier in the session, so the first press of
   * a key resolves as a tap. Set this explicitly for a key you already know —
   * e.g. `false` for Back on webOS, which emits no auto-repeat.
   */
  holdRequiresRepeat?: boolean | 'auto';
};

/**
 * Distinguishes a tap from a press-and-hold for a single key, without depending
 * on the key-up event. This matters on TV platforms (notably LG webOS) where the
 * OK button does not reliably emit a key-up, so any tap logic gated on key-up
 * (`onEnterRelease`) would never run and the card would never open.
 *
 * How a press resolves:
 * - key-down starts the hold timer.
 * - an auto-repeat key-down before the timer fires marks the key as still held;
 *   when the timer fires it resolves to a hold → `onHold`.
 * - if key-up arrives before the timer, it's a tap → `onEnter` (fires
 *   immediately, no latency, on platforms that deliver key-up).
 * - if the timer fires with neither, the key is either still held or already
 *   released with its key-up swallowed. `holdRequiresRepeat` decides which, and
 *   by default (`'auto'`) infers it: a key known to deliver key-up must still be
 *   down, so it resolves to a hold by timer alone; a key that swallows key-up
 *   resolves to a tap, keeping the primary action working on webOS OK at the
 *   cost of ~`holdThreshold` ms latency.
 *
 * Auto-repeat is therefore used where it exists and not required where it does
 * not — webOS emits it for OK but not for Back, so Back holds resolve by timer
 * while OK holds are confirmed by repeat.
 *
 * Once `onHold` fires the key is still physically down, so the focus manager
 * drops its remaining auto-repeats until it is released. Without that, a hold
 * that moves focus — the canonical case, opening a context menu — would have
 * its trailing repeats fire whatever it just focused. The same latch delivers
 * `onRelease` even though the key-up now propagates somewhere else entirely.
 *
 * `performOnEnterImmediately` keeps the legacy behavior of firing `onEnter` on
 * key-down; a long-press then fires both `onEnter` and `onHold`.
 *
 * Note that `startHold` returns `true`, which ends the bubble phase: ancestor
 * handlers for that key will not run, and whether the press was a tap isn't
 * known until after propagation is over. If an ancestor performs navigation,
 * invoke it from `onEnter` yourself. See the caveat in the docs.
 *
 * @example
 * const [holdRight, releaseRight] = useHold({
 *   onHold: handleHoldRight,
 *   onEnter: handleOnRight,
 *   onRelease: handleReleaseHold,
 *   holdThreshold: 200,
 * });
 *
 * <view
 *   onRight={holdRight}
 *   onRightRelease={releaseRight}
 * />
 *
 * `startHold` reads `e.repeat` to detect a hold. Used directly as a `KeyHandler`
 * (above) it gets the event; if you wrap it, forward all of the arguments, or
 * hold detection silently never triggers.
 *
 * @param {UseHoldProps} props - The properties for configuring the hold behavior.
 * @returns {[HoldHandler, HoldHandler]} A tuple of `startHold` and `releaseHold`.
 */

export function useHold(props: UseHoldProps): [HoldHandler, HoldHandler] {
  const holdThreshold = createMemo(() => props.holdThreshold ?? 500);
  const performOnEnterImmediately = createMemo(
    () => props.performOnEnterImmediately ?? false,
  );
  const holdRequiresRepeat = createMemo(
    () => props.holdRequiresRepeat ?? 'auto',
  );

  // At the threshold with no auto-repeat seen, is this press still held (a hold)
  // or already over with its key-up swallowed (a tap)? Only a key that delivers
  // key-up can answer that on its own.
  const requiresRepeat = (e: KeyboardEvent | undefined) => {
    const mode = holdRequiresRepeat();
    if (mode !== 'auto') return mode;
    return !(e !== undefined && keyDeliversKeyUp(e));
  };

  let holdTimeout = -1;
  let enterFired = false; // onEnter already fired for this press
  let holdFired = false; // onHold already fired for this press
  let repeated = false; // an auto-repeat key-down was seen (key still held)

  // Context from the key-down that began the press, replayed to whichever
  // callback resolves it — the timer path has no event of its own, and after a
  // focus-moving hold neither does the release.
  let press: Parameters<HoldCallback> = [];

  const reset = () => {
    if (holdTimeout !== -1) {
      clearTimeout(holdTimeout);
      holdTimeout = -1;
    }
    enterFired = false;
    holdFired = false;
    repeated = false;
    press = [];
  };

  const fireRelease = () => {
    if (!holdFired) return;
    const args = press;
    reset(); // before the callback, so a re-entrant press isn't clobbered
    props.onRelease?.(...args);
  };

  const startHold: HoldHandler = (e, target, handlerElm) => {
    // Auto-repeat key-down: the key is still held. Record it so the timer
    // resolves to a hold even if the key-up event never arrives (webOS).
    if (e?.repeat) {
      repeated = true;
      return true;
    }

    // Fresh key-down begins a new press. Reset first so a previous press whose
    // key-up was never delivered doesn't leave us wedged for this one.
    reset();
    press = [e, target, handlerElm];

    if (performOnEnterImmediately()) {
      enterFired = true;
      props.onEnter(...press);
    }

    holdTimeout = setTimeout(() => {
      holdTimeout = -1;
      if (repeated || !requiresRepeat(e)) {
        // Held past the threshold → hold gesture.
        holdFired = true;
        // The key is still down and will keep repeating. Drop those repeats so
        // they can't reach whatever onHold focuses, and route the key-up back
        // here even if this element is no longer in the focus path.
        if (e) suppressKeyUntilRelease(e, fireRelease);
        props.onHold(...press);
      } else if (!enterFired) {
        // No key-up and no auto-repeat arrived: resolve as a tap so the
        // primary action still fires on remotes that swallow key-up.
        enterFired = true;
        props.onEnter(...press);
      }
    }, holdThreshold()) as unknown as number;

    return true;
  };

  const releaseHold: HoldHandler = (e, target, handlerElm) => {
    // Reaching here at all is proof this key delivers key-up, which is what
    // `'auto'` reads. The focus manager records this too; doing it here as well
    // keeps `'auto'` working behind a custom focus manager.
    if (e) noteKeyUpDelivered(e);

    if (holdTimeout !== -1) {
      // Released before the threshold → tap. Fires immediately where key-up is
      // delivered, avoiding the timer latency.
      clearTimeout(holdTimeout);
      holdTimeout = -1;
      if (!enterFired) {
        enterFired = true;
        props.onEnter(
          e ?? press[0],
          target ?? press[1],
          handlerElm ?? press[2],
        );
      }
      reset();
    } else {
      // After a hold, the suppression latch has usually already fired onRelease
      // and reset — `holdFired` is false and this is a no-op.
      fireRelease();
      reset();
    }
    return true;
  };

  return [startHold, releaseHold];
}

export default useHold;
