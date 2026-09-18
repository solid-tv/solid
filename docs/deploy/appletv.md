# Deploying to Apple TV (tvOS)

tvOS gives third-party apps no browser and no WebView, so the hosted and bundled web app models used for Tizen, webOS and Android TV do not apply. SolidTV runs on Apple TV through [NativeScript](https://nativescript.org/) instead: your JavaScript runs in V8 inside a native app, and the renderer draws into a native WebGL view. There is no HTML page anywhere in the stack.

The host between NativeScript and SolidTV is [`@solidtv/nativescript`](https://github.com/solid-tv/nativescript). With it, an app written for the browser runs on Apple TV **from the same `src/`**, with a small NativeScript project beside it. The [SolidTV demo app](https://github.com/solid-tv/solid-demo-app/tree/main/nativescript) is the worked example this guide follows: its web entry, `HashRouter`, focus manager, `fetch` calls, relative asset URLs and `loadFonts` all run unchanged.

## How It Works

| Piece                           | Role                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NativeScript (`tvos` builds)    | The runtime: V8 plus the tvOS app shell, built and deployed with the `ns` CLI.                                                                             |
| `@nativescript/canvas`          | A native `Canvas` view with a WebGL context — the surface the renderer draws into.                                                                         |
| `@nativescript/canvas-polyfill` | Browser-shaped globals the renderer expects: `document`, `XMLHttpRequest`, `Image`, `createImageBitmap`, …                                                 |
| `@solidtv/nativescript`         | The host: a renderer platform for the Canvas view, shims for the globals the polyfill lacks, a Siri Remote → key event bridge, and app lifecycle bindings. |
| `@solidtv/nativescript/webpack` | `chainSolidTV`, which teaches `@nativescript/webpack` to compile Solid JSX for `@solidtv/solid` and mirror the parts of your Vite config the bundle needs. |

The build uses **webpack, not Vite**: `@nativescript/vite` has no tvOS platform. Your web build keeps using Vite; only the tvOS bundle goes through webpack.

> **Version requirements.** Running a browser app unchanged needs the releases **after** `@solidtv/solid` 1.6.3 (`Config.preventDefaultOnHandledKeys`), `@solidtv/renderer` 1.9.3 (`setDefaultPlatform` and the `Platform.resolveSettings` hook) and `@solidtv/nativescript` 0.1.1 (`bindCanvas`, the full shims, `mirrorConsole`). Until those are published, link the three packages from sibling checkouts as the demo does — see [package.json](#packagejson) below.

## Prerequisites

Apple TV builds need a Mac.

- **Xcode 26.4** with the tvOS platform. `xcodebuild -downloadPlatform tvOS` installs the simulator runtime.
- **pnpm 10** and Node 18 or later.
- **Ruby with the `xcodeproj` gem**: `gem install --user-install xcodeproj`. The NativeScript CLI merges xcconfig files with it and fails without it. CocoaPods is not needed.
- **A UTF-8 locale** in the shell that runs `ns`. An interactive terminal usually has one; a script or CI shell needs `LC_ALL=en_US.UTF-8` on every `ns` command, or the `xcodeproj` gem fails reading the xcconfig files.

You do not install the NativeScript CLI globally — the tvOS build of it is a dev dependency of the project below.

## Project Layout

Create a `nativescript/` folder in your SolidTV project, next to `src/`, the same way the other guides use `tizen/`, `lg/` and `androidtv/`. It holds only the host; nothing in `src/` is written for it.

```
my-app/
├── src/                     # your app, shared with the web build
├── public/                  # fonts and assets, shared with the web build
├── vite.config.js           # the web build
└── nativescript/
    ├── app/app.ts           # the boot file
    ├── App_Resources/       # Info.plist, build.xcconfig, icons
    ├── stubs/               # stand-ins for packages with no tvOS build
    ├── nativescript.config.ts
    ├── webpack.config.js
    ├── tsconfig.json
    ├── references.d.ts
    ├── package.json
    └── pnpm-workspace.yaml  # makes this folder its own pnpm root
```

### package.json

The NativeScript packages come from the `tvos` dist-tags, and `@nativescript/canvas` must be 3.0.0-alpha.10 or later — the first build with tvOS slices. List your app's own runtime dependencies here too (`solid-js`, the router, anything `src/` imports), since this folder resolves modules on its own.

```json
{
  "name": "my-app-tvos",
  "private": true,
  "main": "app/app.ts",
  "scripts": {
    "tvos": "ns run tvos --emulator --no-hmr",
    "build:tvos": "ns build tvos",
    "clean": "ns clean"
  },
  "dependencies": {
    "@nativescript/canvas": "3.0.0-alpha.10",
    "@nativescript/canvas-polyfill": "3.0.0-alpha.10",
    "@nativescript/core": "9.2.0-tvos.0",
    "@solidjs/router": "^0.16.1",
    "@solidtv/nativescript": "link:../../nativescript",
    "@solidtv/renderer": "link:../../renderer",
    "@solidtv/solid": "link:../../solid",
    "solid-js": "^1.9.9"
  },
  "devDependencies": {
    "@nativescript/ios": "9.1.0",
    "@nativescript/tvos": "9.1.0",
    "@nativescript/types": "9.1.1",
    "@nativescript/webpack": "5.0.39-tvos.0",
    "nativescript": "9.2.0-tvos.0",
    "typescript": "~6.0.0"
  },
  "packageManager": "pnpm@10.33.4"
}
```

The three `link:` entries point at sibling checkouts of [nativescript](https://github.com/solid-tv/nativescript), [renderer](https://github.com/solid-tv/renderer) and [solid](https://github.com/solid-tv/solid), each built with `pnpm build`. Replace them with version pins once the releases in the note above are published.

### pnpm-workspace.yaml

This file makes `nativescript/` its own pnpm root, so installing here never touches your app's lockfile, and it settles three things the NativeScript toolchain depends on.

```yaml
# Flat node_modules: the NativeScript CLI discovers plugins by walking
# node_modules, and @nativescript/canvas resolves its native headers from there.
nodeLinker: hoisted
onlyBuiltDependencies:
  - '@nativescript/core'
  - '@nativescript/webpack'
  - nativescript
# The alpha polyfill declares '*' on its sibling packages, which resolves to
# the 2.x line (no tvOS slices). Keep every canvas package on the same alpha.
overrides:
  '@nativescript/canvas': 3.0.0-alpha.10
  '@nativescript/canvas-media': 3.0.0-alpha.10
  # canvas-svg's xcframework has no tvOS slice and fails the tvOS build.
  '@nativescript/canvas-svg': file:./stubs/canvas-svg
```

The `canvas-svg` stand-in is a tiny package exporting the names the polyfill imports as empty classes. Copy [`stubs/canvas-svg`](https://github.com/solid-tv/solid-demo-app/tree/main/nativescript/stubs/canvas-svg) from the demo. The cost: SVG images do not decode on tvOS.

If your root `.gitignore` ignores `pnpm-workspace.yaml` or lockfiles, un-ignore the ones in this folder — they should be tracked.

### nativescript.config.ts

```ts
import { NativeScriptConfig } from '@nativescript/core';

export default {
  id: 'com.example.soliddemo',
  projectName: 'SolidTVDemo',
  appPath: 'app',
  appResourcesPath: 'App_Resources',
  bundler: 'webpack',
  cli: {
    packageManager: 'pnpm',
  },
} as NativeScriptConfig;
```

`id` is the bundle identifier. Set `projectName`, or the CLI names the app after the folder (`nativescript`).

### webpack.config.js

`chainSolidTV` adds the Solid JSX rule (universal mode, for `@solidtv/solid`), browser export conditions so `solid-js` does not resolve to its server build, and `.js` → `.ts` import resolution. Its options carry over what your Vite config does for `src/`.

```js
const path = require('path');
const webpack = require('@nativescript/webpack');
const { chainSolidTV } = require('@solidtv/nativescript/webpack');

// The app is ../src, the web build's source, untouched.
const SRC = path.resolve(__dirname, '../src');
const PUBLIC = path.resolve(__dirname, '../public');
const EMPTY = path.resolve(__dirname, 'stubs/empty.cjs');

module.exports = (env) => {
  webpack.init(env);
  webpack.chainWebpack((config) => {
    chainSolidTV(config, {
      // Only if your Vite build uses the hex color transform.
      hexColors: { include: [SRC] },
      alias: {
        // Aliases from your vite.config.js.
        theme: path.resolve(SRC, 'theme.ts'),
        // Packages that cannot run here but are imported by pages that
        // still have to bundle.
        'shaka-player': EMPTY,
      },
    });

    // The web build never type-checks (Vite only transpiles), and src/ is
    // written against its own tsconfig. Keep `tsc` in the app as the check.
    config.plugins.delete('ForkTsCheckerWebpackPlugin');

    // Fonts and assets the web build serves from public/, at the same
    // relative paths, copied into the app bundle.
    config.plugin('CopyWebpackPlugin').tap((args) => {
      args[0].patterns.push(
        { from: path.join(PUBLIC, 'fonts'), to: 'fonts' },
        { from: path.join(PUBLIC, 'assets'), to: 'assets' },
      );
      return args;
    });
  });
  return webpack.resolveConfig();
};
```

`stubs/empty.cjs` is one line, `module.exports = {};`. Use it for any dependency that needs a real DOM — a `<video>`-based player, for example.

`chainSolidTV` also takes `env` to add members to `import.meta.env`. webpack already defines `MODE`, `DEV`, `PROD` and `BASE_URL`; `BASE_URL` is `file:///app/`, which the shims map onto the app folder, so `import.meta.env.BASE_URL + 'fonts/...'` loads the copied files. If your app uses the [Hex Color Transform](/tools/hex_color_transform.md), the `hexColors` option applies the same transform as a webpack loader.

### tsconfig.json

This config only covers `app/`. The two JSX options are required; the `paths` keep types resolving through the linked packages.

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "esnext",
    "target": "ES2020",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "lib": ["ESNext", "dom"],
    "jsx": "preserve",
    "jsxImportSource": "@solidtv/solid",
    "preserveSymlinks": true
  },
  "include": ["app/**/*"],
  "files": ["./references.d.ts"],
  "exclude": ["node_modules", "platforms"]
}
```

`references.d.ts` is one line:

```ts
/// <reference path="./node_modules/@nativescript/types/index.d.ts" />
```

With `link:` dependencies you will also need `paths` entries for `solid-js`, `@solidjs/router` and the `@solidtv/renderer` exports — copy them from the [demo's tsconfig](https://github.com/solid-tv/solid-demo-app/blob/main/nativescript/tsconfig.json).

### App_Resources

The demo keeps both an `iOS/` and a `tvOS/` folder, each with an `Info.plist` and a `build.xcconfig` — copy [`App_Resources`](https://github.com/solid-tv/solid-demo-app/tree/main/nativescript/App_Resources) from it as a starting point. The part you edit is the xcconfig:

```
// App_Resources/tvOS/build.xcconfig
TVOS_DEPLOYMENT_TARGET = 16.0;
DEVELOPMENT_TEAM = <YOUR_TEAM_ID>;
```

`DEVELOPMENT_TEAM` is only needed for a physical device. Put it in **both** `build.xcconfig` files: the CLI's team lookup reads the `iOS` one even for a tvOS build.

## The Boot File

`app/app.ts` creates the native view, binds the host to it, and then imports your web entry. Order matters at the top: the polyfill first, because the renderer and the router read browser globals at import, then the shims, which fix the globals the polyfill lacks or installs unusably — a `file:` `location`, a working `history` for `HashRouter`, a `document` whose listeners fire.

```ts
import '@nativescript/canvas-polyfill';
import '@solidtv/nativescript/shims';
import { Application, Color, GridLayout } from '@nativescript/core';
import { isTvOS } from '@nativescript/core/platform';
import { Canvas } from '@nativescript/canvas';
import { Config, renderer } from '@solidtv/solid';
import {
  KeyBridge,
  bindCanvas,
  bindLifecycle,
  bindRemote,
  type PausableRenderer,
} from '@solidtv/nativescript';

// A press a handler consumed stays with the app; a Menu press nothing
// handled goes to the system and leaves the app, as tvOS expects.
Config.preventDefaultOnHandledKeys = true;

function boot(canvas: Canvas): void {
  // Your app's createRenderer() names no canvas and no platform: this view
  // and the host's platform stand in, and correct the renderer settings
  // the host cannot honour.
  bindCanvas(canvas);
  // The Siri Remote, into the bridge, onto document, where a browser app's
  // focus manager listens.
  const bridge = new KeyBridge({ target: document });
  // The renderer does not exist yet, so hand the lifecycle a getter.
  bindLifecycle(
    () => renderer as unknown as PausableRenderer | undefined,
    bridge,
    Application,
  );
  if (isTvOS) {
    bindRemote(bridge, Application.ios.window);
  }
  // Your app's own entry, unchanged.
  import('../../src/index').catch((error: unknown) => {
    console.error('The app entry failed to load', error);
  });
}

function createRootView(): GridLayout {
  const root = new GridLayout();
  root.backgroundColor = new Color('#000000');
  const canvas = new Canvas();
  canvas.width = '100%';
  canvas.height = '100%';
  // Keeps the canvas out from under tvOS's title-safe insets.
  canvas.iosOverflowSafeArea = true;
  canvas.on('ready', () => {
    // The plugin's ready callback swallows exceptions: without this, a
    // throw is a silent blank screen.
    try {
      boot(canvas);
    } catch (error: unknown) {
      console.error('Boot failed', error);
    }
  });
  root.addChild(canvas);
  return root;
}

Application.run({ create: createRootView });
```

`bindCanvas` overrides a few renderer settings regardless of what your app passes to `createRenderer`: **WebGL2** (the plugin's WebGL1 context has no vertex array objects, which quadruples GL calls per frame), **no image workers**, the startup probes skipped, and **no inspector**.

If you would rather create the renderer in the boot file and pass the host's settings yourself, `@solidtv/nativescript` also exports `rendererSettings`, `stubTarget` and `loadSdfFont` for that — see its [README](https://github.com/solid-tv/nativescript#an-app-that-passes-the-host-its-settings).

## Siri Remote

`bindRemote` turns the remote's buttons into `keydown` and `keyup` events with the key names SolidTV's default key map already knows. A held button repeats keyboard-style.

| Siri Remote    | Key event        | SolidTV handler                        |
| -------------- | ---------------- | -------------------------------------- |
| Arrows (click) | `ArrowUp` …      | `onUp` / `onDown` / `onLeft`/`onRight` |
| Select         | `Enter`          | `onEnter`                              |
| Menu / Back    | `Backspace`      | `onBack`                               |
| Play/Pause     | `MediaPlayPause` | not in the default map — add it        |

Play/Pause arrives as `MediaPlayPause` (keyCode `179`). Map it in your `useFocusManager` call to get an `onPlayPause` handler:

```jsx
useFocusManager({
  PlayPause: ['MediaPlayPause', 179],
});
```

Swipes on the touch surface are not supported; navigation is by click.

### The Menu button must be able to leave the app

tvOS expects Menu, on a screen the app cannot go back from, to return to the Home screen, and App Review expects it. The host implements this as a contract: **a Menu press your app handled stays in the app; one it left unhandled goes to the system**, which suspends the app. `Config.preventDefaultOnHandledKeys = true` is what tells the host which is which: the focus manager calls `preventDefault()` on every key event a handler consumed (returned `true`). See [Consumed Keys](/primitives/useFocusManager.md#consumed-keys-configpreventdefaultonhandledkeys).

That leaves one rule for your app: on the root screen, where there is nothing to go back to, your `onBack` handler must return `false`. This is the only change the demo app's `src/` needed for tvOS:

```jsx
const isStartPage = useMatch(() => '/browse/all');

<view
  onBack={() => {
    if (navDrawer.states.has('focus')) {
      // Nothing to walk back to: leave the key unhandled so Apple TV's
      // Menu button exits the app here, and nowhere else.
      if (isStartPage()) return false;
      navigate(-1);
    } else {
      focusNavDrawer();
    }
    return true;
  }}
/>;
```

A browser never notices the difference: `history.back()` on the first entry did nothing anyway. An `onBack` that always returns `true` traps the user in the app.

## App Lifecycle

`bindLifecycle` pauses the renderer immediately when the app is suspended (the TV button, or an unhandled Menu) and resumes it when the app returns, releasing any key the bridge was holding. No frames are drawn in the background. Returning to the app resumes the same process with its state — router, focus, signals — intact.

## Building and Running

From `nativescript/`:

```bash
pnpm install
```

Boot an Apple TV simulator — pick one from the list, then boot it and open the Simulator window:

```bash
xcrun simctl list devices available | grep "Apple TV"
```

```bash
xcrun simctl boot "<udid>" && open -a Simulator
```

Build, install and run on the booted simulator, streaming the console:

```bash
pnpm tvos
```

Or build only; the app lands in `platforms/tvos/build/`:

```bash
pnpm build:tvos
```

In the Simulator, the arrow keys, Return and Escape act as the remote's arrows, Select and Menu. **Window → Show Apple TV Remote** gives you the rest.

> The simulator's GPU is Apple's software renderer and is fill-bound — the demo's Browse page moves at 12 to 19 fps there. Simulator frame rates say nothing about a real Apple TV, which ran the host's test scenes at 60 fps. Measure performance on hardware.

### On a Physical Apple TV

Pair the TV with Xcode first (**Settings → Remotes and Devices → Remote App and Devices** on the TV, then **Window → Devices and Simulators** in Xcode), and put your team id in both `build.xcconfig` files. A free personal team works for running on your own device.

The first device build of a new bundle id needs Xcode to register the TV and create the provisioning profile. With Xcode signed in to your team, run once:

```bash
xcodebuild -project platforms/tvos/SolidTVDemo.xcodeproj -scheme SolidTVDemo -destination 'platform=tvOS,id=<udid>' -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
```

After that the CLI builds, installs and launches over the network:

```bash
pnpm exec ns run tvos --device <identifier> --no-hmr --no-watch
```

`<identifier>` is the CoreDevice identifier, the UDID or the TV's name; `xcrun devicectl list devices` shows them.

## Debugging

There is no web inspector: this is not a WebView, and `bindCanvas` turns the renderer's inspector off. Debugging is console-driven.

- **Simulator:** `pnpm tvos` streams `console.log` output. Without the CLI attached, read it from the unified log:

  ```bash
  xcrun simctl spawn <udid> log stream --style compact --predicate 'process CONTAINS "SolidTVDemo"'
  ```

- **Device:** the device transport cannot stream the console. `mirrorConsole` from `@solidtv/nativescript` writes every console line to a file in the app's container; call it at the top of `app/app.ts`:

  ```ts
  import { Application, File, knownFolders, path } from '@nativescript/core';
  import { mirrorConsole } from '@solidtv/nativescript';

  mirrorConsole(
    File.fromPath(path.join(knownFolders.temp().path, 'app-log.txt')),
    { application: Application },
  );
  ```

  Then fetch the file (`knownFolders.temp()` is `Library/Caches`):

  ```bash
  xcrun devicectl device copy from --device <identifier> --domain-type appDataContainer --domain-identifier com.example.soliddemo --source Library/Caches/app-log.txt --destination app-log.txt
  ```

  Console.app with the TV selected shows the same lines live.

Develop and debug in the browser first, where you have DevTools — the source is the same. Use the simulator to check the remote, the Menu contract and the lifecycle.

## Limitations

- **Video playback.** There is no DOM, so a `<video>` element and players built on one (Shaka, hls.js, dash.js) do not work. Playback on tvOS is a native view (`AVPlayer`), which this host does not cover yet.
- **SVG images** do not decode (the `canvas-svg` stand-in above).
- **Compressed textures:** ETC2 KTX assets built for other TVs may not load — the Apple TV HD's GPU (A8) lists PVRTC only. Ship uncompressed images unless you check the target's formats.
- **No pointer input**, so `useMouse` has nothing to listen to.
- **Image workers** are off; images decode on the main thread.
- **Navigating away** with `window.location.href = 'https://…'` has no browser to go to.
- **App Store distribution** needs a paid Apple Developer team; the export to App Store Connect has not been exercised by the demo.

Pages that hit these limits can still be bundled — alias their offending dependencies to `stubs/empty.cjs` and keep users from routing to them on tvOS.

## Support Links

- **@solidtv/nativescript**: [https://github.com/solid-tv/nativescript](https://github.com/solid-tv/nativescript)
- **Demo app tvOS project**: [https://github.com/solid-tv/solid-demo-app/tree/main/nativescript](https://github.com/solid-tv/solid-demo-app/tree/main/nativescript)
- **NativeScript**: [https://docs.nativescript.org/](https://docs.nativescript.org/)
- **@nativescript/canvas**: [https://github.com/NativeScript/canvas](https://github.com/NativeScript/canvas)
- **Apple Human Interface Guidelines — Remotes**: [https://developer.apple.com/design/human-interface-guidelines/remotes](https://developer.apple.com/design/human-interface-guidelines/remotes)
