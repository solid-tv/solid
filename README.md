<p>
  <img src="https://assets.solidjs.com/banner?project=Library&type=@solidtv/solid" alt="SolidTV" />
</p>

# SolidTV

SolidTV is a UI framework for building high-performance TV applications. It allows you to declaratively construct UI nodes with reactive primitives, providing incredible performance on even the most constrained hardware.

**Coming from `@lightningtv/solid`?** The project moved here and is now `@solidtv/solid`. See the [migration guide](https://solid-tv.github.io/solid/#/migrate).

**[Commercial support available](https://solidtv.dev/#services)** from the creator of SolidTV: support plans, performance audits, migrations and Apple TV ports.

## Used by companies worldwide

<div style="display: flex; align-items: center; gap: 20px;">
  <img src="docs/companylogos/Angel.png" alt="Angel Studios" width="200" /> &nbsp; <img src="docs/companylogos/bell-fibe-tv.png" alt="Bell Fibe TV" width="80" /> &nbsp; <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/companylogos/watch-brasil.png" />
    <img src="docs/companylogos/watch-brasil-dark.png" alt="Watch Brasil" width="120" />
  </picture> &nbsp; <a href="https://www.cheknews.ca">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/companylogos/chek-news.png" />
      <img src="docs/companylogos/chek-news-dark.png" alt="CHEK News" height="46" />
    </picture>
  </a>
</div>

## Need Support?

[SolidTV Docs](https://solid-tv.github.io/solid/)

Join the [SolidTV Discord](https://discord.com/invite/solidjs) - #SolidTV channel and message chiefcll

[Commercial support](https://solidtv.dev/#services) - support plans with priority answers and bug fixes, performance audits for any web-based TV app, migrations to SolidTV, Apple TV ports and team training

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
import { render } from '@solidtv/solid';

render(() => <text>Hello World</text>);
```

For a more detailed Hello World guide check out the [Hello World](HelloWorld.md) guide.

## Migrating from @lightningtv/solid

This project used to live at https://github.com/lightning-tv/solid and was published as `@lightningtv/solid`. To move an existing app to `@solidtv/solid`, follow the [migration guide](https://solid-tv.github.io/solid/#/migrate).
