// Opens every demo-app route in headless Chromium (real WebGL) and reports
// console errors, page errors and failed requests per route.
//
//   node bench/demo/check-routes.mjs <dist dir> [--tmdb fixtures|live] [--shots <dir>] [--only a,b]
//
// <dist dir> is a built demo (e.g. ../solid-demo-app-1.7/dist or dist-bench/A).
// Each route gets a fresh page, ~4s to render, then Right/Down/Left/Up presses.
// Exits 1 if any route logged an error.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROUTES, launchChromium, routeTmdbFixtures, serveDir } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const dist = resolve(
  args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ||
    'dist',
);
const tmdb = opt('tmdb', 'fixtures');
const shots = opt('shots', null);
const only = opt('only', null)?.split(',');

const routes = ROUTES.filter((r) => !only || only.includes(r));

const server = await serveDir(dist);
const browser = await launchChromium();
if (shots) mkdirSync(shots, { recursive: true });
const unknownTmdb = new Set();
const report = [];

for (const route of routes) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  if (tmdb === 'fixtures')
    await routeTmdbFixtures(context, server.origin, (p) => unknownTmdb.add(p));
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error')
      errors.push(`console: ${m.text().split('\n')[0]}`);
    else if (m.type() === 'warning') warnings.push(m.text().split('\n')[0]);
  });
  page.on('pageerror', (e) =>
    errors.push(`pageerror: ${e.message.split('\n')[0]}`),
  );
  page.on('requestfailed', (r) =>
    errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`),
  );
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  await page.goto(`${server.origin}/#/${route}`);
  await page.waitForTimeout(4000);
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
  if (shots)
    await page.screenshot({
      path: join(shots, `${route.replace(/\//g, '_') || 'root'}.png`),
    });
  report.push({ route, errors, warnings });
  console.log(
    `${errors.length ? 'ERR ' : 'ok  '} #/${route}${errors.length ? '' : warnings.length ? `  (${warnings.length} warnings)` : ''}`,
  );
  for (const e of [...new Set(errors)]) console.log(`       ${e}`);
  for (const w of [...new Set(warnings)]) console.log(`       warn: ${w}`);
  await context.close();
}

await browser.close();
await server.close();
if (unknownTmdb.size)
  console.log(
    `\nTMDB paths without a fixture (answered with a generic list):\n  ${[...unknownTmdb].join('\n  ')}`,
  );
const bad = report.filter((r) => r.errors.length);
console.log(
  `\n${report.length - bad.length}/${report.length} routes without errors (${dist}, tmdb=${tmdb})`,
);
process.exit(bad.length ? 1 : 0);
