# Element Node

All JSX code is compiled into `ElementNode` class objects. An `ElementNode` is the handle of one node in the SolidTV Renderer: it owns a slot in the renderer's node store, and its props read and write that store directly.

<img src="images/SolidElementNode.jpg" alt="SolidTV To Renderer Node Creation">

```jsx
let container;
<view ref={container} width={300} height={100}>
  <view width={100} height={100} color={'#FF0000'} />;
  <view width={100} height={100} color={'#00FF00'} />;
  <view width={100} height={100} color={'#0000FF'} />;
</view>;
```

The above code creates an `ElementNode` with 3 children `ElementNode`s. By using Solid's `ref`, we gain direct access to the node, allowing us to control the renderer directly: there is no second renderer object behind it (1.x's `node.lng` is gone, the node is the handle).

```js
// You can set any properties directly via the ref
container.width = 500;
container.color = '#000000';
container.x = 100;
```

`ElementNode` is a class with declared members only and no index signature, so a member it does not declare is a type error. To keep your own data on a node, use the `data` prop, or declare the member by augmenting the class:

```ts
declare module '@solidtv/solid' {
  interface ElementNode {
    customProp?: string;
  }
}

container.customProp = 'SolidTV Rocks';
```

## The node is the renderer handle

- **A slot from construction.** The node takes its slot in the renderer's store when it is created, so every prop write, including the first, lands in the renderer. There is no pre-render bag of props to flush later.
- **Accessors, not copies.** `x`, `y`, `width`, `height`, `alpha`, `color`, `scale`, `rotation`, `mount*`, `pivot*`, `zIndex` and the rest are accessors that read and write the store. A read always returns the current value, and a store-backed prop never reads `undefined`: a prop the app never set reads the renderer default (`alpha` 1, `scale` 1), and so does one whose style was undone with no base value to fall back to.
- **`rendered` and attach.** Linking a node into its parent is immediate, so draw order follows child order from the start. `rendered` is the lifecycle flag: it is `false` on a new node and becomes `true` when the node is attached to the rendered tree, which is when its parent is rendered at insert, or the subtree it belongs to is attached. Attach runs parent before children, resolves the defaults that depend on the parent (a default `width` and `height` from the parent's size, `right`, `bottom`, `center*`), creates the shader if one is needed and calls `onCreate`.
- **Only world position is read from the last frame.** `absX` and `absY` read the world transform the renderer computed in its last frame, so a write is visible in them after the next frame.

Often, you'll want to manipulate the children of the node.

```js
container.children.forEach((child) => {
  // Each child is also an ElementNode
  child.x += 100;

  // or animate properties
  child.animate({ alpha: 1, scale: 1.1 }, { duration: 500 }).start();
});
```

## Understanding Row / Column-like Elements

Continuing with our example, let's add focus management with keypress handling (assuming [useFocusManager](../primitives/useFocusManager.md) is enabled).

```jsx
let container;

// Full keyhandler typedef, you might not need all the arguments
function moveLeft(this: ElementNode, e: KeyboardEvent, container: ElementNode, focusedNode: ElementNode) {
  // Move focus to the left
  if (container.selected > 0) {
    container.selected--;
    container.children[container.selected].setFocus();
  }
}

function moveRight(this: ElementNode, e: KeyboardEvent, container: ElementNode, focusedNode: ElementNode) {
  // Move focus to the right
  if (container.selected < container.children.length - 1) {
    container.selected++;
    container.children[container.selected].setFocus();
  }
}

<view
  ref={container}
  width={300}
  height={100}
  onLeft={moveLeft}
  onRight={moveRight}
  selected={0}
>
  <view width={100} height={100} color={'#FF0000'} autofocus />;
  <view width={100} height={100} color={'#00FF00'} />;
  <view width={100} height={100} color={'#0000FF'} />;
</view>;
```

In the `moveLeft` and `moveRight` functions, we manually update the `selected` property, which tracks the focused child element. The `setFocus` method is used to apply focus to the newly selected child.

### Styling Focused Blocks

To complete this example, we can style the blocks based on their focus state. Let's add some styling for focus:

```jsx
const blockStyle = {
  width: 100,
  height: 100,
  alpha: 0.3, // Default opacity
  focus: {
    alpha: 1, // Full opacity when focused
  },
  transition: {
    alpha: true, // Enable smooth transition for alpha
  },
};

<view
  ref={container}
  width={300}
  height={100}
  onLeft={moveLeft}
  onRight={moveRight}
  selected={0}
>
  <view style={blockStyle} color={'#FF0000'} autofocus />;
  <view style={blockStyle} color={'#00FF00'} />;
  <view style={blockStyle} color={'#0000FF'} />;
</view>;
```

Now, when a block gains focus, its `alpha` value will animate smoothly from 0.3 to 1. Read more about [states](./states.md).
