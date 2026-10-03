/* global window, document, KeyboardEvent */
// The in-page half of the harness. `pageProbe` is serialized and injected
// with page.addInitScript (sourceURL bench-probe.js, so that the profilers
// charge what it does to the harness, not to the app), so it runs before the
// app's first script and must not close over anything in this module.
//
// What it installs at document start:
// - a requestAnimationFrame wrap that times every callback (performance.now
//   around it) into preallocated typed arrays, and marks the callbacks that
//   drew (gl.clear ran inside: both renderer majors clear once per drawn
//   frame). A callback that ever drew is the renderer's loop; its later
//   callbacks that did not draw are its undrawn frames (v1's idle polls, v2's
//   upload-only frames). The wrap of a given callback is made once, so the
//   wrap allocates nothing per frame.
// - an `idle` listener on the renderer, attached the moment main.tsx assigns
//   `window.__bench` (a setter on window), after Solid's own.
// - `window.__benchProbe`, which the runner drives: ready(), info(),
//   installCounters() (count mode), runOps(), countDetails().
//
// One operation (runOp): aligned to just after a rendering step (a rAF, then
// a MessageChannel task), it calls scenario.step(i); a key name returned is
// dispatched as a keydown on `document`, timed alone (`handler`); otherwise
// the step itself is the handler. `tail` runs from the handler's end to the
// first task after the microtask checkpoint (a MessageChannel message posted
// at the handler's end), or to the start of the first rAF callback if a
// frame comes first (`tailCut`). Then it waits until the renderer is idle
// (its `idle` event, then `gapMs` with no drawn frame), or `quietMs` pass
// with no drawn frame at all (an op that changes nothing draws nothing), or
// `idleTimeoutMs` pass (`timedOut`). The keyup goes out only then, so it
// never lands in the op's frames; its handler is timed as `keyup`, and the
// probe waits for idle again before the next op.
export function pageProbe(opts) {
  const counting = opts.mode === 'count';
  const perf = window.performance;
  const now = () => perf.now();
  const raf = window.requestAnimationFrame.bind(window);
  const setTimer = window.setTimeout.bind(window);
  const clearTimer = window.clearTimeout.bind(window);

  // Count mode counters. The count build's flex wrap increments `flex` and
  // `flexHooks` (bench/vite.config.ts); installCounters() patches the rest.
  const C = {
    flex: 0,
    flexHooks: 0,
    writes: 0,
    shaderWrites: 0,
    frameWrites: 0,
    animations: 0,
    walks: 0,
    loadedText: 0,
    loadedOther: 0,
    textLayouts: 0,
    textLayoutMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
  if (counting) {
    window.__benchCount = C;
  }

  // Drawn-frame detection: one gl.clear per drawn frame in both majors.
  let clears = 0;
  const glTypes = [window.WebGLRenderingContext, window.WebGL2RenderingContext];
  for (let g = 0; g < glTypes.length; g++) {
    const type = glTypes[g];
    if (type === undefined) {
      continue;
    }
    const clear = type.prototype.clear;
    type.prototype.clear = function (mask) {
      clears++;
      clear.call(this, mask);
    };
  }

  // The frame log: a ring of CAP callbacks.
  const CAP = 1 << 15;
  const MASK = CAP - 1;
  const KIND_DRAWN = 1;
  const KIND_UNDRAWN = 2;
  const KIND_OTHER = 3;
  const fStart = new Float64Array(CAP);
  const fEnd = new Float64Array(CAP);
  const fKind = new Uint8Array(CAP);
  // Count mode: layout activity (flex passes + text layouts + text `loaded`)
  // and walks inside each callback.
  const fAct = new Float64Array(counting ? CAP : 1);
  const fWalks = new Float64Array(counting ? CAP : 1);
  let fCount = 0;
  let inRaf = false;
  const rendererCallbacks = new WeakSet();
  const wrappers = new WeakMap();
  window.requestAnimationFrame = function (callback) {
    let wrapped = wrappers.get(callback);
    if (wrapped === undefined) {
      wrapped = function (time) {
        const c0 = clears;
        let a0 = 0;
        let w0 = 0;
        if (counting) {
          a0 = C.flex + C.textLayouts + C.loadedText;
          w0 = C.walks;
        }
        inRaf = true;
        const start = now();
        callback(time);
        const end = now();
        inRaf = false;
        const i = fCount & MASK;
        fStart[i] = start;
        fEnd[i] = end;
        let kind = KIND_OTHER;
        if (clears !== c0) {
          rendererCallbacks.add(callback);
          kind = KIND_DRAWN;
        } else if (rendererCallbacks.has(callback)) {
          kind = KIND_UNDRAWN;
        }
        fKind[i] = kind;
        if (counting) {
          fAct[i] = C.flex + C.textLayouts + C.loadedText - a0;
          fWalks[i] = C.walks - w0;
        }
        fCount++;
      };
      wrappers.set(callback, wrapped);
    }
    return raf(wrapped);
  };

  // Idle: the renderer's `idle` event, both majors.
  let bench;
  let idleCount = 0;
  let idleFrame = -1;
  let idleWaiter = null;
  const onIdle = () => {
    idleCount++;
    // The callback running now is recorded at index fCount when it returns.
    idleFrame = inRaf ? fCount : fCount - 1;
    if (idleWaiter !== null) {
      idleWaiter();
    }
  };
  Object.defineProperty(window, '__bench', {
    configurable: true,
    enumerable: true,
    get() {
      return bench;
    },
    set(value) {
      bench = value;
      value.renderer.on('idle', onIdle);
    },
  });

  // One task source for the harness's own continuations.
  const channel = new MessageChannel();
  let onMessage = null;
  channel.port1.onmessage = () => {
    const f = onMessage;
    onMessage = null;
    if (f !== null) {
      f();
    }
  };
  const postTask = (f) => {
    onMessage = f;
    channel.port2.postMessage(0);
  };
  const sleep = (ms) => new Promise((resolve) => setTimer(resolve, ms));
  /** Resolves in a task right after the next rendering step. */
  const frameAligned = () =>
    new Promise((resolve) => raf(() => postTask(resolve)));

  const drawnSince = (from) => {
    for (let k = from; k < fCount; k++) {
      if (fKind[k & MASK] === KIND_DRAWN) {
        return true;
      }
    }
    return false;
  };

  /** Resolves with true on timeout: see the header. */
  const settle = (frame0, idle0, t0) =>
    new Promise((resolve) => {
      let gapTimer = 0;
      let quietTimer = 0;
      let finished = false;
      const finish = (timedOut) => {
        if (finished) {
          return;
        }
        finished = true;
        idleWaiter = null;
        clearTimer(gapTimer);
        clearTimer(quietTimer);
        resolve(timedOut);
      };
      const atIdle = () => {
        clearTimer(gapTimer);
        // Frames after the one that emitted idle (v2 emits it inside the
        // drawn frame's callback, which is logged once it returns).
        const mark = idleFrame + 1;
        gapTimer = setTimer(() => {
          gapTimer = 0;
          if (!drawnSince(mark)) {
            finish(false);
          }
        }, opts.gapMs);
      };
      idleWaiter = atIdle;
      if (idleCount !== idle0) {
        atIdle();
      }
      const quiet = () => {
        if (now() - t0 > opts.idleTimeoutMs) {
          finish(true);
          return;
        }
        if (gapTimer === 0 && !drawnSince(frame0)) {
          finish(false);
          return;
        }
        quietTimer = setTimer(quiet, opts.quietMs);
      };
      quietTimer = setTimer(quiet, opts.quietMs);
    });

  const KEY_CODES = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Enter: 13,
    Escape: 27,
    Backspace: 8,
  };
  const keyEvent = (type, key) =>
    new KeyboardEvent(type, {
      key,
      code: key,
      keyCode: KEY_CODES[key] || 0,
      bubbles: true,
      cancelable: true,
    });

  const snapshot = () => ({
    flex: C.flex,
    writes: C.writes,
    shaderWrites: C.shaderWrites,
    frameWrites: C.frameWrites,
    animations: C.animations,
    walks: C.walks,
    loadedText: C.loadedText,
    loadedOther: C.loadedOther,
    textLayouts: C.textLayouts,
    textLayoutMs: C.textLayoutMs,
    cacheHits: C.cacheHits,
    cacheMisses: C.cacheMisses,
  });
  const diff = (a, b) => {
    const d = {};
    for (const k in a) {
      d[k] = b[k] - a[k];
    }
    return d;
  };

  /** The op's frames, [frame0, end]: see the header. */
  const frameStats = (rec, frame0, idle0, t0, tailEnd) => {
    const end =
      idleCount !== idle0 && idleFrame >= frame0 ? idleFrame : fCount - 1;
    let first = -1;
    let frames = 0;
    let animCpu = 0;
    let undrawnCpu = 0;
    let otherRaf = 0;
    let lastDrawnEnd = tailEnd;
    let drawnOrdinal = 0;
    let walks = 0;
    for (let k = frame0; k <= end && k < fCount; k++) {
      const j = k & MASK;
      const d = fEnd[j] - fStart[j];
      const kind = fKind[j];
      if (kind === KIND_DRAWN) {
        frames++;
        drawnOrdinal++;
        if (first < 0) {
          first = k;
          rec.frame = d;
          rec.frameDelay = fStart[j] - tailEnd;
        } else {
          animCpu += d;
        }
        lastDrawnEnd = fEnd[j];
      } else if (kind === KIND_UNDRAWN) {
        undrawnCpu += d;
      } else {
        otherRaf += d;
      }
      if (counting && kind !== KIND_OTHER) {
        walks += fWalks[j];
        if (fAct[j] > 0) {
          rec.finalLayoutFrame = drawnOrdinal;
          rec.finalLayoutMs = fEnd[j] - t0;
        }
      }
    }
    rec.frames = frames;
    rec.animCpu = animCpu;
    rec.undrawnCpu = undrawnCpu;
    rec.otherRaf = otherRaf;
    rec.settle = lastDrawnEnd - t0;
    rec.total = rec.handler + rec.tail + (rec.frame === null ? 0 : rec.frame);
    rec.cpu =
      rec.handler +
      rec.tail +
      (rec.frame === null ? 0 : rec.frame) +
      animCpu +
      undrawnCpu +
      otherRaf;
    if (counting) {
      rec.frameWalks = walks;
    }
  };

  const runOp = (i) =>
    new Promise((resolve) => {
      const scenario = bench.scenario;
      const kind =
        typeof scenario.opKind === 'function' ? scenario.opKind(i) : null;
      const frame0 = fCount;
      const idle0 = idleCount;
      const c0 = counting ? snapshot() : null;
      const t0 = now();
      const key = scenario.step(i);
      const isKey = typeof key === 'string';
      let handler;
      let t1;
      if (isKey) {
        const event = keyEvent('keydown', key);
        const tk = now();
        document.dispatchEvent(event);
        t1 = now();
        handler = t1 - tk;
      } else {
        t1 = now();
        handler = t1 - t0;
      }
      postTask(() => {
        let t2 = now();
        let tailCut = false;
        if (fCount !== frame0 && fStart[frame0 & MASK] < t2) {
          t2 = fStart[frame0 & MASK];
          tailCut = true;
        }
        const cTail = counting ? snapshot() : null;
        settle(frame0, idle0, t0).then((timedOut) => {
          const rec = {
            i,
            kind,
            key: isKey ? key : null,
            handler,
            tail: t2 - t1,
            tailCut,
            frame: null,
            frameDelay: null,
            timedOut,
          };
          if (counting) {
            rec.finalLayoutFrame = null;
            rec.finalLayoutMs = null;
            const tailAct =
              cTail.flex +
              cTail.textLayouts +
              cTail.loadedText -
              (c0.flex + c0.textLayouts + c0.loadedText);
            if (tailAct > 0) {
              rec.finalLayoutFrame = 0;
              rec.finalLayoutMs = t2 - t0;
            }
          }
          frameStats(rec, frame0, idle0, t0, t2);
          if (counting) {
            rec.counts = diff(c0, snapshot());
          }
          if (!isKey) {
            resolve(rec);
            return;
          }
          const up = keyEvent('keyup', key);
          const upFrame0 = fCount;
          const upIdle0 = idleCount;
          const tu = now();
          document.dispatchEvent(up);
          const tu1 = now();
          rec.keyup = tu1 - tu;
          postTask(() => {
            settle(upFrame0, upIdle0, tu1).then((upTimedOut) => {
              let upFrames = 0;
              for (let k = upFrame0; k < fCount; k++) {
                if (fKind[k & MASK] === KIND_DRAWN) {
                  upFrames++;
                }
              }
              rec.keyupFrames = upFrames;
              rec.keyupTimedOut = upTimedOut;
              resolve(rec);
            });
          });
        });
      });
    });

  // Count mode: runtime hooks on the renderer (both majors). See
  // docs/perf/README.md, "Count mode".
  const detail = {
    nodeAccessors: 0,
    nodeWrites: new Map(),
    shaderWrites: new Map(),
    walkHook: null,
    textHook: null,
    cacheHook: null,
  };
  const installCounters = () => {
    const r = bench.renderer;
    const patched = new WeakSet();
    const bump = (map, name) => map.set(name, (map.get(name) || 0) + 1);
    const wrappedShaders = new WeakSet();
    // A shader node's `props` object (v1: own non-configurable accessors per
    // node; v2: a facade whose prototype's accessors are non-configurable)
    // is swapped for a forwarding object that counts each write.
    const wrapShader = (sn) => {
      if (sn === null || typeof sn !== 'object' || wrappedShaders.has(sn)) {
        return;
      }
      wrappedShaders.add(sn);
      const props = sn.props;
      if (props === null || typeof props !== 'object') {
        return;
      }
      let field = null;
      for (const k of Object.keys(sn)) {
        if (sn[k] === props) {
          field = k;
          break;
        }
      }
      if (field === null) {
        return;
      }
      const wrapper = {};
      for (const name in props) {
        Object.defineProperty(wrapper, name, {
          enumerable: true,
          configurable: true,
          get() {
            return props[name];
          },
          set(v) {
            C.shaderWrites++;
            if (inRaf) {
              C.frameWrites++;
            }
            bump(detail.shaderWrites, name);
            props[name] = v;
          },
        });
      }
      sn[field] = wrapper;
    };
    const patchProto = (proto) => {
      for (
        let p = proto;
        p !== null && p !== Object.prototype;
        p = Object.getPrototypeOf(p)
      ) {
        if (patched.has(p)) {
          continue;
        }
        patched.add(p);
        for (const name of Object.getOwnPropertyNames(p)) {
          const d = Object.getOwnPropertyDescriptor(p, name);
          if (d === undefined || d.configurable !== true) {
            continue;
          }
          if (typeof d.set === 'function') {
            const set = d.set;
            const isShader = name === 'shader';
            detail.nodeAccessors++;
            Object.defineProperty(p, name, {
              get: d.get,
              enumerable: d.enumerable,
              configurable: true,
              set(v) {
                C.writes++;
                if (inRaf) {
                  C.frameWrites++;
                }
                bump(detail.nodeWrites, name);
                set.call(this, v);
                if (isShader) {
                  wrapShader(v);
                }
              },
            });
          } else if (
            (name === 'animate' || name === 'animateProp') &&
            typeof d.value === 'function'
          ) {
            const fn = d.value;
            p[name] = function () {
              C.animations++;
              return fn.apply(this, arguments);
            };
          }
        }
      }
    };
    const nodeProto = Object.getPrototypeOf(r.root);
    patchProto(nodeProto);
    // Every node made later: its class may be one not seen in the tree yet.
    for (const method of ['createNode', 'createTextNode']) {
      const create = r[method];
      r[method] = function () {
        const node = create.apply(this, arguments);
        patchProto(Object.getPrototypeOf(node));
        return node;
      };
    }
    const createShader = r.createShader;
    r.createShader = function () {
      const sn = createShader.apply(this, arguments);
      wrapShader(sn);
      return sn;
    };
    const visit = (node) => {
      patchProto(Object.getPrototypeOf(node));
      const sn = node.shader;
      if (sn !== undefined && sn !== null) {
        wrapShader(sn);
      }
      const children = node.children;
      if (children !== undefined && children !== null) {
        for (let i = 0; i < children.length; i++) {
          visit(children[i]);
        }
      }
    };
    visit(r.root);
    // `loaded` on nodes that listen for it (v1 emits to nodes without a
    // listener too, v2 only queues for a listener): the emitter's emit,
    // wherever the chain defines it. Both majors keep listeners in
    // `eventListeners[event]`.
    const listened = (emitter, event) => {
      const map = emitter.eventListeners;
      const list = map !== null && map !== undefined ? map[event] : undefined;
      return list !== undefined && list !== null && list.length > 0;
    };
    let ep = nodeProto;
    while (ep !== null && !Object.prototype.hasOwnProperty.call(ep, 'emit')) {
      ep = Object.getPrototypeOf(ep);
    }
    if (ep !== null) {
      const emit = ep.emit;
      ep.emit = function (event, data) {
        if (
          event === 'loaded' &&
          Object.prototype.isPrototypeOf.call(nodeProto, this) === true &&
          listened(this, event)
        ) {
          if (data !== undefined && data !== null && data.type === 'text') {
            C.loadedText++;
          } else {
            C.loadedOther++;
          }
        }
        return emit.call(this, event, data);
      };
    }
    if (r.scene !== undefined && typeof r.scene.run === 'function') {
      // Renderer v2: one ScenePass.run per walk (RendererCore.update).
      const scene = r.scene;
      const run = scene.run;
      scene.run = function (id) {
        C.walks++;
        return run.call(this, id);
      };
      detail.walkHook = 'v2 ScenePass.run';
    } else if (
      r.stage !== undefined &&
      typeof r.stage.drawFrame === 'function'
    ) {
      // Renderer v1: Stage.drawFrame's update loop reads `reprocessFrame`
      // twice per iteration (at its top and in its `while`).
      const stage = r.stage;
      let value = stage.reprocessFrame;
      let reads = 0;
      let inDraw = false;
      Object.defineProperty(stage, 'reprocessFrame', {
        configurable: true,
        get() {
          if (inDraw) {
            reads++;
          }
          return value;
        },
        set(v) {
          value = v;
        },
      });
      const drawFrame = stage.drawFrame;
      stage.drawFrame = function (animating) {
        inDraw = true;
        reads = 0;
        try {
          return drawFrame.call(this, animating);
        } finally {
          inDraw = false;
          C.walks += reads / 2;
        }
      };
      detail.walkHook = 'v1 Stage.drawFrame update-loop iterations';
    }
    if (
      r.textNodes !== undefined &&
      typeof r.textNodes.layoutText === 'function'
    ) {
      // Renderer v2: TextNodes.layoutText runs for every text visit that has
      // DIRTY_LAYOUT; LayoutCache.get is looked up when a layout is due.
      const tn = r.textNodes;
      const layoutText = tn.layoutText;
      tn.layoutText = function (id) {
        const s = now();
        const out = layoutText.call(this, id);
        C.textLayoutMs += now() - s;
        C.textLayouts++;
        return out;
      };
      const cache = tn.cache;
      const get = cache.get;
      cache.get = function (key) {
        const layout = get.call(this, key);
        if (layout === undefined) {
          C.cacheMisses++;
        } else {
          C.cacheHits++;
        }
        return layout;
      };
      detail.textHook = 'v2 TextNodes.layoutText';
      detail.cacheHook = 'v2 LayoutCache.get';
    } else if (
      r.stage !== undefined &&
      r.stage.textRenderers !== undefined &&
      r.stage.textRenderers.sdf !== undefined
    ) {
      // Renderer v1: SdfTextRenderer.renderText (cache lookup + layout).
      // A layout object returned before is a cache hit.
      const sdf = r.stage.textRenderers.sdf;
      const renderText = sdf.renderText;
      const seen = new WeakSet();
      sdf.renderText = function (props) {
        const s = now();
        const out = renderText.call(this, props);
        C.textLayoutMs += now() - s;
        C.textLayouts++;
        const layout =
          out !== undefined && out !== null ? out.layout : undefined;
        if (layout !== undefined && layout !== null) {
          if (seen.has(layout)) {
            C.cacheHits++;
          } else {
            seen.add(layout);
            C.cacheMisses++;
          }
        }
        return out;
      };
      detail.textHook = 'v1 SdfTextRenderer.renderText';
      detail.cacheHook = 'v1 renderText layout identity';
    }
    return {
      nodeAccessors: detail.nodeAccessors,
      walkHook: detail.walkHook,
      textHook: detail.textHook,
      cacheHook: detail.cacheHook,
      flexHooks: C.flexHooks,
    };
  };

  window.__benchProbe = {
    /** Fonts, the scenario's own ready(), then 300 ms without a drawn frame. */
    async ready(timeoutMs) {
      const deadline = now() + timeoutMs;
      await bench.fontsLoaded;
      if (typeof bench.scenario.ready === 'function') {
        await bench.scenario.ready();
      }
      for (;;) {
        const mark = fCount;
        await sleep(300);
        if (!drawnSince(mark)) {
          return;
        }
        if (now() > deadline) {
          throw new Error('the scene did not settle after mount');
        }
      }
    },
    info() {
      let res = Infinity;
      for (let k = 0; k < 2000; k++) {
        const a = perf.now();
        let b = perf.now();
        while (b === a) {
          b = perf.now();
        }
        if (b - a < res) {
          res = b - a;
        }
      }
      let gpu = null;
      const canvas = document.querySelector('canvas');
      if (canvas !== null) {
        const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
        if (gl !== null) {
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          gpu = gl.getParameter(
            ext !== null ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
          );
        }
      }
      const s = bench.scenario;
      return {
        arm: bench.arm,
        rendererMajor: bench.rendererMajor,
        instrumented: bench.instrumented,
        flex: bench.flex,
        scenario: s.id,
        title: s.title,
        text: s.text === true,
        warmup: s.warmup === undefined ? 30 : s.warmup,
        measured: s.measured === undefined ? 60 : s.measured,
        scenarios: bench.scenarios,
        crossOriginIsolated: window.crossOriginIsolated === true,
        clockResolutionUs: res * 1000,
        gpu,
        userAgent: window.navigator.userAgent,
        flexHooks: C.flexHooks,
      };
    },
    installCounters,
    /** The scenario's state snapshot (Scenario.probe), or null. */
    state() {
      const p = bench.scenario.probe;
      return typeof p === 'function' ? JSON.parse(JSON.stringify(p())) : null;
    },
    async runOps(first, count, record) {
      const out = [];
      for (let k = 0; k < count; k++) {
        await frameAligned();
        const rec = await runOp(first + k);
        if (record) {
          out.push(rec);
        }
      }
      return out;
    },
    /** Count mode: writes by name over everything since installCounters(). */
    countDetails() {
      return {
        nodeWrites: Array.from(detail.nodeWrites.entries()),
        shaderWrites: Array.from(detail.shaderWrites.entries()),
      };
    },
    /** For debugging the harness: the frame log's tail and the idle count. */
    debug(n) {
      const out = [];
      for (let k = Math.max(0, fCount - n); k < fCount; k++) {
        const j = k & MASK;
        out.push([k, fKind[j], fStart[j], fEnd[j] - fStart[j]]);
      }
      return { fCount, idleCount, idleFrame, clears, frames: out };
    },
    resetCountDetails() {
      detail.nodeWrites.clear();
      detail.shaderWrites.clear();
    },
  };
}
