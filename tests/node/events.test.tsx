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
});
