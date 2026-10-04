# Layout and Positioning Elements

To ensure that elements are rendered on the screen correctly, they must have the following properties:

- **`x`**: The x position of the element in pixels, relative to its parent. Negative values are allowed.
- **`y`**: The y position of the element in pixels, relative to its parent. Negative values are allowed.
- **`right`**: Sets mountX: 1 and the x position of the element relative to its parent from the right of the container.
- **`bottom`**: Sets mountY: 1 and the y position of the element relative to its parent from the bottom of the container.
- **`width`**: The width of the element in pixels.
- **`height`**: The height of the element in pixels.

If width and height values are not specified, components will inherit these dimensions from their parent, minus their `x` and `y` values. The default values for `x` and `y` are 0, 0.

The `<text>` element does not require any of these properties, as it will use the default text properties found in `Config`. The height of a `<text>` node equals it's `lineHeight` or `fontSize` and the width is calculated after it's rendered.

## Flex

A fundamental tool for layout is the Flex container (`display: flex`). SolidTV has one flex engine (`src/core/flexLayout.ts`), modelled on CSS flexbox. It supports `flexDirection`, `justifyContent`, `alignItems`, `alignSelf`, `flexOrder`, `flexGrow`, `flexShrink`, `flexBasis`, `flexWrap`, `gap`, `padding` (a number, an array, or per side) and `margin` (a number, an array, or per side). This is useful for laying out elements in rows and columns.

The engine allocates nothing during a layout pass and writes only the values that changed, so a relayout that moves nothing writes nothing and starts no transition.

### One flex engine

Before 1.7 there were two engines, a legacy one and a CSS-aligned one chosen at build time with the `VITE_USE_NEW_FLEX` environment variable. Since 1.7 there is only the CSS-aligned one, with everything below. The variable is ignored; delete it from your `.env`. If your app ran on the legacy engine, see `MIGRATION-1.7.md` in the repository for the layouts that change.

### Example

```jsx
const RowStyles = {
  display: 'flex',
  justifyContent: 'flexStart',
  width: 1760,
  height: 300,
  gap: 26,
  y: 400,
};

<view style={RowStyles}>
  <text>TV Shows</text>
  <text>Movies</text>
  <text>Sports</text>
  <text>News</text>
</view>;
```

When a `<view>` with `display: flex` contains text nodes as children, Solid measures each text with the renderer's `measure()` right after the change, before the next frame, and calls `updateLayout` on the container to recalculate the flex layout from the measured sizes. It does not wait for the text's `loaded` event. A text whose font is not loaded yet waits for the font, then lays out once. Change a text's props on the element (`fontSize`, `text`, a `transition`), not on its renderer node (`el.lng`): Solid is not told about writes made there, and the container keeps the old size.

### Flex Properties

- **`alignItems`**: 'flexStart' | 'flexEnd' | 'center'
- **`alignSelf`**: 'flexStart' | 'flexEnd' | 'center' (Overrides `alignItems` for an individual flex item)
- **`display`**: 'flex' | 'block' (to disable flex on Row & Column)
- **`direction`**: 'ltr' | 'rtl' display items from left to right or right to left. ltr is the default.
- **`flexDirection`**: 'row' | 'column' | 'row-reverse' | 'column-reverse'
- **`flexBoundary`**: 'contain' | 'fixed' (Default updates container size based on children size with `justifyContent: flexStart | flexEnd`. Set to `fixed` to use parent width when width isn't set.)
- **`flexCrossBoundary`**: 'fixed' | 'contain' (Defines how the flex container's cross-axis size is determined. Default is 'contain'.)
- **`flexItem`**: boolean (Set to `false` on a child to exclude it from flex calculations.)
- **`flexOrder`**: number (Set the order on children to change the layout order.)
- **`flexGrow`**: number (Set to number on children to specify how much room elements should take up.)
- **`flexShrink`**: number (Set to number on children to specify how much an element should shrink proportionally if the container overflows. Defaults to 0.) With two or more items, a `flexShrink` or `flexGrow` on any of them makes a container without a `flexBoundary` behave as `fixed`: it keeps its own size instead of sizing itself to its items.
- **`flexBasis`**: number | 'auto' (Set the default size of an item before the remaining space is distributed. Overrides width/height for positioning.)
- **`flexWrap`**: 'nowrap' | 'wrap' | 'wrap-reverse' (Set to `wrap` or `wrap-reverse` to have elements flow to the next line on overflow.)
- **`gap`**: number
- **`rowGap`**: number
- **`columnGap`**: number
- **`justifyContent`**: 'flexStart' | 'flexEnd' | 'center' | 'spaceBetween' | 'spaceEvenly'

### Flex Grow

Flex grow is useful for laying out items where one item you may not know the size and you want the other items to take up the remainder of the space:

```jsx
<view width={600} display="flex" gap={20} height={42} y={100} x={150}>
  <text fontSize={42}>Flex Grow</text>
  <view flexGrow={1} height={4} y={19} color={'#ff3000'} />
</view>
```

Produces:
![Flex Grow](../images/flexGrow.png)

We can also have multiple elements with flexGrow property. Flex will divide up the remaining space and give flexGrow \* size to each item.

```jsx
<view width={600} display="flex" gap={20} height={42} y={100} x={150}>
  <text fontSize={42}>Flex Grow</text>
  <view flexGrow={1} height={4} y={19} color={'#ff3000'} />
  <view flexGrow={3} height={4} y={19} color={'#ff30ff'} />
  <view flexGrow={1} height={4} y={19} color={'#003C0F'} />
</view>
```

Produces:
![Flex Grow](../images/flexGrow-multiple.png)

### Padding and margin

`padding` is read from the flex container: it is the space between the container's edges and its items. `margin` is read from each item. Both take a number for all four sides, or a CSS-style array:

- **`padding`**: number | [number, number] | [number, number, number] | [number, number, number, number] (Specifies the padding on the container. A four value array is `[Top, Right, Bottom, Left]`, as in CSS. Two values are `[vertical, horizontal]`, three are `[Top, horizontal, Bottom]`.) A padding applies to both axes: items start at the padding on the main axis and, with `alignItems`, `alignSelf` or wrapping, on the cross axis.
- **`paddingTop`**: number (Overrides the top value of `padding`.)
- **`paddingRight`**: number (Overrides the right value of `padding`.)
- **`paddingBottom`**: number (Overrides the bottom value of `padding`.)
- **`paddingLeft`**: number (Overrides the left value of `padding`.)
- **`margin`**: number | [number, number] | [number, number, number] | [number, number, number, number] (Specifies the margins on an item, with the same array forms as `padding`.)
- **`marginBottom`**: number
- **`marginLeft`**: number
- **`marginRight`**: number
- **`marginTop`**: number

A non-zero `marginTop`, `marginRight`, `marginBottom` or `marginLeft` takes precedence over the same side of `margin`.

Note: `alignItems` supports `flexStart`, `flexEnd`, and `center`, but requires the container to have a height/width set.

## Layout Callbacks

When a container with `display: flex` undergoes layout during initial rendering, `updateLayout` is called to calculate the flex layout. You can use `onLayout` hooks to update the element with after flex has performed it's calculations and its text has been measured.

- **`onLayout`**: Use this callback to update the element after flex calculation.

If you ever need to re-render a child element, call `updateLayout` on the parent to perform the layout again. You can also set `updateLayoutOn` prop to a signal which calls updateLayout whenever the prop changes. Lastly, when a flex container has an element added or removed, it will automatically call `updateLayout`.
