import { createRenderer as solidCreateRenderer } from '@solidjs/universal';
import { Config, ElementNode } from './core/index.js';
import { startRenderer, type RendererOptions } from './core/renderer.js';
import { initClickInspector } from './core/clickInspector.js';
import nodeOpts from './solidOpts.js';
import {
  omit,
  createMemo,
  createRenderEffect,
  untrack,
  type Element as JSXElement,
  createRoot,
  type Component,
} from 'solid-js';
import type { SolidNode } from './types.js';
import { activeElement } from './core/activeElement.js';

const solidRenderer = solidCreateRenderer<SolidNode>(nodeOpts);

/**
 * The root ElementNode: it owns the core's root slot. Assigned by
 * `createRenderer`; `Portal` and `useMouse` read it at call time, which is
 * after `createRenderer` (a live binding, not a value copied at import).
 */
export let rootNode: ElementNode;

const render = function (code: () => JSXElement) {
  // @ts-expect-error - code returns a JSX Element, not a SolidNode yet
  return solidRenderer.render(code, rootNode);
};

export function createRenderer(
  rendererOptions?: RendererOptions,
  node?: HTMLElement | string,
) {
  let options = rendererOptions || Config.rendererOptions || {};
  if (node !== undefined) {
    // The mount target, on a copy: the app's options are left alone. Key
    // by key, not spread (Chrome 38).
    const source = options as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const key in source) {
      copy[key] = source[key];
    }
    copy.canvas = node;
    options = copy as RendererOptions;
  }
  const started = startRenderer(options);
  const core = started.core;
  if (rootNode === undefined || rootNode.core !== core) {
    rootNode = ElementNode.fromSlot(core, core.root.slot);
    rootNode.rendered = true;
    initClickInspector(rootNode);
  }
  const renderer = started.renderer;
  if (renderer === null) {
    // Headless: no frame loop, so never idle: the tasks run at once.
    tasksEnabled = true;
  } else {
    renderer.on('idle', () => {
      tasksEnabled = true;
      processTasks();
    });
  }

  return {
    renderer: core,
    rootNode,
    render,
  };
}

export const {
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  applyRef,
  ref,
} = solidRenderer;

// Re-export a Proxy-free-safe mergeProps in place of the renderer's own so the
// JSX compiler routes compiled spreads through it — fixes dropped spread props
// on engines without Proxy (Chrome 38 / webOS 3). See ./mergeProps.ts.
export { mergeProps } from './mergeProps.js';

type Task = () => void;
const taskQueue: Task[] = [];
let tasksEnabled = false;

createRoot(() => {
  // should change whenever a keypress occurs, so we disable the task queue
  // until the renderer is idle again. Solid 2.0 splits this into a tracked
  // compute and an untracked effect.
  createRenderEffect(
    () => activeElement(),
    () => {
      tasksEnabled = false;
    },
  );
});

export function setTasksEnabled(enabled: boolean): void {
  tasksEnabled = enabled;
}

export function clearTasks(): void {
  taskQueue.length = 0;
}

export function scheduleTask(
  callback: Task,
  priority: 'high' | 'low' = 'low',
): void {
  if (priority === 'high') {
    taskQueue.unshift(callback);
  } else {
    taskQueue.push(callback);
  }
  processTasks();
}

function processTasks(): void {
  if (tasksEnabled && taskQueue.length) {
    setTimeout(() => {
      const task = taskQueue.shift();
      if (task) {
        task();
        processTasks();
      }
    }, Config.taskDelay || 50);
  }
}

/**
 * renders an arbitrary custom or native component and passes the other props
 * ```typescript
 * <Dynamic component={multiline() ? 'textarea' : 'input'} value={value()} />
 * ```
 * @description https://www.solidjs.com/docs/latest/api#dynamic
 */
export function Dynamic<T extends Record<string, any>>(
  props: T & { component?: Component<T> | undefined | null },
): JSXElement {
  const others = omit(props, 'component');

  const cached = createMemo(() => props.component);

  return createMemo(() => {
    const component = cached();
    switch (typeof component) {
      case 'function':
        return untrack(() => component(others as T));

      case 'string': {
        const el = createElement(component);
        (el as { componentName?: string }).componentName = component;
        spread(el, others);
        return el;
      }

      default:
        break;
    }
  }) as unknown as JSXElement;
}

export function registerDefaultShader(_name: string, _shader: any) {
  // noop for v2
  // renderer.stage.shManager.registerShaderType('rounded', Rounded);
}
