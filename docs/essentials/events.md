## Component Lifecycle (onMount, onCleanup)

SolidTV offers two primary lifecycle hooks to manage component behavior:

- **[onMount](https://www.solidjs.com/docs/latest/api#onmount)**: Executes a function when the component is first inserted.
- **[onCleanup](https://www.solidjs.com/docs/latest/api#oncleanup)**: Executes a function to clean up resources when the component is removed.

For detailed information, refer to the [SolidTV Lifecycle documentation](https://docs.solidjs.com/references/api-reference/lifecycles/onMount).

## Built-in Events

The SolidTV integration provides built-in events that can be utilized within your components:

```jsx
  onCreate: (this: ElementNode, target: ElementNode);
  onDestroy: (this: ElementNode, target: ElementNode) => Promise<any> | void;
  onLayout: (this: ElementNode, target: ElementNode, child?: ElementNode, dimensions?: Dimensions);
```

Learn more about using [onDestroy](/flow/ondestroy) and the [layout events](/flow/layout?id=layout-callbacks).

## Renderer Events

In addition to the lifecycle events from SolidTV, the SolidTV Renderer offers additional custom events for you to tie into using the `onEvent` object. These events provide information about element visibility and state within the renderer.

### Example Usage:

```jsx
<view
  onEvent={{
    loaded: (element, eventInfo) => {
      console.log('load was called');
    },
    failed: (element, eventInfo) => {
      console.log('fail was called');
    },
    inViewport: (element, eventInfo) => {
      console.log('Element entered viewport');
    },
    outOfViewport: (element, eventInfo) => {
      console.log('Element exited viewport');
    },
  }}
/>
```

### Available Renderer Events:

- **`loaded`**: Fired when the element has successfully loaded.
- **`failed`**: Fired when the element fails to load.
- **`freed`**: Fired when the element is freed for memory.
- **`inViewport`**: Fired when the element enters the viewport (the portion of the screen where content is visible).
- **`outOfViewport`**: Fired when the element leaves the viewport.

Both viewport events receive a `{ previous, current }` payload of
`CoreNodeRenderState` values.

> **Renderer 1.8 breaking change:** `inBounds` and `outOfBounds` were removed.
> They fired on the preload transition, one step earlier than viewport entry.
> Preloading textures ahead of a node scrolling on screen is now handled by the
> `boundsMargin` renderer setting, so there is nothing left for an app to do on
> that transition — move any such listener to `inViewport`.
>
> Viewport events are gated behind the `__emitBoundsEvents__` build flag, which
> defaults to `false`. See [SolidTV Renderer](/articles/solidtv_renderer.md) to
> turn it on.

These additional events provide control over element state and position within the SolidTV Renderer, allowing you to react to changes such as visibility or load state with custom logic.

## Listening to Events: `on`, `off` and `onEvent`

The renderer's events reach a node through listeners. Register one with
`on(name, fn)`, remove it with `off(name, fn)`, or give the node an `onEvent`
object, which registers each key and replaces the handlers of the previous
object. A listener is called with the node as `this` and as the first
argument, then the event's payload.

```jsx
const onLoaded = (element, payload) => console.log('loaded', payload);

nodeRef.on('loaded', onLoaded);
nodeRef.off('loaded', onLoaded);
```

`node.emit(name, data)` is the renderer's own delivery to those listeners. It
calls the listeners of that node, returns nothing, and does not bubble. Do not
use it to talk to ancestors: an `on<Name>` prop is not a listener, so
`emit('customEvent')` does not call `onCustomEvent`.

## Emitting Custom Events with `bubble`

To send an event up to the ancestors, use `bubble(event, data?)` (it was
`emit` in 1.x). Components can use it to communicate with their ancestors by
dispatching an event up the hierarchy.

### Usage Example:

```jsx
nodeRef.bubble('customEvent', { message: 'Hello, world!' });
// function triggerCallback(this: MyComponent, nodeRef, payload) {

<MyComponent onCustomEvent={triggerCallback} />;
```

### How `bubble` Works:

1. It starts at the current component and looks for a handler named `onCustomEvent` (where `CustomEvent` is capitalized).
2. If a handler exists and returns `true`, the event stops propagating.
3. Otherwise, it continues up the component tree until it reaches the root or finds a handler that returns `true`.
4. It returns `true` when a handler stopped the event, `false` when none did.
