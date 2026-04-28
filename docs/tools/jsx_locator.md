# JSX Locator Plugin

The JSX Locator is a Babel plugin included in `@solidtv/solid` that automatically injects `componentName` and `componentSource` attributes into every JSX component at build time, making it easier for you to debug your SolidTV applications.

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

export default defineConfig({
  plugins: [
    solidPlugin({
      babel: {
        plugins: ['@solidtv/solid/src/devtools/jsx-locator.js'],
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
>       ? ['@solidtv/solid/src/devtools/jsx-locator.js']
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
