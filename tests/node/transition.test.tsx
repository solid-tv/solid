import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  F_STRIDE,
  F_X,
  RendererCore,
  type Animation,
  type AnimationSettings,
} from '@solidtv/renderer';
import { Config } from '../../src/core/config.js';
import { ElementNode } from '../../src/core/node/ElementNode.js';
import { NO_SETTINGS } from '../../src/core/node/animation.js';
import { NodeType } from '../../src/core/nodeTypes.js';

const headless = () => new RendererCore({ appWidth: 640, appHeight: 360 });

/** An attached view (what attach sets, Task 8). */
function rendered(): { core: RendererCore; node: ElementNode } {
  const core = headless();
  const node = new ElementNode(core, NodeType.Element);
  node.rendered = true;
  return { core, node };
}

/** Advance the animations by `dt` ms and run the frame's update. */
function frame(core: RendererCore, dt: number): void {
  core.step(dt);
  core.update();
}

/** The renderer's cached transition controller of `name` (animateSlotProp). */
interface AnimationSlot {
  controller: Animation;
  settings: Partial<AnimationSettings>;
}
function slotOf(
  core: RendererCore,
  node: ElementNode,
  name: string,
): AnimationSlot | undefined {
  // The binding keeps one AnimationSlot per animated prop name in
  // `animations[slot]` (renderer binding.ts animateSlotProp).
  const map = core.nodes.animations[node.slot] as Record<
    string,
    AnimationSlot | undefined
  > | null;
  return map === null ? undefined : map[name];
}

const savedSettings = Config.animationSettings;
const savedEnabled = Config.animationsEnabled;
afterEach(() => {
  Config.animationSettings = savedSettings;
  Config.animationsEnabled = savedEnabled;
});

describe('ElementNode transitions', () => {
  it('a transitioned x write starts an animation and the store reaches the target after the duration', () => {
    const { core, node } = rendered();
    node.transition = { x: { duration: 100 } };
    node.x = 100;
    // The animation writes the store, not the setter.
    expect(core.nodes.f64[node.slot * F_STRIDE + F_X]).toBe(0);
    expect(slotOf(core, node, 'x')!.controller.state).toBe('scheduled');
    frame(core, 50);
    expect(node.x).toBe(50);
    frame(core, 50);
    expect(node.x).toBe(100);
    expect(slotOf(core, node, 'x')!.controller.state).toBe('stopped');
  });

  it('a repeated write retargets and stops once', () => {
    const { core, node } = rendered();
    const settings = { duration: 100 };
    const stopped = vi.fn();
    node.transition = { x: settings };
    node.onAnimation = { stopped };
    node.x = 100;
    const first = slotOf(core, node, 'x')!.controller;
    frame(core, 10);
    node.x = 200;
    expect(slotOf(core, node, 'x')!.controller).toBe(first);
    for (let i = 0; i < 20; i++) {
      frame(core, 10);
    }
    expect(node.x).toBe(200);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveBeenCalledWith('x', 200);
    expect(stopped.mock.contexts[0]).toBe(node);
  });

  it('a different settings object stops the old controller and starts a new one', () => {
    const { core, node } = rendered();
    const stopped = vi.fn();
    node.onAnimation = { stopped };
    node.transition = { x: { duration: 100 } };
    node.x = 100;
    const first = slotOf(core, node, 'x')!.controller;
    frame(core, 10);
    node.transition = { x: { duration: 100 } };
    node.x = 200;
    const second = slotOf(core, node, 'x')!.controller;
    expect(second).not.toBe(first);
    expect(first.state).toBe('stopped');
    // The old controller's stop reports its prop.
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(stopped.mock.calls[0]![0]).toBe('x');
    for (let i = 0; i < 20; i++) {
      frame(core, 10);
    }
    expect(node.x).toBe(200);
    expect(stopped).toHaveBeenCalledTimes(2);
    expect(stopped).toHaveBeenLastCalledWith('x', 200);
  });

  it('no transition writes the store directly', () => {
    const { core, node } = rendered();
    node.x = 100;
    expect(node.x).toBe(100);
    // A transition on another prop, `false`, or a node not attached: direct.
    node.transition = { y: { duration: 100 } };
    node.x = 110;
    expect(node.x).toBe(110);
    node.transition = false;
    node.x = 120;
    expect(node.x).toBe(120);
    const detached = new ElementNode(core, NodeType.Element);
    detached.transition = { x: { duration: 100 } };
    detached.x = 130;
    expect(detached.x).toBe(130);
    // Animations disabled: direct.
    Config.animationsEnabled = false;
    node.transition = { x: { duration: 100 } };
    node.x = 140;
    expect(node.x).toBe(140);
    expect(core.nodes.animations[node.slot]).toBeNull();
    expect(core.nodes.animations[detached.slot]).toBeNull();
  });

  it('the settings fallback allocates nothing', () => {
    const { core, node } = rendered();
    Config.animationSettings = undefined;
    node.transition = true;
    node.x = 10;
    const first = slotOf(core, node, 'x')!;
    node.x = 20;
    const second = slotOf(core, node, 'x')!;
    expect(second.controller).toBe(first.controller);
    expect(second.settings).toBe(NO_SETTINGS);
    expect(Object.isFrozen(NO_SETTINGS)).toBe(true);
    // `{ x: true }` takes the same constant.
    node.transition = { y: true };
    node.y = 5;
    expect(slotOf(core, node, 'y')!.settings).toBe(NO_SETTINGS);
  });

  it('transition true and { name: true } use the node settings, then Config', () => {
    const { core, node } = rendered();
    const own = { duration: 10 };
    node.transition = true;
    node.x = 10;
    expect(slotOf(core, node, 'x')!.settings).toBe(Config.animationSettings);
    node.animationSettings = own;
    node.transition = { alpha: true };
    node.alpha = 0.5;
    expect(slotOf(core, node, 'alpha')!.settings).toBe(own);
    // A settings object on the prop wins over both.
    const perProp = { duration: 20 };
    node.transition = { alpha: perProp };
    node.alpha = 0;
    expect(slotOf(core, node, 'alpha')!.settings).toBe(perProp);
    expect(node.animationSettings).toBe(own);
    node.animationSettings = undefined;
    expect(node.animationSettings).toBe(Config.animationSettings);
  });

  it('onAnimation.animating fires synchronously with the write', () => {
    const { node } = rendered();
    const animating = vi.fn();
    node.onAnimation = { animating };
    node.transition = { alpha: { duration: 10 } };
    node.alpha = 0.25;
    expect(animating).toHaveBeenCalledTimes(1);
    expect(animating).toHaveBeenCalledWith('alpha', 0.25);
    expect(animating.mock.contexts[0]).toBe(node);
  });

  it('a group prop animates its fields', () => {
    const { core, node } = rendered();
    node.transition = { scale: { duration: 10 } };
    node.scale = 2;
    expect(node.scaleX).toBe(1);
    frame(core, 10);
    expect(node.scaleX).toBe(2);
    expect(node.scaleY).toBe(2);
  });
});

describe('ElementNode animate, chain, start', () => {
  it('animate before attach is inert', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    const controller = node.animate({ x: 100 }, { duration: 10 });
    expect(controller.start()).toBe(controller);
    frame(core, 10);
    expect(node.x).toBe(0);
    return controller.waitUntilStopped();
  });

  it('animate after attach runs through the renderer', async () => {
    const { core, node } = rendered();
    const controller = node.animate({ x: 100, alpha: 0.5 }, { duration: 10 });
    const done = controller.start().waitUntilStopped();
    frame(core, 5);
    expect(node.x).toBe(50);
    frame(core, 5);
    await done;
    expect(node.x).toBe(100);
    expect(node.alpha).toBe(0.5);
  });

  it('animate takes the node settings, then Config, then the frozen fallback', () => {
    const { core, node } = rendered();
    Config.animationSettings = undefined;
    // The fallback: duration 0 lands in one frame.
    node.animate({ x: 30 }).start();
    frame(core, 1);
    expect(node.x).toBe(30);
    node.animationSettings = { duration: 100 };
    node.animate({ x: 130 }).start();
    frame(core, 50);
    expect(node.x).toBe(80);
  });

  it('chain then start runs the animations in order', async () => {
    const { core, node } = rendered();
    const done = node
      .chain({ x: 100 }, { duration: 10 })
      .chain({ y: 50 })
      .start();
    frame(core, 10);
    expect(node.x).toBe(100);
    expect(node.y).toBe(0);
    // The next animation starts after the first one's promise resolves.
    await Promise.resolve();
    await Promise.resolve();
    frame(core, 10);
    await done;
    expect(node.y).toBe(50);
  });
});
