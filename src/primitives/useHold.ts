import { createMemo } from 'solid-js';

export type UseHoldProps = {
  onHold: () => void;
  onEnter: () => void;
  onRelease?: () => void;
  holdThreshold?: number;
  performOnEnterImmediately?: boolean;
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
 *
 * `performOnEnterImmediately` keeps the legacy behavior of firing `onEnter` on
 * key-down; a long-press then fires both `onEnter` and `onHold`.
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
 * @param {UseHoldProps} props - The properties for configuring the hold behavior.
 * @returns {[(e?: KeyboardEvent) => boolean, () => boolean]} A tuple containing `startHold` and `releaseHold` functions.
 */

export function useHold(props: UseHoldProps) {
  const holdThreshold = createMemo(() => props.holdThreshold ?? 550);
  const performOnEnterImmediately = createMemo(
    () => props.performOnEnterImmediately ?? false,
  );

  let holdTimeout = -1;
  let enterFired = false; // onEnter already fired for this press
  let holdFired = false; // onHold already fired for this press
  let repeated = false; // an auto-repeat key-down was seen (key still held)

  const reset = () => {
    if (holdTimeout !== -1) {
      clearTimeout(holdTimeout);
      holdTimeout = -1;
    }
    enterFired = false;
    holdFired = false;
    repeated = false;
  };

  const startHold = (e?: KeyboardEvent) => {
    // Auto-repeat key-down: the key is still held. Record it so the timer
    // resolves to a hold even if the key-up event never arrives (webOS).
    if (e?.repeat) {
      repeated = true;
      return true;
    }

    // Fresh key-down begins a new press. Reset first so a previous press whose
    // key-up was never delivered doesn't leave us wedged for this one.
    reset();

    if (performOnEnterImmediately()) {
      enterFired = true;
      props.onEnter();
    }

    holdTimeout = setTimeout(() => {
      holdTimeout = -1;
      if (repeated) {
        // Held past the threshold → hold gesture.
        holdFired = true;
        props.onHold();
      } else if (!enterFired) {
        // No key-up and no auto-repeat arrived: resolve as a tap so the
        // primary action still fires on remotes that swallow key-up.
        enterFired = true;
        props.onEnter();
      }
    }, holdThreshold()) as unknown as number;

    return true;
  };

  const releaseHold = () => {
    if (holdTimeout !== -1) {
      // Released before the threshold → tap. Fires immediately where key-up is
      // delivered, avoiding the timer latency.
      clearTimeout(holdTimeout);
      holdTimeout = -1;
      if (!enterFired) {
        enterFired = true;
        props.onEnter();
      }
    } else if (holdFired) {
      props.onRelease?.();
    }
    reset();
    return true;
  };

  return [startHold, releaseHold];
}

export default useHold;
