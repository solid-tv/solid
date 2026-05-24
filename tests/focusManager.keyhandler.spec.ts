// Unit tests for the new key-handler consume contract introduced in 1.3.
//
// 1.3 contract: handlers call `e.stopPropagation()` to consume an event and
// stop it from bubbling up the focus path. The legacy contract (return `true`
// to consume) still works in 1.3, with a one-time dev-mode warning per
// handler. Both are removed in 1.4 (warning + boolean return).
//
// We test the small `_isHandlerConsumed` helper directly rather than driving
// the whole focus-manager dispatch path — the helper is the single point of
// truth for the consume signal, and exercising it in isolation keeps the
// blast radius of focus-system regressions contained.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _isHandlerConsumed } from '../src/core/focusManager.ts';
import { ElementNode } from '../src/core/elementNode.ts';

const makeEvent = (): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });

const makeElm = (): ElementNode => new ElementNode('view');

describe('_isHandlerConsumed (1.3 key-handler consume contract)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // _isHandlerConsumed inspects post-handler state — callers invoke the
  // handler first and pass in the (event, result) pair. These tests mirror
  // that contract.
  const runHandler = <R>(
    handler: (e: KeyboardEvent) => R,
    e: KeyboardEvent = makeEvent(),
  ): { e: KeyboardEvent; result: R } => ({ e, result: handler(e) });

  it('returns true when the handler called e.stopPropagation()', () => {
    const elm = makeElm();
    const handler = (ev: KeyboardEvent) => ev.stopPropagation();
    const { e, result } = runHandler(handler);
    expect(_isHandlerConsumed(e, result, 'onEnter', handler, elm)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns false when the handler returned undefined and did not stopPropagation', () => {
    const elm = makeElm();
    const handler = () => {};
    const { e, result } = runHandler(handler);
    expect(_isHandlerConsumed(e, result, 'onEnter', handler, elm)).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns false when the handler returned false', () => {
    const elm = makeElm();
    const handler = () => false;
    const { e, result } = runHandler(handler);
    expect(_isHandlerConsumed(e, result, 'onEnter', handler, elm)).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns true and warns once when the handler returned the deprecated `true`', () => {
    const elm = makeElm();
    const handler = () => true;
    const { e, result } = runHandler(handler);
    expect(_isHandlerConsumed(e, result, 'onEnter', handler, elm)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/deprecated/i);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/onEnter/);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/stopPropagation/);
  });

  it('warns only once per handler function across multiple events', () => {
    const elm = makeElm();
    const handler = () => true;
    for (let i = 0; i < 3; i++) {
      const { e, result } = runHandler(handler);
      _isHandlerConsumed(e, result, 'onEnter', handler, elm);
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('warns separately for distinct handler functions', () => {
    const elm = makeElm();
    const handlerA = () => true;
    const handlerB = () => true;
    {
      const { e, result } = runHandler(handlerA);
      _isHandlerConsumed(e, result, 'onEnter', handlerA, elm);
    }
    {
      const { e, result } = runHandler(handlerB);
      _isHandlerConsumed(e, result, 'onEnter', handlerB, elm);
    }
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('does not warn when handler both called stopPropagation AND returned true', () => {
    // Defensive: a handler ported mid-migration may do both. The modern
    // signal short-circuits the legacy check, so no warning fires.
    const elm = makeElm();
    const handler = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      return true;
    };
    const { e, result } = runHandler(handler);
    expect(_isHandlerConsumed(e, result, 'onEnter', handler, elm)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats stopPropagation as sticky across the focus path on the same event', () => {
    // Simulates the leaf→root loop: one event reused, leaf consumed it via
    // stopPropagation. The bubble loop in runBubblePhase checks the helper
    // on the parent's handler result; cancelBubble persists on the event,
    // so the parent's check short-circuits to consumed even if the parent
    // handler did nothing.
    const e = makeEvent();
    const leaf = makeElm();
    const parent = makeElm();
    const leafHandler = (ev: KeyboardEvent) => ev.stopPropagation();
    const parentHandler = () => {};
    const leafResult = leafHandler(e);
    expect(
      _isHandlerConsumed(e, leafResult, 'onEnter', leafHandler, leaf),
    ).toBe(true);
    const parentResult = parentHandler();
    expect(
      _isHandlerConsumed(e, parentResult, 'onEnter', parentHandler, parent),
    ).toBe(true);
  });
});
