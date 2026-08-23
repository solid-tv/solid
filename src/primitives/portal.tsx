import { rootNode, type ElementNode, insert } from '@solidtv/solid';
import {
  createTrackedEffect,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  type Element as JSXElement,
  runWithOwner,
} from 'solid-js';

export function Portal(props: { mount?: string; children: JSXElement }) {
  let content: undefined | (() => JSXElement);
  const mount = () => getMount(props.mount);
  const owner = getOwner();

  function getMount(mount?: string): ElementNode {
    if (!mount) return rootNode;
    return rootNode.searchChildrenById(mount) || rootNode;
  }

  createTrackedEffect(() => {
    const [clean, setClean] = createSignal(false);
    const cleanup = () => setClean(true);
    content =
      content || runWithOwner(owner, () => createMemo(() => props.children));
    createRoot((dispose) =>
      insert(mount(), () => (!clean() ? content!() : dispose()), null),
    );
    // createTrackedEffect takes a returned cleanup rather than onCleanup.
    return cleanup;
  });

  return null;
}
