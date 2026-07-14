import type { ElementText, TextNode } from '../core/index.js';
import {
  Config,
  ElementNode,
  activeElement,
  isElementNode,
  isFunction,
  rootNode,
} from '../index.js';
import { makeEventListener } from '@solid-primitives/event-listener';
import { useMousePosition } from '@solid-primitives/mouse';
import { createScheduled, throttle } from '@solid-primitives/scheduled';
import { createEffect, getOwner, runWithOwner } from 'solid-js';

type CustomState = `$${string}`;

type RenderableNode = ElementNode | ElementText | TextNode;

interface MouseStateOptions {
  hoverState: CustomState;
  pressedState: CustomState;
}

type UseMouseOptions =
  | { customStates: MouseStateOptions }
  | { customStates: undefined };

export function addCustomStateToElement(
  element: RenderableNode,
  state: CustomState,
): void {
  (element as ElementNode).states?.add(state);
}

export function removeCustomStateFromElement(
  element: RenderableNode,
  state: CustomState,
): void {
  (element as ElementNode)?.states?.remove(state);
}

export function hasCustomState(
  element: RenderableNode,
  state: CustomState,
): boolean {
  return (element as ElementNode).states?.has(state);
}

function createKeyboardEvent(
  key: string,
  keyCode: number,
  eventName: string = 'keydown',
): KeyboardEvent {
  return new KeyboardEvent(eventName, {
    key,
    keyCode,
    which: keyCode,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    bubbles: true,
  });
}

let scrollTimeout: ReturnType<typeof setTimeout>;
const handleScroll = throttle((e: WheelEvent): void => {
  const deltaY = e.deltaY;
  if (deltaY < 0) {
    document.body.dispatchEvent(createKeyboardEvent('ArrowUp', 38));
  } else if (deltaY > 0) {
    document.body.dispatchEvent(createKeyboardEvent('ArrowDown', 40));
  }

  // clear the last timeout if the user is still scrolling
  clearTimeout(scrollTimeout);
  // after 250ms of no scroll events, we send a keyup event to stop the scrolling
  scrollTimeout = setTimeout(() => {
    document.body.dispatchEvent(createKeyboardEvent('ArrowUp', 38, 'keyup'));
    document.body.dispatchEvent(createKeyboardEvent('ArrowDown', 40, 'keyup'));
  }, 250);
}, 250);

function findElementWithCustomState<TApp extends ElementNode>(
  myApp: TApp,
  x: number,
  y: number,
  customState: CustomState,
): ElementNode | undefined {
  const path = getChildrenByPosition(myApp, x, y);
  let element: ElementNode | undefined;
  for (let i = path.length - 1; i >= 0; i--) {
    if (hasCustomState(path[i]!, customState)) {
      element = path[i];
      break;
    }
  }
  if (!element) return undefined;

  let p = element.parent;
  while (p?.forwardStates && hasCustomState(p, customState)) {
    element = p;
    p = p.parent;
  }
  return element;
}

function findElementByActiveElement(e: MouseEvent): ElementNode | null {
  const active = activeElement();
  const precision = Config.rendererOptions?.deviceLogicalPixelRatio || 1;
  const px = e.clientX / precision;
  const py = e.clientY / precision;

  if (
    active instanceof ElementNode &&
    testCollision(
      px,
      py,
      (active.lng.absX as number) || 0,
      (active.lng.absY as number) || 0,
      active.width || 0,
      active.height || 0,
    )
  ) {
    return active;
  }

  let parent = active?.parent;
  while (parent) {
    if (
      (isFunction(parent.onMouseClick) || isFunction(parent.onEnter)) &&
      testCollision(
        px,
        py,
        (parent.lng.absX as number) || 0,
        (parent.lng.absY as number) || 0,
        parent.width || 0,
        parent.height || 0,
      )
    ) {
      return parent;
    }
    parent = parent.parent;
  }

  return null;
}

function applyPressedState(
  element: ElementNode,
  pressedState: CustomState,
): void {
  addCustomStateToElement(element, pressedState);
}

function handleElementClick(
  clickedElement: ElementNode,
  e: MouseEvent,
  customStates?: MouseStateOptions,
  pressedElementRef?: { current: ElementNode | null },
): void {
  if (customStates?.pressedState && pressedElementRef?.current) {
    removeCustomStateFromElement(
      pressedElementRef.current,
      customStates.pressedState,
    );
    pressedElementRef.current = null;
  }

  if (isFunction(clickedElement.onMouseClick)) {
    clickedElement.onMouseClick(e, clickedElement);
    return;
  } else if (isFunction(clickedElement.onEnter)) {
    clickedElement.onEnter();
    return;
  }

  clickedElement.setFocus();
  setTimeout(() => {
    document.dispatchEvent(createKeyboardEvent('Enter', 13));
    setTimeout(
      () =>
        document.body.dispatchEvent(createKeyboardEvent('Enter', 13, 'keyup')),
      1,
    );
  }, 1);
}

function createHandleClick<TApp extends ElementNode>(
  myApp: TApp,
  customStates?: MouseStateOptions,
  pressedElementRef?: { current: ElementNode | null },
) {
  return (e: MouseEvent): void => {
    const clickedElement = customStates
      ? findElementWithCustomState(
          myApp,
          e.clientX,
          e.clientY,
          customStates.hoverState,
        )
      : findElementByActiveElement(e);

    if (!clickedElement) {
      return;
    }

    handleElementClick(clickedElement, e, customStates, pressedElementRef);
  };
}

function createHandleMouseDown<TApp extends ElementNode>(
  myApp: TApp,
  customStates?: MouseStateOptions,
  pressedElementRef?: { current: ElementNode | null },
) {
  return (e: MouseEvent): void => {
    if (!customStates) {
      return;
    }

    const pressedElement = findElementWithCustomState(
      myApp,
      e.clientX,
      e.clientY,
      customStates.hoverState,
    );

    if (!pressedElement) {
      return;
    }

    applyPressedState(pressedElement, customStates.pressedState);
    if (pressedElementRef) {
      pressedElementRef.current = pressedElement;
    }
  };
}

function testCollision(
  px: number,
  py: number,
  cx: number,
  cy: number,
  cw: number = 0,
  ch: number = 0,
): boolean {
  return px >= cx && px <= cx + cw && py >= cy && py <= cy + ch;
}

function isNodeAtPosition(
  node: ElementNode | ElementText | TextNode,
  x: number,
  y: number,
): node is ElementNode {
  if (!isElementNode(node)) {
    return false;
  }

  return (
    node.alpha !== 0 &&
    !node.skipFocus &&
    testCollision(
      x,
      y,
      (node.lng.absX as number) || 0,
      (node.lng.absY as number) || 0,
      node.width || 0,
      node.height || 0,
    )
  );
}

function getChildrenByPosition<TElement extends ElementNode = ElementNode>(
  node: TElement,
  x: number,
  y: number,
): TElement[] {
  const result: TElement[] = [];
  const precision = Config.rendererOptions?.deviceLogicalPixelRatio || 1;
  const px = x / precision;
  const py = y / precision;

  let current: ElementNode | ElementText | TextNode | undefined = node;
  while (current && isNodeAtPosition(current, px, py)) {
    result.push(current as TElement);

    let best: ElementNode | undefined;
    let bestZ = -Infinity;
    for (const child of current.children) {
      if (!isNodeAtPosition(child, px, py)) continue;
      const z = child.zIndex ?? -1;
      if (z >= bestZ) {
        bestZ = z;
        best = child;
      }
    }
    if (!best) break;
    current = best;
  }

  return result;
}

export function useMouse<TApp extends ElementNode = ElementNode>(
  myApp: TApp = rootNode as TApp,
  throttleBy: number = 100,
  options?: UseMouseOptions,
): void {
  const pos = useMousePosition();
  const scheduled = createScheduled((fn) => throttle(fn, throttleBy));
  let previousElement: ElementNode | null = null;
  const pressedElementRef: { current: ElementNode | null } = { current: null };
  const customStates = options?.customStates;
  const hoverState = customStates?.hoverState;
  const handleClick = createHandleClick(myApp, customStates, pressedElementRef);
  const handleMouseDown = createHandleMouseDown(
    myApp,
    customStates,
    pressedElementRef,
  );
  const owner = getOwner();
  const handleClickContext = (e: MouseEvent) => {
    runWithOwner(owner, () => handleClick(e));
  };
  const handleMouseDownContext = (e: MouseEvent) => {
    runWithOwner(owner, () => handleMouseDown(e));
  };

  const focusKey = Config.focusStateKey;

  makeEventListener(window, 'wheel', handleScroll);
  makeEventListener(window, 'click', handleClickContext);
  makeEventListener(window, 'mousedown', handleMouseDownContext);
  createEffect(() => {
    if (!scheduled()) return;

    const path = getChildrenByPosition(myApp, pos.x, pos.y);
    let activeElm: ElementNode | undefined;
    for (let i = path.length - 1; i >= 0; i--) {
      const el = path[i]!;
      if (
        el.onEnter ||
        el.onMouseClick ||
        el.onFocus ||
        el[focusKey] ||
        (hoverState && el[hoverState])
      ) {
        activeElm = el;
        break;
      }
    }

    if (!activeElm) {
      if (previousElement && hoverState) {
        removeCustomStateFromElement(previousElement, hoverState);
        previousElement = null;
      }
      return;
    }

    let p = activeElm.parent;
    while (p?.forwardStates) {
      activeElm = p;
      p = p.parent;
    }

    // Update Row & Column Selected property
    const activeElmParent = activeElm.parent;
    if (activeElmParent?.selected !== undefined) {
      activeElmParent.selected = activeElmParent.children.indexOf(activeElm);
    }

    if (previousElement && previousElement !== activeElm && hoverState) {
      removeCustomStateFromElement(previousElement, hoverState);
    }

    if (hoverState) {
      addCustomStateToElement(activeElm, hoverState);
    } else {
      activeElm.setFocus();
    }

    previousElement = activeElm;
  });
}
