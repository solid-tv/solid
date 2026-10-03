// Shared helpers for the demo-app harness (run-demo.mjs, check-routes.mjs):
// Playwright from this repo's devDependencies, a static server for a demo
// build, and offline TMDB fixtures.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const here = dirname(fileURLToPath(import.meta.url));
export const solidRoot = resolve(here, '../..');
export const demoRoot = resolve(
  process.env.DEMO_ROOT || join(solidRoot, '../solid-demo-app-1.7'),
);

// playwright is not a direct dependency: reach it through @vitest/browser-playwright.
export function loadPlaywright() {
  const req = createRequire(join(solidRoot, 'package.json'));
  return createRequire(req.resolve('@vitest/browser-playwright/package.json'))(
    'playwright',
  );
}

// New headless on the full Chromium: hardware WebGL through ANGLE/Metal on a
// Mac. The default headless shell falls back to SwiftShader (software GL),
// which puts GPU emulation on the CPU being measured.
export async function launchChromium({ headed = false } = {}) {
  const { chromium } = loadPlaywright();
  return chromium.launch({ headless: !headed, channel: 'chromium' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ktx': 'application/octet-stream',
  '.pvr': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

// Serves a built app. Same isolation headers as the demo's dev server
// (vite.config.js server.headers), which also gives performance.now() its
// fine-grained resolution. /__blank is an empty same-origin page to set up a
// context on before the app loads. /__tmdb-img/* serves fixture posters.
export function serveDir(dir) {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html')))
    throw new Error(`no index.html in ${root}`);
  const server = createServer((req, res) => {
    const headers = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__blank') {
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.html'] });
      return res.end('<!doctype html><title>blank</title>');
    }
    if (url.pathname.startsWith('/__tmdb-img/')) {
      const png = fixtureImage(url.pathname.slice('/__tmdb-img/'.length));
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'image/png',
        'Content-Length': png.length,
      });
      return res.end(png);
    }
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) {
      res.writeHead(403, headers);
      return res.end();
    }
    if (existsSync(file) && statSync(file).isDirectory())
      file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, headers);
      return res.end('not found');
    }
    res.writeHead(200, {
      ...headers,
      'Content-Type':
        MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': statSync(file).size,
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// TMDB fixtures
//
// The app reads TMDB with a v4 token from src/api/key.ts, which is gitignored
// and exists only in the main checkout. Instead of the network, the harness
// answers api.themoviedb.org from deterministic data in TMDB's documented
// response shapes and serves the images itself, so runs are offline and every
// arm sees the same rows, titles and image sizes. The content is synthetic:
// absolute numbers differ from a run against the live API.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++)
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const WORDS = (
  'the night river last city dark light edge storm silent golden broken lost return ' +
  'empire shadow winter summer secret code iron glass heart fire ocean road house ' +
  'kingdom signal frontier echo machine garden dawn midnight runner station orbit'
).split(' ');
const GENRES = [
  [28, 'Action'],
  [12, 'Adventure'],
  [16, 'Animation'],
  [35, 'Comedy'],
  [80, 'Crime'],
  [99, 'Documentary'],
  [18, 'Drama'],
  [10751, 'Family'],
  [14, 'Fantasy'],
  [36, 'History'],
  [27, 'Horror'],
  [10402, 'Music'],
  [9648, 'Mystery'],
  [10749, 'Romance'],
  [878, 'Science Fiction'],
  [10770, 'TV Movie'],
  [53, 'Thriller'],
  [10752, 'War'],
  [37, 'Western'],
].map(([id, name]) => ({ id, name }));

const cap = (w) => w[0].toUpperCase() + w.slice(1);
function words(r, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(r() * WORDS.length)]);
  return out;
}
function title(r) {
  return words(r, 1 + Math.floor(r() * 4))
    .map(cap)
    .join(' ');
}
function overview(r) {
  const sentences = [];
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++)
    sentences.push(cap(words(r, 8 + Math.floor(r() * 10)).join(' ')) + '.');
  return sentences.join(' ');
}
function date(r) {
  const y = 1960 + Math.floor(r() * 65);
  const m = 1 + Math.floor(r() * 12);
  const d = 1 + Math.floor(r() * 28);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function item(id, type) {
  const r = rng(id * 2654435761);
  const t = title(r);
  const d = date(r);
  const base = {
    adult: false,
    id,
    media_type: type,
    original_language: 'en',
    overview: overview(r),
    popularity: Math.round(r() * 5000) / 10,
    poster_path: `/p-${id}.png`,
    backdrop_path: `/b-${id}.png`,
    genre_ids: [
      GENRES[id % GENRES.length].id,
      GENRES[(id * 7) % GENRES.length].id,
    ],
    vote_average: Math.round((4 + r() * 5) * 10) / 10,
    vote_count: Math.floor(r() * 20000),
  };
  if (type === 'tv') {
    return {
      ...base,
      name: t,
      original_name: t,
      first_air_date: d,
      origin_country: ['US'],
    };
  }
  if (type === 'person') {
    return {
      adult: false,
      id,
      media_type: 'person',
      name: title(r),
      original_name: title(r),
      gender: 1 + (id % 2),
      known_for_department: 'Acting',
      popularity: base.popularity,
      profile_path: `/f-${id}.png`,
      character: title(r),
      job: 'Director',
      department: 'Directing',
      known_for: [item(id + 1, 'movie'), item(id + 2, 'movie')],
    };
  }
  return {
    ...base,
    title: t,
    original_title: t,
    release_date: d,
    video: false,
  };
}

function list(seed, type, count = 20) {
  const r = rng(seed);
  const start = 1000 + Math.floor(r() * 900000);
  const results = [];
  for (let i = 0; i < count; i++) results.push(item(start + i * 13, type));
  return { page: 1, results, total_pages: 10, total_results: 200 };
}

function credits(id) {
  return {
    id,
    cast: list(id + 11, 'person', 12).results.map((p, i) => ({
      ...p,
      order: i,
      cast_id: i,
      credit_id: `c${p.id}`,
    })),
    crew: list(id + 12, 'person', 4).results.map((p) => ({
      ...p,
      credit_id: `w${p.id}`,
    })),
  };
}

function detail(id, type) {
  const base = item(id, type);
  const r = rng(id);
  const lists = {
    credits: credits(id),
    recommendations: list(id + 1, type),
    similar: list(id + 2, type),
    videos: { id, results: [] },
    images: { id, backdrops: [], posters: [], logos: [] },
    release_dates: {
      id,
      results: [
        {
          iso_3166_1: 'US',
          release_dates: [{ certification: 'PG-13', type: 3 }],
        },
      ],
    },
    content_ratings: { id, results: [{ iso_3166_1: 'US', rating: 'TV-14' }] },
    external_ids: { id, imdb_id: `tt${id}` },
    keywords: { id, keywords: [], results: [] },
  };
  return {
    ...base,
    ...lists,
    genres: [GENRES[id % GENRES.length], GENRES[(id * 7) % GENRES.length]],
    tagline: cap(words(r, 6).join(' ')) + '.',
    runtime: 80 + Math.floor(r() * 80),
    status: 'Released',
    homepage: '',
    budget: 0,
    revenue: 0,
    production_companies: [],
    production_countries: [],
    spoken_languages: [
      { english_name: 'English', iso_639_1: 'en', name: 'English' },
    ],
    belongs_to_collection: null,
    number_of_seasons: type === 'tv' ? 1 + (id % 6) : undefined,
    number_of_episodes: type === 'tv' ? 10 + (id % 40) : undefined,
    seasons: type === 'tv' ? [] : undefined,
    created_by: type === 'tv' ? [] : undefined,
    networks: type === 'tv' ? [] : undefined,
  };
}

function person(id) {
  const p = item(id, 'person');
  const r = rng(id);
  return {
    ...p,
    also_known_as: [],
    biography: overview(r) + ' ' + overview(r),
    birthday: date(r),
    deathday: null,
    place_of_birth: 'Somewhere, USA',
    imdb_id: `nm${id}`,
    homepage: null,
    combined_credits: { cast: list(id + 3, 'movie').results, crew: [] },
    movie_credits: { cast: list(id + 4, 'movie').results, crew: [] },
    tv_credits: { cast: list(id + 5, 'tv').results, crew: [] },
  };
}

/**
 * The TMDB answer for one API path (without the /3 prefix), or null when the
 * path is not one the fixtures know (the caller logs it and answers with a
 * generic list).
 */
export function tmdbFixture(pathname, search, imgBase) {
  const p = pathname.replace(/^\/3/, '');
  const seed = hash(p + search);
  if (p === '/configuration') {
    return {
      images: {
        base_url: imgBase,
        secure_base_url: imgBase,
        backdrop_sizes: ['w300', 'w780', 'w1280', 'original'],
        logo_sizes: ['w45', 'w92', 'w154', 'w185', 'w300', 'w500', 'original'],
        poster_sizes: [
          'w92',
          'w154',
          'w185',
          'w342',
          'w500',
          'w780',
          'original',
        ],
        profile_sizes: ['w45', 'w185', 'h632', 'original'],
        still_sizes: ['w92', 'w185', 'w300', 'original'],
      },
      change_keys: [],
    };
  }
  let m;
  if ((m = /^\/genre\/(movie|tv)\/list$/.exec(p))) return { genres: GENRES };
  if ((m = /^\/(movie|tv)\/(\d+)$/.exec(p))) return detail(+m[2], m[1]);
  if ((m = /^\/(movie|tv)\/(\d+)\/(credits|aggregate_credits)$/.exec(p)))
    return credits(+m[2]);
  if ((m = /^\/(movie|tv)\/(\d+)\/(recommendations|similar)$/.exec(p)))
    return list(seed, m[1]);
  if (
    (m =
      /^\/(movie|tv)\/(\d+)\/(videos|images|release_dates|content_ratings|external_ids|keywords)$/.exec(
        p,
      ))
  )
    return detail(+m[2], m[1])[m[3]];
  if ((m = /^\/person\/(\d+)$/.exec(p))) return person(+m[1]);
  if (
    (m = /^\/person\/(\d+)\/(combined_credits|movie_credits|tv_credits)$/.exec(
      p,
    ))
  )
    return person(+m[1])[m[2]];
  if (
    (m = /^\/(?:trending\/)?(movie|tv|person|all)(?:\/[a-z_]+)?$/.exec(p)) ||
    (m = /^\/discover\/(movie|tv)$/.exec(p))
  )
    return list(seed, m[1] === 'all' ? (seed % 2 ? 'movie' : 'tv') : m[1]);
  if ((m = /^\/search\/(movie|tv|person|multi)$/.exec(p)))
    return list(seed, m[1] === 'multi' ? 'movie' : m[1]);
  return null;
}

/**
 * Routes api.themoviedb.org through the fixtures on a Playwright context.
 * Unknown paths are answered with a generic movie list and reported through
 * `onUnknown`.
 */
export async function routeTmdbFixtures(context, origin, onUnknown = () => {}) {
  const imgBase = `${origin}/__tmdb-img/`;
  await context.route('https://api.themoviedb.org/**', (route) => {
    const url = new URL(route.request().url());
    let body = tmdbFixture(url.pathname, url.search, imgBase);
    if (body === null) {
      onUnknown(url.pathname + url.search);
      body = list(hash(url.pathname + url.search), 'movie');
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  });
}

// Fixture images: <size>/<kind>-<id>.png, kind p(oster) b(ackdrop) f(ace).
// Eight variants per kind and size; distinct ids share bytes but stay
// distinct URLs, so the renderer still loads one texture per tile.
const ASPECT = { p: 1.5, b: 9 / 16, f: 1.5 };
const ORIGINAL = { p: 780, b: 1920, f: 632 };
const imageCache = new Map();
function fixtureImage(rest) {
  const [size = 'w185', file = 'p-0.png'] = rest.split('/');
  const kind = /^[pbf]-/.test(file) ? file[0] : 'p';
  const id = parseInt(file.slice(2), 10) || 0;
  let w;
  let h;
  if (/^w\d+$/.test(size)) {
    w = +size.slice(1);
    h = Math.round(w * ASPECT[kind]);
  } else if (/^h\d+$/.test(size)) {
    h = +size.slice(1);
    w = Math.round(h / ASPECT[kind]);
  } else {
    w = ORIGINAL[kind];
    h = Math.round(w * ASPECT[kind]);
  }
  const variant = id % 8;
  const key = `${w}x${h}:${variant}`;
  if (!imageCache.has(key)) imageCache.set(key, encodePng(w, h, variant));
  return imageCache.get(key);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// An opaque RGB gradient with a little deterministic texture, so it is not a
// trivially compressible flat fill.
function encodePng(w, h, variant) {
  const r = rng(variant + 1);
  const hue = [r() * 255, r() * 255, r() * 255];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const n = (r() * 24) | 0;
      raw[o++] = (hue[0] * (x / w) + n) & 255;
      raw[o++] = (hue[1] * (y / h) + n) & 255;
      raw[o++] = (hue[2] * (1 - x / w) + n) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
