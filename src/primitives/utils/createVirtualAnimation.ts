import * as lng from '../../index.js';

export type VirtualAnimation = {
  /**
   * Drive an animated shift of the container element.
   *
   * Call this inside a queueMicrotask, after elm.updateLayout(), when shiftBy != 0.
   *
   * @param el          - The container NavigableElement (the virtual list's view node).
   * @param prevScreenPos - (targetPosition ?? el[axis]) + active[axis], captured BEFORE updateLayout.
   * @param active      - The newly focused child element, read AFTER updateLayout.
   * @param childSize   - Pixel size of one item (including gap) for the shift calculation.
   * @param shiftBy     - Number of item-widths to animate (-1 = shift back one item, +1 = forward).
   */
  start: (
    el: lng.ElementNode,
    prevScreenPos: number,
    active: lng.ElementNode,
    childSize: number,
    shiftBy: number,
  ) => void;

  /** Returns the current animation target position (undefined before first animation). */
  getTargetPosition: () => number | undefined;

  /**
   * Call once at mount (or after wrap init) to record the container's baseline position.
   * @param el     - The container element.
   * @param offset - Optional pixel offset to add to el.lng[axis] (used for wrap pre-offset).
   */
  initOrigin: (el: lng.ElementNode, offset?: number) => void;

  /** Snap the element back to its recorded origin. Used before a scrollToIndex jump. */
  resetToOrigin: (el: lng.ElementNode) => void;

  /** Returns whether an origin position has been recorded. */
  hasOrigin: () => boolean;
};

export function createVirtualAnimation(axis: 'x' | 'y'): VirtualAnimation {
  let originalPosition: number | undefined;
  let targetPosition: number | undefined;
  let cachedController: { state: string; stop(): void } | undefined;
  let lastNavTime = 0;

  function getAdaptiveDuration(duration: number): number {
    const now = performance.now();
    const elapsed = now - lastNavTime;
    lastNavTime = now;
    return elapsed < duration ? elapsed : duration;
  }

  return {
    start(el, prevScreenPos, active, childSize, shiftBy) {
      if (cachedController?.state === 'running') {
        cachedController.stop();
      }

      if (lng.Config.animationsEnabled) {
        el.lng[axis] = prevScreenPos - active[axis];
        targetPosition = el.lng[axis] + childSize * shiftBy;
        cachedController = el
          .animate(
            { [axis]: targetPosition },
            {
              ...el.animationSettings,
              duration: getAdaptiveDuration(
                el.animationSettings?.duration ?? 250,
              ),
            },
          )
          .start();
      } else {
        el.lng[axis] = (el.lng[axis] ?? 0) + childSize * shiftBy;
      }
    },

    getTargetPosition: () => targetPosition,

    initOrigin(el, offset = 0) {
      originalPosition = (el.lng[axis] ?? 0) + offset;
      targetPosition = originalPosition;
    },

    resetToOrigin(el) {
      if (originalPosition !== undefined) {
        el.lng[axis] = originalPosition;
        targetPosition = originalPosition;
      }
    },

    hasOrigin: () => originalPosition !== undefined,
  };
}
