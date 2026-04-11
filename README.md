<p>
  <img src="https://assets.solidjs.com/banner?project=Library&type=@solidtv/solid" alt="SolidTV" />
</p>

# SolidTV

SolidTV is a UI framework for building high-performance TV applications. It allows you to declaratively construct UI nodes with reactive primitives, providing incredible performance on even the most constrained hardware.

## Used by companies worldwide

<div style="display: flex; align-items: center; gap: 20px;">
  <img src="docs/companylogos/Angel.png" alt="Angel Studios" width="200" /> &nbsp; <img src="docs/companylogos/bell-fibe-tv.png" alt="Bell Fibe TV" width="80" />
</div>

## Need Support?

[SolidTV Docs](https://solid-tv.github.io/solid/)

Join the [SolidTV Discord](https://discord.com/invite/solidjs) - #SolidTV channel and message chiefcll

## Documentation

[SolidTV Docs](https://solid-tv.github.io/solid/)

[AI Coding Guidelines](docs/AI_CODING_GUIDELINES.md)

## Demo App

[SolidTV TMDB Demo App](https://github.com/solid-tv/solid-demo-app)

Tested and working on Chrome < 38 and could go earlier

## Playground

[playground.solidjs.com](https://playground.solidjs.com/anonymous/b36869ea-e7df-4f7a-af34-67222bc04271)

## Quick Start

Clone starter template:

```sh
> npx degit solid-tv/solid-starter-template my-app
> cd my-app
> npm i # or yarn or pnpm
> npm start # or yarn or pnpm
```

## Video Quick (actually it's long) Start

[![Watch the video](https://img.youtube.com/vi/9UU7Ntf7Tww/0.jpg)](https://www.youtube.com/watch?v=9UU7Ntf7Tww)

Read the article:
https://medium.com/@chiefcll/lightning-3-the-basics-of-solidjs-e6e21d73205e

### Hello World

```jsx
import { render, Text } from '@solidtv/solid';

render(() => <Text>Hello World</Text>);
```

For a more detailed Hello World guide check out the [Hello World](HelloWorld.md) guide.

## Migration Guide from previous repo:

If you're migrating from https://github.com/lightning-js/solid

Find and replace:
"@solidtv/solid-primitives" with "@solidtv/solid/primitives"
"@solidtv/solid" with "@solidtv/solid"

Update vite.config to dedupe solid:

```js
resolve: {
    dedupe: [
      "solid-js",
      "@solidtv/solid",
      "@solidtv/solid/primitives",
      "@solidtv/solid-ui",
    ],
  },
```

If you don't want to find and replace you can use alias

```js
resolve: {
    alias: {
      "@solidtv/solid": "@solidtv/solid",
      "@solidtv/solid-primitives": "@solidtv/solid/primitives",
    },
  },
```
