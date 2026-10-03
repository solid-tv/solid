# Performance log

Every Phase 2 change is measured before and after with `npm run bench` and
logged here: the scenario, arms, runs, the numbers, and whether it was kept
(it must beat the noise floor or remove allocations).

## 2026-10-03: Phase 0 baseline

- Arms A (1.6.4 on renderer 1.9.3), B (lockstep port on renderer v2 `faf4b9f`)
  and C (= B today), 16 scenarios, 6x throttle.
- Time: 3 runs per arm; alloc and count: 1 run; profile: 1-2 runs per arm.
- Results: `results/2026-10-03/summary.md` and `profiles.md`; the demo app's
  `#/benchmark`: `results/demo-2026-10-03-*.json`.
- Analysis: `docs/superpowers/specs/2026-10-03-solid-1.7-design.md`,
  sections 1 and 2.

## 2026-10-03: terser `reduce_funcs` (build setting, not a code change)

- Arm B rebuilt with `BENCH_TERSER_COMPRESS='{"reduce_funcs":false}'`, alloc
  mode, 1 run, 4 scenarios: renderer KiB per press 56.7 → 3.4
  (rows-ud-auto), 67.7 → 8.6 (virtual-grid), 8.6 → 4.0 (thumbnail-focus),
  49.6 → 21.0 (text-flex-mount-same). Framework unchanged.
- Not adopted in the bench (it mirrors the demo app's build); proposed for the
  demo app in Phase 3 and as renderer proposal P3.
