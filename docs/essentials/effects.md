# Shaders and Effects

The shader prop allows you to specify a custom shader. Most of the common use ones have shortcuts like `borderRadius`, `border`, `linearGradient`. These shortcuts get combined to create one dynamic shader from the Renderer. The order that they are listed in the props / style object affect how it gets created and could change the UI. Typically you want borderRadius to be the last one. If you have a custom shader, you'll need to use the `shader` prop and create the directly. Check out this [example](https://github.com/lightning-js/renderer/blob/main/examples/tests/dynamic-shader.ts) from the renderer for more information.

```jsx
const RoundedRectangle = ['RoundedRectangle', { radius: 6 }];
function Button(props) {
  return (
    <view
      {...props}
      forwardStates
      style={buttonStyles.container}
      shader={RoundedRectangle}
    >
      <view style={buttonStyles.topBar} shader={RoundedRectangle}></view>
      <text style={buttonStyles.text}>{props.children}</text>
    </view>
  );
}
```

## Border and borderRadius

`border` and `borderRadius` are special props which create effects for the DynamicShader found in the SolidTV Renderer. These props can be set on the JSX or style object. The order in which you set the props determine how they are applied in the shader. Meaning you probably want to set borderRadius first. You can also set individual borders via `borderLeft`, `borderRight`, `borderTop`, `borderBottom`. These properties do not support animations.

```js
const style = {
  borderRadius: 30,
  border: { width: 10, color: 0x000000ff },
};

// or

const style = {
  borderLeft: { width: 10, color: 0x000000ff },
  borderRight: { width: 10, color: 0x000000ff },
};
```

## Linear Gradient, Radial Gradient and Hole Punch

`linearGradient`, `radialGradient` and `holePunch` are props of their own, in the JSX or in a style object, like `border` and `shadow`. There is no `effects` prop (1.x wrapped these in `effects={{ … }}`): write the key directly.

```jsx
import { deg2Rad } from '@solidtv/solid';

<view
  width={300}
  height={300}
  linearGradient={{
    angle: deg2Rad(225),
    stops: [0.1, 0.5],
    colors: [0xff0000ff, 0x00000000],
  }}
/>;
```

```jsx
<view
  width={300}
  height={300}
  radialGradient={{
    pivot: [0.5, 0.5],
    w: 150,
    h: 150,
    stops: [0.1, 0.5],
    colors: [0xff0000ff, 0x00000000],
  }}
/>
```

`holePunch` cuts a rounded rectangle out of the node:

```jsx
<view
  width={300}
  height={300}
  color={'#000000'}
  holePunch={{ x: 50, y: 50, w: 200, h: 200, radius: 12 }}
/>
```

You can have as many stops or colors as you like, up to nine. The `w` and `h` here are the radial gradient's and the hole punch's own keys (their size), not node props: a node's size is `width` and `height`.
