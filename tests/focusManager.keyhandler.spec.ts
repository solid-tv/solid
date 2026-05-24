// Unit tests for the 1.3 key-handler consume contract.
//
// 1.3 flips the consume default: a handler that runs is considered to have
// consumed the event. To let the event continue bubbling up the focus path,
// the handler must explicitly `return false`. This is a behavior change
// from 1.2, where `return true` was required to consume.
//
// We test `_isHandlerConsumed` directly — it's the single point of truth
// for the consume signal in both `runCapturePhase` and `runBubblePhase`.

import { describe, it, expect } from 'vitest';
import { _isHandlerConsumed } from '../src/core/focusManager.ts';

describe('_isHandlerConsumed (1.3 key-handler consume contract)', () => {
  it('treats `return false` as not-consumed (bubble)', () => {
    expect(_isHandlerConsumed(false)).toBe(false);
  });

  it('treats `return undefined` as consumed (the default)', () => {
    expect(_isHandlerConsumed(undefined)).toBe(true);
  });

  it('treats `return true` as consumed (back-compat with 1.2 callers)', () => {
    // Handlers written against the 1.2 contract that did `return true` to
    // consume continue to work unchanged — `true !== false` is still
    // consumed under the new default.
    expect(_isHandlerConsumed(true)).toBe(true);
  });

  it('treats void / no-return-statement as consumed', () => {
    const handler = () => {
      // body does work, no explicit return
    };
    expect(_isHandlerConsumed(handler())).toBe(true);
  });

  it('treats non-boolean return values (number, string, object) as consumed', () => {
    // Only the literal `false` opts back into bubbling. Any truthy or
    // non-false falsy value (0, "", null) is still consumed.
    expect(_isHandlerConsumed(0)).toBe(true);
    expect(_isHandlerConsumed('')).toBe(true);
    expect(_isHandlerConsumed(null)).toBe(true);
    expect(_isHandlerConsumed(42)).toBe(true);
    expect(_isHandlerConsumed('handled')).toBe(true);
    expect(_isHandlerConsumed({})).toBe(true);
  });
});
