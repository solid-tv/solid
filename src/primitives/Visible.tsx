import {
  DEV,
  children,
  createMemo,
  ChildrenReturn,
  type Element as JSXElement,
  untrack,
  onCleanup,
  createRoot,
} from 'solid-js';
import { ElementNode } from '@solidtv/solid';

export function Visible<T>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  children: JSXElement;
}): JSXElement {
  let child: ChildrenReturn | undefined;
  let disposer: VoidFunction | undefined;
  const keyed = props.keyed;
  const condition = createMemo<T | undefined | null | boolean>(
    () => props.when,
    DEV
      ? {
          equals: (a, b) => (keyed ? a === b : !a === !b),
          name: "condition"
        }
      : { equals: (a, b) => (keyed ? a === b : !a === !b) }
  );

  onCleanup(() => disposer?.());


  return createMemo(() => {
    const c = condition();
    const isKeyed = untrack(() => !!keyed);
    if (isKeyed){
      disposer?.();
      child = undefined;
    }

    if (c && !child) {
      disposer = createRoot((dispose) => {
        child = children(() => props.children);
        return dispose;
      })
    }

    const isHidden = !c;
    child?.toArray().forEach((childNode) => {
      if (childNode instanceof ElementNode) {
        childNode.hidden = isHidden;
      }
    });

    return c || child ? child : null;
  }) as unknown as JSXElement;
};
