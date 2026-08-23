import {
  type Accessor,
  type Setter,
  createEffect,
  createMemo,
  createSignal,
  latest,
} from 'solid-js';

// Adopted from https://github.com/solidjs-community/solid-primitives/blob/main/packages/pagination/src/index.ts
// As we don't have intersection observer in Lightning, we can't use the original implementation

/**
 * Provides an easy way to implement infinite items.
 *
 * ```ts
 * const [items, loader, { item, setItem, setItems, end, setEnd }] = createInfiniteScroll(fetcher);
 * ```
 * @param fetcher `(item: number) => Promise<T[]>`
 * @return `items()` is an accessor contains array of contents
 * @property `items.loading` is a boolean indicator for the loading state
 * @property `items.error` contains any error encountered
 * @method `page` is an accessor that contains page number
 * @method `setPage` allows to manually change the page number
 * @method `setItems` allows to manually change the contents of the item
 * @method `end` is a boolean indicator for end of the item
 * @method `setEnd` allows to manually change the end
 */
export function createInfiniteItems<T>(
  fetcher: (item: number) => Promise<T[]>,
): [
  items: Accessor<T[]>,
  options: {
    page: Accessor<number>;
    setPage: Setter<number>;
    setItems: Setter<T[]>;
    end: Accessor<boolean>;
    setEnd: Setter<boolean>;
  },
] {
  const [items, setItems] = createSignal<T[]>([]);
  const [page, setPage] = createSignal(0);
  const [end, setEnd] = createSignal(false);

  // An async compute replaces createResource. `latest` reads the last
  // resolved value instead of suspending, so this primitive keeps working
  // outside a <Loading> boundary — as it did with a resource in 1.x.
  const contents = createMemo(() => fetcher(page()));

  createEffect(
    () => latest(contents),
    (content) => {
      if (!content) return;
      // batch() is gone — writes are batched to the microtask automatically.
      if (content.length === 0) setEnd(true);
      setItems((p) => [...p, ...content]);
    },
  );

  return [
    items,
    {
      page,
      setPage,
      setItems,
      end,
      setEnd,
    },
  ];
}
