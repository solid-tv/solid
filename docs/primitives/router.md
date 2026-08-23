# Hash Router

`createHashRouter` builds a hash-based router for TV devices, where apps are
often served from a path that cannot use history routing.

It is a thin factory over [Solid Router](https://github.com/solidjs/solid-router)'s
`createRouter` with its `hashHistory()` adapter. What SolidTV adds is a
`paramsWrapper`/`queryWrapper` pair for older browsers without `Proxy`
(Chrome < 49 — see [Legacy Devices](/deploy/legacy.md)). Because those engines
cannot discover query keys lazily, list the ones you read in `queryParams`.

### Usage

```jsx
import { createHashRouter } from '@solidtv/solid/primitives/router';

const Router = createHashRouter({
  queryParams: ['id', 'search', 'otherParam'],
  routes: [
    { path: '/', component: HelloWorld },
    { path: '/text', component: TextPage },
    { path: '/*all', component: NotFound },
  ],
});

render(() => <Router>{(props) => <App>{props.children}</App>}</Router>);
```

### Options

Everything `createRouter` accepts (`routes`, `base`, `preload`, `explicitLinks`,
`preloadLinks`, …) plus:

| Option        | Type       | Description                                                                                                                         |
| ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `queryParams` | `string[]` | Query keys to expose when running without `Proxy`. Unlisted params are not reactive on those engines. Ignored where `Proxy` exists. |
| `forceProxy`  | `boolean`  | Use the Proxy-free params/query implementation even where `Proxy` is available. Useful for testing the legacy path.                 |

`history` is not accepted — the adapter is always `hashHistory()`.

### Also exported

`hashParser`, `bindEvent`, `SUPPORTS_PROXY`, `createMemoWithoutProxy`,
`collectDynamicParams`, and the `Branch` type.

> **Migrating from 1.x?** `<HashRouter>` was a component that took `<Route>`
> children. Solid Router 2.0 made routes plain data, so the router is now built
> from a `routes` array up front. See the
> [migration guide](/articles/migration-1x-to-2.0.md#routing).
