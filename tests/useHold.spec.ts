import { createRoot } from 'solid-js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ElementNode } from '../src/core/elementNode.ts';

const suppressKeyUntilRelease =
  vi.fn<(e: KeyboardEvent | string | number, onRelease?: () => void) => void>();
vi.mock('../src/core/focusManager.ts', () => ({
  suppressKeyUntilRelease: (...args: unknown[]) =>
    (suppressKeyUntilRelease as (...a: unknown[]) => void)(...args),
}));

const { useHold } = await import('../src/primitives/useHold.ts');

const down = { key: 'Enter', repeat: false } as KeyboardEvent;
const downRepeat = { key: 'Enter', repeat: true } as KeyboardEvent;
const target = { id: 'target' } as unknown as ElementNode;
const handlerElm = { id: 'handlerElm' } as unknown as ElementNode;

function setup(props: Partial<Parameters<typeof useHold>[0]> = {}) {
  const onEnter = vi.fn();
  const onHold = vi.fn();
  const onRelease = vi.fn();
  let api!: ReturnType<typeof useHold>;
  const dispose = createRoot((d) => {
    api = useHold({ onEnter, onHold, onRelease, holdThreshold: 200, ...props });
    return d;
  });
  const [startHold, releaseHold] = api;
  return { startHold, releaseHold, onEnter, onHold, onRelease, dispose };
}

describe('useHold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    suppressKeyUntilRelease.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('fires onEnter immediately on key-up before the threshold (tap)', () => {
    const { startHold, releaseHold, onEnter, onHold, dispose } = setup();
    startHold();
    releaseHold();
    expect(onEnter).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(onHold).not.toHaveBeenCalled();
    dispose();
  });

  it('fires onEnter via the timer when key-up never arrives (webOS tap)', () => {
    const { startHold, onEnter, onHold, dispose } = setup();
    startHold(); // no releaseHold — key-up swallowed
    expect(onEnter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onHold).not.toHaveBeenCalled();
    dispose();
  });

  it('fires onHold (not onEnter) when held with auto-repeat', () => {
    const { startHold, releaseHold, onEnter, onHold, onRelease, dispose } =
      setup();
    startHold();
    startHold(downRepeat); // auto-repeat → key still held
    vi.advanceTimersByTime(200);
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();
    releaseHold();
    expect(onRelease).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('does not double-fire when key-up arrives after a hold', () => {
    const { startHold, releaseHold, onEnter, onHold, dispose } = setup();
    startHold();
    startHold(downRepeat);
    vi.advanceTimersByTime(200);
    releaseHold();
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();
    dispose();
  });

  it('recovers on the next press after a key-up-less hold', () => {
    const { startHold, releaseHold, onEnter, onHold, dispose } = setup();
    // First press: held, no key-up ever delivered.
    startHold();
    startHold(downRepeat);
    vi.advanceTimersByTime(200);
    expect(onHold).toHaveBeenCalledTimes(1);
    // Second press: a fresh tap with key-up must still work.
    startHold();
    releaseHold();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onHold).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('performOnEnterImmediately fires onEnter on key-down', () => {
    const { startHold, releaseHold, onEnter, dispose } = setup({
      performOnEnterImmediately: true,
    });
    startHold();
    expect(onEnter).toHaveBeenCalledTimes(1);
    releaseHold();
    expect(onEnter).toHaveBeenCalledTimes(1); // not double-fired
    dispose();
  });

  describe('holdRequiresRepeat', () => {
    it('resolves a repeat-less press as a tap by default', () => {
      const { startHold, onEnter, onHold, dispose } = setup();
      startHold(down); // no repeat, no key-up
      vi.advanceTimersByTime(200);
      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(onHold).not.toHaveBeenCalled();
      dispose();
    });

    it('resolves a repeat-less press as a hold when false', () => {
      const { startHold, onEnter, onHold, dispose } = setup({
        holdRequiresRepeat: false,
      });
      startHold(down); // platform delivers neither key-up nor auto-repeat
      vi.advanceTimersByTime(200);
      expect(onHold).toHaveBeenCalledTimes(1);
      expect(onEnter).not.toHaveBeenCalled();
      dispose();
    });

    it('still resolves an early key-up as a tap when false', () => {
      const { startHold, releaseHold, onEnter, onHold, dispose } = setup({
        holdRequiresRepeat: false,
      });
      startHold(down);
      releaseHold();
      expect(onEnter).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(200);
      expect(onHold).not.toHaveBeenCalled();
      dispose();
    });
  });

  describe('key suppression after a hold', () => {
    it('suppresses the held key and fires onRelease via the latch', () => {
      const { startHold, onHold, onRelease, dispose } = setup();
      startHold(down);
      startHold(downRepeat);
      vi.advanceTimersByTime(200);
      expect(onHold).toHaveBeenCalledTimes(1);
      expect(suppressKeyUntilRelease).toHaveBeenCalledTimes(1);
      expect(suppressKeyUntilRelease.mock.calls[0]![0]).toBe(down);

      // The element that owns the hold is no longer in the focus path, so its
      // key-up never arrives. The latch delivers the release instead.
      expect(onRelease).not.toHaveBeenCalled();
      suppressKeyUntilRelease.mock.calls[0]![1]!();
      expect(onRelease).toHaveBeenCalledTimes(1);
      dispose();
    });

    it('does not fire onRelease twice when key-up also reaches the element', () => {
      const { startHold, releaseHold, onRelease, dispose } = setup();
      startHold(down);
      startHold(downRepeat);
      vi.advanceTimersByTime(200);
      // focusManager lifts suppression first, then propagates the key-up.
      suppressKeyUntilRelease.mock.calls[0]![1]!();
      releaseHold();
      expect(onRelease).toHaveBeenCalledTimes(1);
      dispose();
    });

    it('does not suppress when the press resolves as a tap', () => {
      const { startHold, releaseHold, dispose } = setup();
      startHold(down);
      releaseHold();
      vi.advanceTimersByTime(200);
      expect(suppressKeyUntilRelease).not.toHaveBeenCalled();
      dispose();
    });
  });

  describe('callback context', () => {
    it('passes the key-down event and elements through to onEnter', () => {
      const { startHold, releaseHold, onEnter, dispose } = setup();
      startHold(down, target, handlerElm);
      releaseHold();
      expect(onEnter).toHaveBeenCalledWith(down, target, handlerElm);
      dispose();
    });

    it('replays the key-down context to a timer-resolved onEnter', () => {
      const { startHold, onEnter, dispose } = setup();
      startHold(down, target, handlerElm); // no key-up
      vi.advanceTimersByTime(200);
      expect(onEnter).toHaveBeenCalledWith(down, target, handlerElm);
      dispose();
    });

    it('replays the key-down context to onHold and onRelease', () => {
      const { startHold, onHold, onRelease, dispose } = setup();
      startHold(down, target, handlerElm);
      startHold(downRepeat);
      vi.advanceTimersByTime(200);
      expect(onHold).toHaveBeenCalledWith(down, target, handlerElm);
      suppressKeyUntilRelease.mock.calls[0]![1]!();
      expect(onRelease).toHaveBeenCalledWith(down, target, handlerElm);
      dispose();
    });
  });
});
