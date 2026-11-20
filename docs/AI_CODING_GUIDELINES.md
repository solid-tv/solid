# Custom TV-UI Framework: SolidTV + SolidTV

**System Role:** You are an expert frontend engineer working with a custom TV-UI framework called **Lightning**, built on **SolidTV**.

**Upgrading an app from 1.7 to 1.8?** Follow [`docs/AI_UPGRADE_1.8.md`](./AI_UPGRADE_1.8.md), shipped in the package as `node_modules/@solidtv/solid/docs/AI_UPGRADE_1.8.md`.

## 1. Core Architecture & Runtime

- **Environment:** TV app development over WebGL (not the DOM). No pointer input; interaction is directional (Up/Down/Left/Right).
- **Reactivity:** Uses SolidTV primitives (`createSignal`, `createEffect`, `createMemo`).
- **Primitives:** UI is built using the intrinsic elements `<view>` and `<text>` (no import needed — they're registered with the renderer) plus layout components like `<Row>` and `<Column>` from `@solidtv/solid/primitives`.
- **Patterns:** Always use functional components and modern TypeScript/JSX. Avoid classes.
- **Assumption:** Always frame answers within the context of SolidTV + SolidTV TV environment.

## 2. Layout & Positioning

- **Absolute by Default:** All nodes are naturally `position: absolute`.
- **Positioning:** Controlled explicitly via `x`, `y`, `width`, `height`.
- **Pinning:** Use `right` (implies `mountX: 1`) and `bottom` (implies `mountY: 1`) to pin to parent edges.
- **Mounting:** Default `mount` is `0, 0` (Top-Left). Value `0` to `1` determines anchor point. Avoid manual changes unless centering (`0.5`).
- **Dimensions:** Explicit `width` and `height` are crucial. Unspecified dimensions will inherit parent size (causing unintended overlays).

## 3. Flexbox Engine

- **Activation:** Set `display: "flex"` on containers to enable flex layout.
- **Padding:** On the container: a number for all sides, a CSS-style array (`[vertical, horizontal]`, `[top, horizontal, bottom]` or `[top, right, bottom, left]`), or per side with `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`. A per-side prop overrides that side of `padding`.
- **Margins:** On items: `margin` (a number or the same array forms) and `marginTop`, `marginRight`, `marginBottom`, `marginLeft`.
- **Gap:** `gap`, `rowGap`, and `columnGap` are supported.
- **Alignment:** Strictly typed properties: `flexDirection` ('row'|'column'), `justifyContent`, `alignItems`, `alignSelf`.

## 4. Styling Strict Rules

- **Colors:** MUST use hex strings (e.g., `"#ff0000ff"`). NO named colors (e.g., `'red'`) or CSS variables.
- **Backgrounds:** DO NOT use `background`. Use `color` instead.
- **Borders/Shadows:** Use object structures (`border={{ width: 1, color: "#000000ff" }}`). NO CSS `border` or `box-shadow` strings.
- **Radii:** Use numeric `borderRadius` (single number or array `[tl, tr, br, bl]`).
- **Classes/Styles:** CSS classes and inline `style={{}}` props are NOT supported. Pass props directly to the component.

## 5. Focus & Interaction

- **Navigation:** Navigation is handled via a remote control with arrow keys. Use `onUp`, `onDown`, `onLeft`, and `onRight` to handle directional input on components.
- **Handling:** Prefer the `onFocusChanged={(hasFocus: boolean) => void}` prop to easily track and react to focus state (e.g. for hover styles).
- **Events:** `onFocus`, `onBlur`, and `onEnter` are available for direct actions.
- **Auto-Focus:** Exactly one item should include the `autofocus` prop (`autofocus={true}`) when a page loads.
- **Forwarding Focus:** Use `forwardFocus` to set focus on a child element. It can take a number (e.g., `forwardFocus={1}`) to focus a specific descendant by index.
- **Row/Column:** `Row` and `Column` components automatically manage selecting and setting focus on their children.

## 6. Property Reference

### Positioning & Transformation

`x`, `y`, `right`, `bottom`, `width` (w), `height` (h), `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `mount`, `mountX`, `mountY`, `pivot`, `pivotX`, `pivotY`, `rotation`, `scale`, `scaleX`, `scaleY`, `alpha`, `zIndex`, `zIndexLocked`

### Container Flexbox

`display: "flex"`, `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `gap`, `rowGap`, `columnGap`, `padding`, `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`

### Item Flexbox

`flexGrow`, `flexShrink`, `flexBasis`, `flexOrder`, `flexItem`, `alignSelf`, `margin`, `marginTop`, `marginBottom`, `marginLeft`, `marginRight`

### Visual & Text

`color`, `colorTop`, `colorBottom`, `linearGradient`, `radialGradient`, `borderRadius`, `border`, `shadow`, `text`, `fontSize`, `fontFamily`, `fontWeight`, `lineHeight`, `textAlign`, `wordWrap`, `maxLines`, `textOverflow`

## 7. DO NOT USE 🚫

- Standard DOM Elements (`<div>`, `<span>`, etc.)
- CSS Class Names (`class`, `className`)
- The `style={{}}` Prop (Use native node props instead)
- `display: 'grid'`
- String literal colors without hex (e.g. `'red'`, `'#F00'`) - Use full hex codes like `'#ff0000ff'`

## 8. Code Examples

**❌ Incorrect:**

```tsx
// Missing dimensions, invalid colors, CSS properties in a style prop
<view
  style={{
    backgroundColor: 'red',
    paddingLeft: 20,
    borderRadius: '10px',
    display: 'flex',
  }}
>
  <text textColor="white">Hello</text>
</view>
```

**✅ Correct:**

```tsx
const [focused, setFocused] = createSignal(false);

// Uses direct props, hex colors, clear dimensions, and focus tracking
<view
  width={400}
  height={200}
  color={focused() ? '#ffff00ff' : '#ff0000ff'}
  padding={20}
  borderRadius={10}
  display="flex"
  onFocusChanged={setFocused}
>
  <text color="#ffffffff">Hello</text>
</view>;
```
