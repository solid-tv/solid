// Proves a demo build bundles exactly one copy of solid-js and of
// @solidtv/renderer, and shows which @solidtv/solid and renderer it bundled,
// from the sourcemaps' `sources` (build with --sourcemap=true).
//
//   node bench/demo/bundle-copies.mjs <dist dir> [--legacy]
//
// Every bundled module's real path is grouped by package root, so two copies of
// one package (two node_modules/.pnpm entries, or a link and an arm dir) show
// as two roots. Exits 1 if solid-js or @solidtv/renderer has more than one.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Package root of a bundled source path: the package under the last
// node_modules, or for linked checkouts and bench arms, the checkout.
function pkgRoot(p) {
  const nm = p.lastIndexOf('/node_modules/');
  if (nm !== -1) {
    const rest = p.slice(nm + '/node_modules/'.length).split('/');
    const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    return { name, root: p.slice(0, nm) + '/node_modules/' + name };
  }
  const m = p.match(
    /^(.*?\/(?:solid-1\.7\/bench\/\.arms\/[^/]+|renderer-v2-solid|solid-1\.7|solid-demo-app-1\.7))\//,
  );
  if (m) {
    const root = m[1];
    const name = /renderer/.test(root)
      ? '@solidtv/renderer'
      : /demo-app/.test(root)
        ? '(app)'
        : '@solidtv/solid';
    return { name, root };
  }
  return { name: '(other)', root: dirname(p) };
}

/** Map of package name -> Map(root -> module count) for one build. */
export function bundleCopies(dist, { legacy = false } = {}) {
  const assets = join(resolve(dist), 'assets');
  const maps = readdirSync(assets).filter(
    (f) => f.endsWith('.js.map') && f.includes('-legacy') === legacy,
  );
  if (maps.length === 0) {
    throw new Error(
      `no ${legacy ? 'legacy ' : ''}sourcemaps in ${assets} (build with --sourcemap=true)`,
    );
  }
  const sources = new Set();
  for (const f of maps) {
    const map = JSON.parse(readFileSync(join(assets, f), 'utf8'));
    for (const s of map.sources || [])
      sources.add(resolve(assets, map.sourceRoot || '', s));
  }
  const byPkg = new Map();
  for (const s of sources) {
    const { name, root } = pkgRoot(s);
    if (!byPkg.has(name)) byPkg.set(name, new Map());
    const roots = byPkg.get(name);
    roots.set(root, (roots.get(root) || 0) + 1);
  }
  return byPkg;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] || 'dist';
  const byPkg = bundleCopies(dist, {
    legacy: process.argv.includes('--legacy'),
  });
  const watch = [
    'solid-js',
    '@solidtv/renderer',
    '@solidtv/solid',
    '@solidjs/router',
  ];
  const rest = [...byPkg.keys()].filter((n) => !watch.includes(n)).sort();
  let bad = false;
  for (const name of [...watch, ...rest]) {
    const roots = byPkg.get(name);
    if (!roots) {
      if (watch.includes(name)) console.log(`${name}: (not bundled)`);
      continue;
    }
    if (roots.size > 1 && (name === 'solid-js' || name === '@solidtv/renderer'))
      bad = true;
    const flag = roots.size > 1 ? '  <-- MORE THAN ONE COPY' : '';
    console.log(
      `${name}: ${roots.size} cop${roots.size === 1 ? 'y' : 'ies'}${flag}`,
    );
    for (const [root, n] of roots) console.log(`    ${root}  (${n} modules)`);
  }
  process.exit(bad ? 1 : 0);
}
