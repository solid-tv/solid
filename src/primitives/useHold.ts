import { createMemo } from 'solid-js';
import { suppressKeyUntilRelease } from '../core/focusManager.js';
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
   * `true` (default): a press with neither key-up nor auto-repeat by the
   * threshold resolves as a tap. `false`: it resolves as a hold, matching the
   * behavior of the removed `keyHoldOptions`.
   *
   * Set this to `false` for a key that emits no auto-repeat but does emit
   * key-up on real release: the timer alone can then resolve the hold. It does
   * *not* rescue a key that emits key-up immediately at press time (LG's Back
   * button does this) — that key-up cancels the timer before it fires, and no
   * setting can distinguish such a tap from a hold.
   */
  holdRequiresRepeat?: boolean;
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
 * - if neither key-up nor auto-repeat arrives, the timer resolves to a tap →
 *   `onEnter` after `holdThreshold` ms. This is the key-up-independent path that
 *   keeps taps working on webOS, at the cost of ~`holdThreshold` ms latency.
 *   Set `holdRequiresRepeat: false` to resolve this ambiguous case as a hold
 *   instead, on platforms that deliver no auto-repeat at all.
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
  const holdRequiresRepeat = createMemo(() => props.holdRequiresRepeat ?? true);

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
      if (repeated || !holdRequiresRepeat()) {
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
