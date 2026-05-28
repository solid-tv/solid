## `Visible` Component

The `Visible` component in SolidTV provides conditional rendering of its child elements based on the `when` prop. When `when` is `true`, the children are rendered and displayed; when `false`, they are hidden (alpha set to 0) from view but remain in the SolidTV tree, allowing for efficient toggling of visibility unlike the `<Show>` component which destroys and recreates elements.

### Usage

### Props

- **`when`**: A `boolean` determining whether the children are visible (`true`) or hidden (`false`).
- **`children`**: The elements or components to render conditionally based on the `when` prop.

### Example

Below is an example illustrating how to use the `Visible` component to toggle the display of a message based on a button click.

```typescript
import { createSignal } from "solid-js";
import { Visible } from "@solidtv/solid";

function App() {
  const [isVisible, setIsVisible] = createSignal(false);

  return (
    <view>
      <view autofocus onEnter={() => setIsVisible((prev) => !prev)}>
        Toggle Visibility
      </view>
      <Visible when={isVisible()}>
        <text>This message is conditionally visible.</text>
      </Visible>
    </view>
  );
}

export default App;
```

In this example:

- onEnter "Toggle Visibility" updates the `isVisible` signal.
- The `Visible` component toggles the visibility of the `<text>`.

### Key Points

- **Visibility Control**: Unlike Solid's native conditional rendering (`<Show>` or `{ condition && <Component /> }`), `Visible` maintains child elements in, making it ideal for scenarios where you need to preserve element state or animations while toggling visibility.
- **Efficiency**: By avoiding remounting, `Visible` can improve performance in scenarios with complex children that should remain in memory when hidden.
