import { createRenderer as solidCreateRenderer } from '@solidjs/universal';
import {
  Config,
  startLightningRenderer,
  type RendererMainSettings,
  DomRendererMainSettings,
} from './core/index.js';
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

let renderer;
export const rootNode = nodeOpts.createElement('App');

const render = function (code: () => JSXElement) {
  // @ts-expect-error - code returns a JSX Element, not a SolidNode yet
  return solidRenderer.render(code, rootNode);
};

export function createRenderer(
  rendererOptions?: RendererMainSettings | DomRendererMainSettings,
  node?: HTMLElement | string,
) {
  const options = rendererOptions || Config.rendererOptions;

  renderer = startLightningRenderer(options!, node || 'app');
  rootNode.lng = renderer.root!;
  rootNode.rendered = true;
  renderer.on('idle', () => {
    tasksEnabled = true;
    processTasks();
  });

  return {
    renderer,
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
