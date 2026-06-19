import { createRoot } from 'solid-js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useHold } from '../src/primitives/useHold.ts';

const downRepeat = { repeat: true } as KeyboardEvent;

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
  beforeEach(() => vi.useFakeTimers());
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
});
