# JSX Locator Plugin

The JSX Locator is a Babel plugin included in `@solidtv/solid` that automatically injects `componentName` and `componentSource` attributes into every JSX component at build time. These attributes allow the [SolidTV Devtools](/tools/solid_devtools.md) inspector to identify which source file and line number produced any given node in the render tree.

## How It Works

Because the SolidJS JSX transform converts JSX into plain function calls before most Babel visitors run, a standard `JSXOpeningElement` visitor never fires. The plugin works around this by running a manual traversal inside `Program.enter`, which executes **before** the SolidJS plugin processes the file. This ensures the attributes are injected while the JSX AST is still intact.

For each capitalized JSX element (i.e. a component, not a native tag like `<View>`), the plugin adds:

| Attribute         | Value                        | Example                              |
| ----------------- | ---------------------------- | ------------------------------------ |
| `componentName`   | The JSX tag name as a string | `"MyButton"`                         |
| `componentSource` | `relativePath:line:column`   | `"src/components/MyButton.tsx:12:4"` |

## Setup

### 1. Add the Plugin to Your Vite Config

The plugin ships as a plain Babel plugin file. Reference it directly in your Vite configuration using the `babel` option of `vite-plugin-solid`:

```ts
// vite.config.ts
import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    solidPlugin({
      babel: {
        plugins: [
          // jsx-locator must come BEFORE the SolidJS transform
          path.resolve(
            __dirname,
            'node_modules/@solidtv/solid/src/devtools/jsx-locator.js',
          ),
        ],
      },
      solid: {
        moduleName: '@solidtv/solid',
        generate: 'universal',
      },
    }),
  ],
});
```

> **Note:** The plugin is only useful during development. You may conditionally include it based on `process.env.NODE_ENV`:
>
> ```ts
> babel: {
>   plugins: [
>     ...(process.env.NODE_ENV === 'development'
>       ? [path.resolve(__dirname, 'node_modules/@solidtv/solid/src/devtools/jsx-locator.js')]
>       : []),
>   ],
> },
> ```

### 2. Verify Attribute Injection

After adding the plugin, build or start your dev server and inspect the output. Any component JSX element will have the extra props passed through:

```tsx
// Source
<MyButton label="Click me" />;

// After transform (conceptually)
createComponent(MyButton, {
  label: 'Click me',
  componentName: 'MyButton',
  componentSource: 'src/components/App.tsx:8:4',
});
```

The `ElementNode` class in `@solidtv/solid` accepts and stores these props, making them available to the devtools inspector.

## Integration With SolidTV Devtools

The `componentName` and `componentSource` attributes are consumed by the Solid Devtools inspector. When you hover over or select a node in the devtools panel, it can display the originating component name and provide a "jump to source" link for your IDE.

See [Integrating with SolidTV Devtools](/tools/solid_devtools.md) for the full devtools setup guide.

## Troubleshooting

**Attributes are not appearing on nodes**

- Ensure the plugin is listed **before** `vite-plugin-solid` in the `babel.plugins` array — or more precisely, before the SolidJS JSX transform runs.
- Confirm the path to `jsx-locator.js` is correct for your project layout.

**All nodes get attributes, not just components**

This is by design — the plugin intentionally skips lowercase tags (native renderer elements like `<View>`) and only injects attributes into capitalized component names.

**Build errors about unknown JSX attributes**

If TypeScript complains about `componentName` or `componentSource` on component props, add them to your global JSX intrinsic types or suppress with `// @ts-expect-error` on the generated output. Since the attributes are injected at the Babel transform stage and not written in source, you should not see these errors in normal usage.
