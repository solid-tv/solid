import { describe, expect, it, vi } from 'vitest';
import { RendererCore } from '@solidtv/renderer';
import { ElementNode } from '../../src/core/node/ElementNode.js';
import { NodeType } from '../../src/core/nodeTypes.js';

const headless = () => new RendererCore({ appWidth: 640, appHeight: 360 });

describe('ElementNode events', () => {
  it('on, emit, off, removeAllListeners', () => {
    const node = new ElementNode(headless(), NodeType.Element);
    expect(node.hasListener('loaded')).toBe(false);
    const fn = vi.fn();
    node.on('loaded', fn);
    expect(node.hasListener('loaded')).toBe(true);
    expect(node.hasListener('failed')).toBe(false);
    const payload = { type: 'texture', dimensions: { width: 1, height: 1 } };
    node.emit('loaded', payload);
    expect(fn).toHaveBeenCalledWith(node, payload);
    node.off('loaded', fn);
    expect(node.hasListener('loaded')).toBe(false);
    node.emit('loaded', payload);
    expect(fn).toHaveBeenCalledTimes(1);
    node.on('loaded', fn);
    node.on('failed', fn);
    node.removeAllListeners();
    expect(node.hasListener('loaded')).toBe(false);
    expect(node.hasListener('failed')).toBe(false);
  });

  it('an event name the prototype has is no listener', () => {
    const node = new ElementNode(headless(), NodeType.Element);
    node.on('loaded', () => {});
    expect(node.hasListener('toString')).toBe(false);
    expect(() => node.emit('constructor', null)).not.toThrow();
  });

  it('the onEvent prop registers each key and reads back', () => {
    const node = new ElementNode(headless(), NodeType.Element);
    const loaded = vi.fn();
    const failed = vi.fn();
    const events = { loaded, failed };
    node.onEvent = events;
    expect(node.onEvent).toBe(events);
    expect(node.hasListener('loaded')).toBe(true);
    expect(node.hasListener('failed')).toBe(true);
    node.emit('failed', 'boom');
    expect(failed).toHaveBeenCalledWith(node, 'boom');
    // The handler runs with the node as `this`, as the 1.x registration did.
    expect(failed.mock.contexts[0]).toBe(node);
    // A new object replaces the previous one's handlers, not others.
    const other = vi.fn();
    node.on('loaded', other);
    const inViewport = vi.fn();
    node.onEvent = { inViewport };
    expect(node.hasListener('failed')).toBe(false);
    expect(node.hasListener('inViewport')).toBe(true);
    node.emit('loaded', null);
    expect(loaded).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
    node.onEvent = undefined;
    expect(node.hasListener('inViewport')).toBe(false);
    expect(node.hasListener('loaded')).toBe(true);
  });

  it('the renderer delivers a texture event to the listener', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    const failed = vi.fn();
    node.onEvent = { failed };
    expect(core.nodes.handles[node.slot]).toBe(node);
    // FrameEvents asks the owner, then delivers through emit.
    core.events.queue(node, 'failed', 'err');
    core.events.flush();
    expect(failed).toHaveBeenCalledWith(node, 'err');
  });

  it('bubble walks the on<Event> handlers up the parent chain', () => {
    const core = headless();
    const root = new ElementNode(core, NodeType.Element);
    const mid = new ElementNode(core, NodeType.Element);
    const leaf = new ElementNode(core, NodeType.Element);
    mid.parent = root;
    leaf.parent = mid;
    const order: string[] = [];
    const payload = { n: 1 };
    const atRoot = vi.fn(function (this: ElementNode) {
      order.push('root');
    });
    const atMid = vi.fn(function (this: ElementNode) {
      order.push('mid');
      return true;
    });
    const atLeaf = vi.fn(function (this: ElementNode) {
      order.push('leaf');
    });
    const loose = root as unknown as Record<string, unknown>;
    loose.onCustom = atRoot;
    (mid as unknown as Record<string, unknown>).onCustom = atMid;
    (leaf as unknown as Record<string, unknown>).onCustom = atLeaf;
    // The leaf, then mid; mid returns true, so the root is not reached.
    expect(leaf.bubble('custom', payload)).toBe(true);
    expect(order).toEqual(['leaf', 'mid']);
    // A handler is called with the bubbling node and the data, `this` its owner.
    expect(atMid).toHaveBeenCalledWith(leaf, payload);
    expect(atMid.mock.contexts[0]).toBe(mid);
    expect(atRoot).not.toHaveBeenCalled();
    // No handler returns true: every one runs, and the result is false.
    (mid as unknown as Record<string, unknown>).onCustom = undefined;
    order.length = 0;
    expect(leaf.bubble('custom')).toBe(false);
    expect(order).toEqual(['leaf', 'root']);
  });

  it('emit warns once per name when only an on<Name> handler exists', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const node = new ElementNode(headless(), NodeType.Element);
      (node as unknown as Record<string, unknown>).onWarnOnce = () => {};
      node.emit('warnOnce', null);
      node.emit('warnOnce', null);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('bubble(warnOnce)');
      // No handler of that name: no warning.
      node.emit('quiet', null);
      expect(warn).toHaveBeenCalledTimes(1);
      // A listener registered: delivered, no warning.
      const fn = vi.fn();
      (node as unknown as Record<string, unknown>).onHeard = () => {};
      node.on('heard', fn);
      node.emit('heard', 1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
