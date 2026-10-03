# Profiles, 2026-10-03 (6x, arms A and B)

CPU profiles over the measured ops (`node bench/run.mjs --modes profile
--profile-interval 25 --save-profiles`, one run per arm for most scenarios,
two for the Row scenarios), digested with
`node bench/harness/inclusive.mjs <dir>`. Rough guidance, not measurements to
compare at the noise floor: µs per op under the 6x throttle (so about 6x the
full-speed CPU), **inclusive** (a function's own time plus its callees').
Rows nest: the Row/Column handler runs inside the dispatch walk, the state
styles inside the focus path, and `States ops` include the state-change
callback (`_stateChanged`) they trigger. Arm A's renderer frame is not
broken out (renderer 1.9's frame functions have other names).

The idle maintenance after each press (renderer `gl.getError()`, off the
press path) is not in these rows: B spends 0.6-0.9 ms per op in it, A about
0.18 ms.

```text

## navdrawer-toggle A (1 run(s), µs per op)
key event (Solid listener)       151.9
  dispatch walk                  66.0
Row/Column navigation            6.3
post-mutation pass               659.0
  focus path                     566.3
state styles                     461.1
  States ops                     557.6
prop writes to the renderer      122.8
  animateProp                    0.9
shader prop writes               186.8
reactivity (solid-js)            233.0
  draw                           465.3

## navdrawer-toggle B (1 run(s), µs per op)
key event (Solid listener)       285.0
  dispatch walk                  261.2
Row/Column navigation            4.7
post-mutation pass               579.3
  focus path                     494.2
state styles                     298.3
  States ops                     433.0
prop writes to the renderer      69.5
  animateProp                    46.5
shader prop writes               133.8
reactivity (solid-js)            385.1
renderer frame                   1068.8
  scene walk                     226.9
  draw                           580.2

## portal-focus-text A (1 run(s), µs per op)
key event (Solid listener)       150.4
  dispatch walk                  121.3
Row/Column navigation            69.9
post-mutation pass               286.6
  focus path                     256.9
state styles                     46.3
  States ops                     181.5
prop writes to the renderer      64.7
  animateProp                    29.5
shader prop writes               66.2
reactivity (solid-js)            275.0
  draw                           298.3

## portal-focus-text B (1 run(s), µs per op)
key event (Solid listener)       321.8
  dispatch walk                  254.5
Row/Column navigation            190.1
post-mutation pass               380.0
  focus path                     323.0
state styles                     117.8
  States ops                     261.7
prop writes to the renderer      118.5
  animateProp                    38.4
shader prop writes               152.3
reactivity (solid-js)            418.9
renderer frame                   1298.2
  scene walk                     451.7
  draw                           481.7

## poster-swap A (1 run(s), µs per op)
post-mutation pass               177.3
  flex layout                    57.2
prop writes to the renderer      35.1
shader prop writes               142.0
Solid setProp/spread             187.9
node creation                    853.0
  renderer createNode            446.0
reactivity (solid-js)            1276.9
  draw                           131.0

## poster-swap B (1 run(s), µs per op)
post-mutation pass               143.7
  flex layout                    38.0
prop writes to the renderer      24.8
shader prop writes               53.9
Solid setProp/spread             173.5
node creation                    247.6
  renderer createNode            80.2
reactivity (solid-js)            797.0
renderer frame                   318.6
  scene walk                     187.4
  draw                           90.8

## rows-lr-auto A (2 run(s), µs per op)
key event (Solid listener)       145.1
  dispatch walk                  127.7
Row/Column navigation            62.8
post-mutation pass               175.3
  focus path                     161.4
state styles                     34.4
  States ops                     144.4
prop writes to the renderer      33.5
  animateProp                    8.4
shader prop writes               35.4
reactivity (solid-js)            189.6
  draw                           58.6

## rows-lr-auto B (1 run(s), µs per op)
key event (Solid listener)       313.4
  dispatch walk                  243.5
Row/Column navigation            126.2
post-mutation pass               230.7
  focus path                     200.3
state styles                     61.0
  States ops                     162.4
prop writes to the renderer      62.1
  animateProp                    35.0
shader prop writes               79.9
reactivity (solid-js)            364.1
renderer frame                   1169.6
  scene walk                     192.9
  draw                           387.7

## rows-lr-noshift A (2 run(s), µs per op)
key event (Solid listener)       96.6
  dispatch walk                  70.1
Row/Column navigation            44.9
post-mutation pass               104.4
  focus path                     66.8
state styles                     13.3
  States ops                     71.6
prop writes to the renderer      8.9
shader prop writes               8.9
reactivity (solid-js)            128.4
  draw                           7.4

## rows-lr-noshift B (2 run(s), µs per op)
key event (Solid listener)       67.6
  dispatch walk                  51.3
Row/Column navigation            22.7
post-mutation pass               86.4
  focus path                     66.9
state styles                     9.8
  States ops                     65.6
prop writes to the renderer      1.9
shader prop writes               2.6
reactivity (solid-js)            76.8
renderer frame                   66.5
  scene walk                     20.9
  draw                           19.9

## rows-ud-auto A (1 run(s), µs per op)
key event (Solid listener)       276.1
  dispatch walk                  250.9
Row/Column navigation            150.3
post-mutation pass               228.2
  focus path                     169.8
state styles                     16.0
  States ops                     175.5
prop writes to the renderer      48.6
  animateProp                    33.8
shader prop writes               48.9
reactivity (solid-js)            344.3
  draw                           116.2

## rows-ud-auto B (1 run(s), µs per op)
key event (Solid listener)       323.3
  dispatch walk                  302.9
Row/Column navigation            188.3
post-mutation pass               271.9
  focus path                     213.8
state styles                     56.1
  States ops                     204.0
prop writes to the renderer      124.3
  animateProp                    82.3
shader prop writes               133.8
reactivity (solid-js)            379.8
renderer frame                   1476.4
  scene walk                     325.1
  draw                           616.2

## text-details-panel A (1 run(s), µs per op)
key event (Solid listener)       171.8
  dispatch walk                  138.0
Row/Column navigation            65.2
post-mutation pass               239.0
  flex layout                    113.8
  focus path                     196.5
state styles                     102.9
  States ops                     193.6
prop writes to the renderer      83.9
shader prop writes               117.1
node creation                    33.1
reactivity (solid-js)            258.0
  draw                           75.4

## text-details-panel B (1 run(s), µs per op)
key event (Solid listener)       145.9
  dispatch walk                  128.5
Row/Column navigation            109.1
post-mutation pass               261.7
  flex layout                    140.6
  focus path                     209.7
state styles                     43.9
  States ops                     189.3
prop writes to the renderer      34.7
shader prop writes               132.7
node creation                    31.6
reactivity (solid-js)            379.4
renderer frame                   513.7
  scene walk                     136.2
  draw                           217.3

## text-flex-mount-new A (1 run(s), µs per op)
post-mutation pass               320.9
  flex layout                    436.4
prop writes to the renderer      68.3
shader prop writes               71.4
Solid setProp/spread             1.2
node creation                    923.9
  renderer createNode            488.4
reactivity (solid-js)            1647.1
  draw                           123.8

## text-flex-mount-new B (1 run(s), µs per op)
post-mutation pass               235.9
  flex layout                    480.4
prop writes to the renderer      121.9
shader prop writes               167.1
Solid setProp/spread             18.7
node creation                    534.1
  renderer createNode            199.4
reactivity (solid-js)            1343.0
renderer frame                   1424.1
  scene walk                     703.7
  draw                           586.0

## text-virtual-row A (1 run(s), µs per op)
key event (Solid listener)       195.0
  dispatch walk                  134.4
Row/Column navigation            84.9
post-mutation pass               405.2
  flex layout                    206.1
  focus path                     231.0
state styles                     22.6
  States ops                     190.3
prop writes to the renderer      4.3
shader prop writes               23.1
node creation                    20.6
reactivity (solid-js)            387.0
  draw                           265.7

## text-virtual-row B (1 run(s), µs per op)
key event (Solid listener)       371.8
  dispatch walk                  347.0
Row/Column navigation            258.9
post-mutation pass               323.5
  flex layout                    192.2
  focus path                     191.9
state styles                     48.4
  States ops                     167.1
prop writes to the renderer      70.8
shader prop writes               90.5
node creation                    24.2
reactivity (solid-js)            532.4
renderer frame                   966.7
  scene walk                     285.4
  draw                           378.2

## thumbnail-focus A (1 run(s), µs per op)
key event (Solid listener)       201.5
  dispatch walk                  180.8
Row/Column navigation            28.2
post-mutation pass               358.7
  focus path                     330.3
state styles                     232.5
  States ops                     342.5
prop writes to the renderer      36.8
  animateProp                    25.9
shader prop writes               153.7
reactivity (solid-js)            248.8
  draw                           590.2

## thumbnail-focus B (1 run(s), µs per op)
key event (Solid listener)       186.6
  dispatch walk                  162.4
Row/Column navigation            84.5
post-mutation pass               434.7
  focus path                     346.8
state styles                     190.0
  States ops                     359.7
prop writes to the renderer      43.6
  animateProp                    11.0
shader prop writes               139.7
reactivity (solid-js)            292.1
renderer frame                   1450.6
  scene walk                     214.7
  draw                           736.8

## virtual-grid A (1 run(s), µs per op)
key event (Solid listener)       323.9
  dispatch walk                  314.3
post-mutation pass               600.0
  flex layout                    346.0
  focus path                     335.8
state styles                     178.4
  States ops                     315.7
prop writes to the renderer      116.0
  animateProp                    23.0
shader prop writes               263.6
Solid setProp/spread             4.5
node creation                    79.9
  renderer createNode            42.2
reactivity (solid-js)            749.3
  draw                           604.0

## virtual-grid B (1 run(s), µs per op)
key event (Solid listener)       386.3
  dispatch walk                  355.3
post-mutation pass               461.4
  flex layout                    312.7
  focus path                     219.2
state styles                     149.2
  States ops                     202.3
prop writes to the renderer      201.4
  animateProp                    37.0
shader prop writes               318.2
Solid setProp/spread             1.6
node creation                    102.2
  renderer createNode            12.0
reactivity (solid-js)            743.5
renderer frame                   1116.2
  scene walk                     336.5
  draw                           523.5

## virtual-row A (1 run(s), µs per op)
key event (Solid listener)       356.3
  dispatch walk                  308.9
Row/Column navigation            218.4
post-mutation pass               254.8
  flex layout                    142.2
  focus path                     139.9
state styles                     60.3
  States ops                     125.5
prop writes to the renderer      63.5
  animateProp                    2.7
shader prop writes               64.4
Solid setProp/spread             51.2
node creation                    22.8
reactivity (solid-js)            583.2
  draw                           204.8

## virtual-row B (1 run(s), µs per op)
key event (Solid listener)       451.3
  dispatch walk                  417.0
Row/Column navigation            287.5
post-mutation pass               344.5
  flex layout                    104.8
  focus path                     220.9
state styles                     89.8
  States ops                     220.6
prop writes to the renderer      77.7
  animateProp                    41.4
shader prop writes               80.0
Solid setProp/spread             14.9
node creation                    21.5
reactivity (solid-js)            568.0
renderer frame                   784.2
  scene walk                     128.9
  draw                           288.5
```

## Terser inlining in the renderer's walk

The demo app's production build (terser, `compress` on, `mangle` off) turns
renderer v2's single-use world-transform helper into an IIFE inside
`ScenePass.visit` (`!function(s, id, parent){…}(s, id, parent)`), which
allocates on every dirty node visited, every frame. The bench mirrors that
build. Arm B rebuilt with `BENCH_TERSER_COMPRESS='{"reduce_funcs":false}'`
(the IIFE is gone from `visit`), alloc mode, one run:

| scenario             | renderer KiB/op, demo settings | `reduce_funcs: false` | framework KiB/op (both) |
| -------------------- | ------------------------------ | --------------------- | ----------------------- |
| rows-ud-auto         | 56.7                           | 3.4                   | 2.4 / 2.1               |
| virtual-grid         | 67.7                           | 8.6                   | 12.5 / 11.0             |
| thumbnail-focus      | 8.6                            | 4.0                   | 2.9 / 2.7               |
| text-flex-mount-same | 49.6                           | 21.0                  | 54.7 / 54.7             |
