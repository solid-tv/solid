# Hex Color Transform

A Vite plugin that transforms hex color strings (`"#RRGGBB"`, `"#RGB"`, `"#RRGGBBAA"`, `"#RGBA"`) into the `0xRRGGBBAA` numeric format required by the SolidTV renderer at build time.

This means you can write natural hex color strings in your code and have them automatically converted to the correct format.

## Installation

The plugin is included in `@solidtv/solid` — no additional packages needed.

## Usage

Import and add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { hexColorTransform } from '@solidtv/solid/devtools';

export default defineConfig({
  plugins: [hexColorTransform()],
});
```

### With Include/Exclude Filters

You can control which files the plugin processes:

```typescript
import { defineConfig } from 'vite';
import { hexColorTransform } from '@solidtv/solid/devtools';

export default defineConfig({
  plugins: [
    hexColorTransform({
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: 'src/ignore-this-directory/**',
    }),
  ],
});
```

### Options

| Option    | Type                 | Default       | Description                                       |
| --------- | -------------------- | ------------- | ------------------------------------------------- |
| `include` | `string \| string[]` | all files     | Glob pattern(s) specifying which files to process |
| `exclude` | `string \| string[]` | no exclusions | Glob pattern(s) specifying which files to skip    |

## How It Works

The plugin runs during Vite's `transform` step and converts all hex color string literals to `0xRRGGBBAA` numeric literals.

### Before

```typescript
const color = '#f6f6f6';
const shortColor = '#fff';
const alphaColor = '#f6f6f680';
const shortAlpha = '#fff8';
```

### After

```typescript
const color = 0xf6f6f6ff;
const shortColor = 0xffffffff;
const alphaColor = 0xf6f6f680;
const shortAlpha = 0xffffff88;
```

- 3-character hex (`#RGB`) is expanded to `#RRGGBBFF` (full opacity)
- 4-character hex (`#RGBA`) is expanded to `#RRGGBBAA`
- 6-character hex (`#RRGGBB`) gets `FF` appended for full opacity
- 8-character hex (`#RRGGBBAA`) is used as-is

## Migrating from `hexColor()`

If you were previously using the `hexColor()` helper function, you can remove all calls with a find-and-replace:

**VSCode regex find:**

```
hexColor\("(#[A-Fa-f0-9]{4,8})"\)
```

**Replace with:**

```
"$1"
```

> Be mindful of single vs double quotes — the regex matches double quotes.

After removing `hexColor()` calls, the Vite plugin handles the conversion automatically at build time.

**Tip:** Enable `editor.defaultColorDecorators` in VSCode settings (Command + , to search) to get built-in color highlighting for hex strings.
