// Prepares the benchmark arms under bench/.arms (gitignored).
//
//   A: solid 1.6.4 on renderer 1.9.3 (what ships today)
//   B: solid 1.6.4 + the renderer v2 lockstep patch, on renderer v2 (faf4b9f)
//   C: this working tree (src/) on its installed @solidtv/renderer
//      (node_modules/@solidtv/renderer: the ../renderer-v2-solid link, built here)
//
// Re-running is cheap: an arm already prepared at the pinned ref is kept.
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const solidRoot = resolve(here, '..');
const armsDir = join(here, '.arms');
const rendererC = realpathSync(
  join(solidRoot, 'node_modules', '@solidtv', 'renderer'),
);
const rendererCVersion = JSON.parse(
  readFileSync(join(rendererC, 'package.json'), 'utf8'),
).version;

export const PINS = {
  solidA: '71c170f', // v1.6.4
  solidB: 'f1c8ab0', // 1.6.4 + solid-lockstep-2.0.patch
  rendererA: '1.9.3', // npm
  rendererB: 'faf4b9f', // renderer v2 (2.0.0-alpha.0) the lockstep patch targets
};

export const ARMS = {
  A: {
    solid: join(armsDir, 'solid-a'),
    renderer: join(armsDir, 'renderer-a'),
    rendererMajor: 1,
    rendererVersion: PINS.rendererA,
  },
  B: {
    solid: join(armsDir, 'solid-b'),
    renderer: join(armsDir, 'renderer-b'),
    rendererMajor: 2,
  },
  C: {
    solid: solidRoot,
    renderer: rendererC,
    rendererMajor: Number(rendererCVersion.split('.')[0]),
    rendererVersion: rendererCVersion,
  },
};

const sh = (cmd, cwd) =>
  execSync(cmd, { cwd, stdio: 'inherit', shell: '/bin/bash' });

function stamped(dir, pin) {
  const f = join(dir, '.bench-pin');
  return existsSync(f) && readFileSync(f, 'utf8') === pin;
}
function stamp(dir, pin) {
  writeFileSync(join(dir, '.bench-pin'), pin);
}

function gitArchive(repo, ref, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  sh(`git -C "${repo}" archive ${ref} | tar -x -C "${dir}"`);
}

export function prepareArms({ skipC = false } = {}) {
  mkdirSync(armsDir, { recursive: true });

  if (!stamped(ARMS.A.solid, PINS.solidA)) {
    gitArchive(solidRoot, PINS.solidA, ARMS.A.solid);
    stamp(ARMS.A.solid, PINS.solidA);
  }
  if (!stamped(ARMS.B.solid, PINS.solidB)) {
    gitArchive(solidRoot, PINS.solidB, ARMS.B.solid);
    stamp(ARMS.B.solid, PINS.solidB);
  }
  if (!stamped(ARMS.A.renderer, PINS.rendererA)) {
    rmSync(ARMS.A.renderer, { recursive: true, force: true });
    mkdirSync(ARMS.A.renderer, { recursive: true });
    const tgz = execSync(
      `npm pack @solidtv/renderer@${PINS.rendererA} --silent`,
      {
        cwd: armsDir,
      },
    )
      .toString()
      .trim()
      .split('\n')
      .pop();
    sh(
      `tar -xzf "${tgz}" -C "${ARMS.A.renderer}" --strip-components=1 && rm "${tgz}"`,
      armsDir,
    );
    stamp(ARMS.A.renderer, PINS.rendererA);
  }
  if (!stamped(ARMS.B.renderer, PINS.rendererB)) {
    gitArchive(rendererC, PINS.rendererB, ARMS.B.renderer);
    sh(
      'pnpm install --frozen-lockfile --ignore-scripts && pnpm build',
      ARMS.B.renderer,
    );
    stamp(ARMS.B.renderer, PINS.rendererB);
  }
  if (!skipC) {
    sh('pnpm build', ARMS.C.renderer);
  }
  return ARMS;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareArms({ skipC: process.argv.includes('--skip-c') });
  console.log(JSON.stringify(ARMS, null, 2));
}
