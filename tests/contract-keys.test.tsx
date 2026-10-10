// Contract tests: key handling. Pins the behaviour of solid 1.6.4 (renderer
// 1.9): `this` binding, return values, capture → bubble →
// onKeyPress order and arguments, key releases, custom key-map names, hold,
// and per-element throttleInput. Behavioural only: handler call order,
// arguments and return values, never underscore fields.
import * as v from 'vitest';
import { createRoot } from 'solid-js';
import { Config, type ElementNode } from '@solidtv/solid';
import {
  useFocusManager,
  useHold,
  type KeyEventLike,
  type KeyEventTarget,
  type KeyMap,
} from '@solidtv/solid/primitives';
import {
  KeyTarget,
  flush,
  mount,
  recorder,
  type TestKeyEvent,
} from './contract-focus-helpers.js';
import { renderer } from './setup.js';

// useFocusManager rebinds Config.setActiveElement on every mount; afterAll
// puts back whatever the worker had before this file ran.
const savedSetActiveElement = Config.setActiveElement;

// Keys this file adds to the shared key map. Unique names, so leaving them
// would be harmless, but they are removed again in afterAll.
const MENU_KEY = 'ContractMenuKey';
const MENU_KEYCODE = 9077;
const LEGACY_MENU_KEY = 'ContractLegacyMenuKey';
const UNMAPPED_KEY = 'ContractUnmappedKey';
const NULLED_KEY = 'ContractNulledKey';
const menuKeyMap = { Menu: [MENU_KEY, MENU_KEYCODE] } as Partial<KeyMap>;

v.afterAll(() => {
  // `{ <key>: null }` still deletes the key map entry for that *key* (besides
  // unmapping a name's keys, B4 below), which is exactly what undoes
  // menuKeyMap.
  createRoot((dispose) => {
    useFocusManager(
      {
        [MENU_KEY]: null,
        [MENU_KEYCODE]: null,
        [LEGACY_MENU_KEY]: null,
      } as Partial<KeyMap>,
      new KeyTarget(),
    );
    dispose();
  });
  Config.setActiveElement = savedSetActiveElement;
});

type Rec = ReturnType<typeof recorder>;
type Nodes = Record<string, ElementNode>;

// outer > mid > leaf (leaf autofocused); `handlers(id)` supplies each node's
// handler props.
async function mountChain(
  handlers: (id: 'outer' | 'mid' | 'leaf') => Record<string, unknown>,
  keyMap?: Partial<KeyMap>,
) {
  const n: Nodes = {};
  const { target, dispose } = await mount(
    () => (
      <view id="outer" ref={n.outer} {...handlers('outer')}>
        <view id="mid" ref={n.mid} {...handlers('mid')}>
          <view id="leaf" ref={n.leaf} autofocus {...handlers('leaf')} />
        </view>
      </view>
    ),
    keyMap,
  );
  return { n, target, dispose };
}

/** Every handler name on every node, each returning undefined. */
const allEnterHandlers = (r: Rec) => () => ({
  onCaptureEnter: r.handler('onCaptureEnter'),
  onEnter: r.handler('onEnter'),
  onKeyPress: r.handler('onKeyPress'),
  onCaptureEnterRelease: r.handler('onCaptureEnterRelease'),
  onEnterRelease: r.handler('onEnterRelease'),
});

v.describe('contract: handlers are called with this bound to the node', () => {
  v.it(
    'capture, bubble, onKeyPress, onCaptureKey and release handlers all get this = their node',
    async () => {
      const r = recorder();
      const h = (name: string, owner: string) =>
        r.handler(name, undefined, owner);
      const { n, target, dispose } = await mountChain((id) =>
        id === 'outer'
          ? {
              onCaptureKey: h('onCaptureKey', id),
              onCaptureKeyRelease: h('onCaptureKeyRelease', id),
              onEnter: h('onEnter', id),
              onKeyPress: h('onKeyPress', id),
              onEnterRelease: h('onEnterRelease', id),
            }
          : {
              onCaptureEnter: h('onCaptureEnter', id),
              onEnter: h('onEnter', id),
              onKeyPress: h('onKeyPress', id),
              onCaptureEnterRelease: h('onCaptureEnterRelease', id),
              onEnterRelease: h('onEnterRelease', id),
            },
      );
      target.down('Enter');
      target.up('Enter');
      // 3 capture + 6 bubble on press, 3 capture + 3 bubble on release.
      v.expect(r.calls.length).toBe(15);
      v.expect(new Set(r.calls.map((c) => c.handler))).toEqual(
        new Set([
          'onCaptureKey',
          'onCaptureKeyRelease',
          'onCaptureEnter',
          'onEnter',
          'onKeyPress',
          'onCaptureEnterRelease',
          'onEnterRelease',
        ]),
      );
      for (const c of r.calls) v.expect(c.self).toBe(n[c.owner!]);
      dispose();
    },
  );
});

v.describe('contract: return values', () => {
  v.it('true from on<Key> stops propagation at that node', async () => {
    const r = recorder();
    const { target, dispose } = await mountChain((id) => ({
      onEnter: r.handler('onEnter', id === 'mid' ? true : undefined),
    }));
    target.down('Enter');
    v.expect(r.order()).toEqual(['leaf.onEnter', 'mid.onEnter']);
    dispose();
  });

  v.it(
    'false and undefined both let the key bubble to the parent',
    async () => {
      const r = recorder();
      const { target, dispose } = await mountChain((id) => ({
        onEnter: r.handler('onEnter', id === 'leaf' ? false : undefined),
      }));
      target.down('Enter');
      v.expect(r.order()).toEqual([
        'leaf.onEnter',
        'mid.onEnter',
        'outer.onEnter',
      ]);
      dispose();
    },
  );

  v.it(
    'only the boolean true stops: truthy values like 1 or "yes" bubble (current behaviour)',
    async () => {
      const r = recorder();
      const ret = { leaf: 1, mid: 'yes', outer: true };
      const { target, dispose } = await mountChain((id) => ({
        onEnter: r.handler('onEnter', ret[id]),
      }));
      target.down('Enter');
      v.expect(r.order()).toEqual([
        'leaf.onEnter',
        'mid.onEnter',
        'outer.onEnter',
      ]);
      dispose();
    },
  );

  v.it(
    'true from a capture handler ends the event: deeper capture handlers and the whole bubble phase are skipped',
    async () => {
      const r = recorder();
      const { target, dispose } = await mountChain((id) => ({
        ...allEnterHandlers(r)(),
        onCaptureEnter: r.handler(
          'onCaptureEnter',
          id === 'mid' ? true : undefined,
        ),
      }));
      target.down('Enter');
      v.expect(r.order()).toEqual([
        'outer.onCaptureEnter',
        'mid.onCaptureEnter',
      ]);
      dispose();
    },
  );

  v.it('true from onKeyPress stops bubbling to the parent', async () => {
    const r = recorder();
    const { target, dispose } = await mountChain((id) => ({
      onEnter: r.handler('onEnter'),
      onKeyPress: r.handler('onKeyPress', id === 'leaf' ? true : undefined),
    }));
    target.down('Enter');
    v.expect(r.order()).toEqual(['leaf.onEnter', 'leaf.onKeyPress']);
    dispose();
  });

  v.it('true from on<Key>Release stops the release bubbling', async () => {
    const r = recorder();
    const { target, dispose } = await mountChain((id) => ({
      onEnterRelease: r.handler(
        'onEnterRelease',
        id === 'leaf' ? true : undefined,
      ),
    }));
    target.down('Enter');
    target.up('Enter');
    v.expect(r.order()).toEqual(['leaf.onEnterRelease']);
    dispose();
  });
});

v.describe('contract: capture → bubble → onKeyPress order', () => {
  v.it(
    "runs onCapture<Key> root→leaf, then per node leaf→root: on<Key> then that node's onKeyPress",
    async () => {
      const r = recorder();
      const { target, dispose } = await mountChain(allEnterHandlers(r));
      target.down('Enter');
      // onKeyPress is not a separate pass after bubbling: it is tried on each
      // node right after that node's on<Key>, before the parent's on<Key>.
      v.expect(r.order()).toEqual([
        'outer.onCaptureEnter',
        'mid.onCaptureEnter',
        'leaf.onCaptureEnter',
        'leaf.onEnter',
        'leaf.onKeyPress',
        'mid.onEnter',
        'mid.onKeyPress',
        'outer.onEnter',
        'outer.onKeyPress',
      ]);
      dispose();
    },
  );

  v.it(
    'arguments: capture (e, node, focusedLeaf, mappedName); on<Key> (e, node, focusedLeaf); onKeyPress (e, mappedName, node, focusedLeaf)',
    async () => {
      const r = recorder();
      const { n, target, dispose } = await mountChain(allEnterHandlers(r));
      const e = target.down('Enter');
      const call = (key: string) =>
        r.calls.find((c) => `${c.node}.${c.handler}` === key)!;
      v.expect(call('outer.onCaptureEnter').args).toEqual([
        e,
        n.outer,
        n.leaf,
        'Enter',
      ]);
      v.expect(call('mid.onEnter').args).toEqual([e, n.mid, n.leaf]);
      v.expect(call('mid.onKeyPress').args).toEqual([
        e,
        'Enter',
        n.mid,
        n.leaf,
      ]);
      v.expect(call('outer.onCaptureEnter').args[0]).toBe(e);
      dispose();
    },
  );

  v.it(
    'onCaptureKey runs only on nodes without onCapture<Key>, with the same arguments',
    async () => {
      const r = recorder();
      const { n, target, dispose } = await mountChain((id) =>
        id === 'mid'
          ? {
              onCaptureEnter: r.handler('onCaptureEnter'),
              onCaptureKey: r.handler('onCaptureKey'),
            }
          : { onCaptureKey: r.handler('onCaptureKey') },
      );
      const e = target.down('Enter');
      v.expect(r.order()).toEqual([
        'outer.onCaptureKey',
        'mid.onCaptureEnter',
        'leaf.onCaptureKey',
      ]);
      v.expect(r.calls[0]!.args).toEqual([e, n.outer, n.leaf, 'Enter']);
      dispose();
    },
  );

  v.it(
    'an unmapped key: capture looks up onCapture<e.key> then onCaptureKey; bubble calls only onKeyPress, with mappedName undefined',
    async () => {
      const r = recorder();
      const { n, target, dispose } = await mountChain((id) => ({
        ...(id === 'outer'
          ? {
              [`onCapture${UNMAPPED_KEY}`]: r.handler(
                `onCapture${UNMAPPED_KEY}`,
              ),
            }
          : { onCaptureKey: r.handler('onCaptureKey') }),
        [`on${UNMAPPED_KEY}`]: r.handler(`on${UNMAPPED_KEY}`),
        onKeyPress: r.handler('onKeyPress'),
      }));
      const e = target.down(UNMAPPED_KEY);
      v.expect(r.order()).toEqual([
        `outer.onCapture${UNMAPPED_KEY}`,
        'mid.onCaptureKey',
        'leaf.onCaptureKey',
        'leaf.onKeyPress',
        'mid.onKeyPress',
        'outer.onKeyPress',
      ]);
      v.expect(r.calls[0]!.args).toEqual([e, n.outer, n.leaf, undefined]);
      v.expect(r.calls[3]!.args).toEqual([e, undefined, n.leaf, n.leaf]);
      dispose();
    },
  );

  v.it(
    'key release: onCapture<Key>Release / onCaptureKeyRelease root→leaf, then on<Key>Release leaf→root; no onKeyPress, on<Key> or onCapture<Key>',
    async () => {
      const r = recorder();
      const { n, target, dispose } = await mountChain((id) => ({
        ...allEnterHandlers(r)(),
        ...(id === 'mid'
          ? {
              onCaptureEnterRelease: undefined,
              onCaptureKeyRelease: r.handler('onCaptureKeyRelease'),
            }
          : {}),
      }));
      target.down('Enter');
      r.clear();
      const e = target.up('Enter');
      v.expect(r.order()).toEqual([
        'outer.onCaptureEnterRelease',
        'mid.onCaptureKeyRelease',
        'leaf.onCaptureEnterRelease',
        'leaf.onEnterRelease',
        'mid.onEnterRelease',
        'outer.onEnterRelease',
      ]);
      v.expect(r.calls[0]!.args).toEqual([e, n.outer, n.leaf, 'Enter']);
      v.expect(r.calls[3]!.args).toEqual([e, n.leaf, n.leaf]);
      dispose();
    },
  );
});

v.describe('contract: key map', () => {
  v.it(
    'custom names dispatch on<Name>, onCapture<Name>, on<Name>Release and onCapture<Name>Release',
    async () => {
      const r = recorder();
      const { target, dispose } = await mountChain(
        (id) =>
          id === 'leaf'
            ? {
                onCaptureMenu: r.handler('onCaptureMenu'),
                onMenu: r.handler('onMenu'),
                onCaptureMenuRelease: r.handler('onCaptureMenuRelease'),
                onMenuRelease: r.handler('onMenuRelease'),
                onKeyPress: r.handler('onKeyPress'),
              }
            : {},
        menuKeyMap,
      );
      target.down(MENU_KEY);
      target.up(MENU_KEY);
      v.expect(r.order()).toEqual([
        'leaf.onCaptureMenu',
        'leaf.onMenu',
        'leaf.onKeyPress',
        'leaf.onCaptureMenuRelease',
        'leaf.onMenuRelease',
      ]);
      v.expect(r.calls[2]!.args[1]).toBe('Menu');
      dispose();
    },
  );

  v.it(
    'one name can map several keys, by key string or by numeric keyCode',
    async () => {
      const r = recorder();
      const { target, dispose } = await mountChain(
        (id) => (id === 'leaf' ? { onMenu: r.handler('onMenu') } : {}),
        menuKeyMap,
      );
      target.down(MENU_KEY);
      // A host that reports only a keyCode (webOS reports 'Unidentified').
      target.down('Unidentified', { keyCode: MENU_KEYCODE });
      target.down('', { keyCode: MENU_KEYCODE });
      v.expect(r.order()).toEqual([
        'leaf.onMenu',
        'leaf.onMenu',
        'leaf.onMenu',
      ]);
      dispose();
    },
  );

  v.it('a mapped e.key wins over a mapped e.keyCode', async () => {
    const r = recorder();
    const { target, dispose } = await mountChain(
      (id) =>
        id === 'leaf'
          ? { onMenu: r.handler('onMenu'), onLeft: r.handler('onLeft') }
          : {},
      menuKeyMap,
    );
    target.down('ArrowLeft', { keyCode: MENU_KEYCODE });
    v.expect(r.order()).toEqual(['leaf.onLeft']);
    dispose();
  });

  v.it(
    'a custom map is merged over the defaults: default keys keep working',
    async () => {
      const r = recorder();
      const { target, dispose } = await mountChain(
        (id) =>
          id === 'leaf'
            ? {
                onLeft: r.handler('onLeft'),
                onRight: r.handler('onRight'),
                onUp: r.handler('onUp'),
                onDown: r.handler('onDown'),
                onEnter: r.handler('onEnter'),
                onMenu: r.handler('onMenu'),
              }
            : {},
        menuKeyMap,
      );
      for (const key of [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Enter',
        MENU_KEY,
      ]) {
        target.down(key);
      }
      v.expect(r.order()).toEqual([
        'leaf.onLeft',
        'leaf.onRight',
        'leaf.onUp',
        'leaf.onDown',
        'leaf.onEnter',
        'leaf.onMenu',
      ]);
      dispose();
    },
  );

  // B4 (fixed): KeyMap types allow `{ Left: null }`
  // (src/core/focusKeyTypes.ts), but flattenKeyMap ran
  // `delete targetMap['Left']` on a table keyed by *key*
  // ('ArrowLeft' → 'Left'), so the defaults for that name were never removed.
  // null now unmaps the name's keys.
  v.it('a null value removes the keys mapped to that name', async () => {
    const r = recorder();
    try {
      const { target, dispose } = await mountChain(
        (id) => (id === 'leaf' ? { onLeft: r.handler('onLeft') } : {}),
        { Left: null },
      );
      target.down('ArrowLeft');
      v.expect(r.order()).toEqual([]);
      dispose();
    } finally {
      createRoot((d) => {
        useFocusManager({ Left: ['ArrowLeft'] }, new KeyTarget());
        d();
      });
    }
  });

  v.it(
    'a null value under a key (not a name) still removes that key (kept with B4)',
    async () => {
      const r = recorder();
      const { target, dispose } = await mountChain(
        (id) => (id === 'leaf' ? { onMenu: r.handler('onMenu') } : {}),
        { Menu: [NULLED_KEY] } as Partial<KeyMap>,
      );
      target.down(NULLED_KEY);
      createRoot((d) => {
        useFocusManager(
          { [NULLED_KEY]: null } as Partial<KeyMap>,
          new KeyTarget(),
        );
        d();
      });
      target.down(NULLED_KEY);
      v.expect(r.order()).toEqual(['leaf.onMenu']);
      dispose();
    },
  );
});

v.describe('contract: hold', () => {
  // The demo app calls useFocusManager(keyMap, { userKeyHoldMap, holdThreshold })
  // and uses on<Name>Hold. That path was removed in 1.5.1 (78f5fde) in favour
  // of the useHold primitive; the second argument is now an event target and
  // an object that cannot listen is ignored.
  const legacyOptions = {
    userKeyHoldMap: { EnterHold: ['Enter', 13] },
    holdThreshold: 1000,
  };

  // Mounts with the legacy options. They make the focus manager listen on
  // document, which other test files also listen on, so call the registered
  // listeners directly instead of dispatching on document.
  async function mountLegacy(handlers: Record<string, unknown>) {
    const add = v.vi.spyOn(document, 'addEventListener');
    const dispose = renderer.render(() => {
      useFocusManager(
        { Menu: [LEGACY_MENU_KEY] },
        legacyOptions as unknown as KeyEventTarget,
      );
      return <view autofocus {...handlers} />;
    }) as unknown as () => void;
    const registered = add.mock.calls.filter(
      ([type]) => type === 'keydown' || type === 'keyup',
    );
    add.mockRestore();
    await flush();
    const listener = (type: 'keydown' | 'keyup') =>
      registered.find(([t]) => t === type)![1] as unknown as (
        e: KeyEventLike,
      ) => void;
    const fire =
      (type: 'keydown' | 'keyup') =>
      (key: string, keyCode = 0, repeat = false) =>
        listener(type)({ key, keyCode, repeat });
    return {
      registered,
      down: fire('keydown'),
      up: fire('keyup'),
      dispose,
    };
  }

  v.afterEach(() => {
    v.vi.useRealTimers();
  });

  v.it(
    'useFocusManager(keyMap, { userKeyHoldMap, holdThreshold }) is accepted: it listens on document and applies keyMap',
    async () => {
      const r = recorder();
      const { registered, down, dispose } = await mountLegacy({
        id: 'legacy',
        onMenu: r.handler('onMenu'),
      });
      v.expect(registered.map(([type]) => type).sort()).toEqual([
        'keydown',
        'keyup',
      ]);
      // LEGACY_MENU_KEY is mapped only by this useFocusManager call.
      down(LEGACY_MENU_KEY);
      v.expect(r.order()).toEqual(['legacy.onMenu']);
      dispose();
    },
  );

  v.it(
    'on<Name>Hold is not dispatched: a key held past holdThreshold only repeats on<Name> (current behaviour since 1.5.1)',
    async () => {
      const r = recorder();
      const { down, up, dispose } = await mountLegacy({
        id: 'legacy',
        onEnter: r.handler('onEnter'),
        onEnterHold: r.handler('onEnterHold'),
        onKeyHold: r.handler('onKeyHold'),
        onEnterRelease: r.handler('onEnterRelease'),
      });
      v.vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      down('Enter', 13);
      v.vi.advanceTimersByTime(600);
      down('Enter', 13, true);
      v.vi.advanceTimersByTime(600);
      down('Enter', 13, true);
      up('Enter', 13);
      v.expect(r.order()).toEqual([
        'legacy.onEnter',
        'legacy.onEnter',
        'legacy.onEnter',
        'legacy.onEnterRelease',
      ]);
      dispose();
    },
  );

  // CONTRACT GAP: on<Name>Hold and the { userKeyHoldMap, holdThreshold }
  // options were part of the key contract until 1.5.1 removed them (1.6.4
  // has neither); useHold is the replacement. This is the pre-1.5.1
  // behaviour (78f5fde^:src/core/focusManager.ts, handleKeyEvents): a
  // hold-mapped key-down is delayed; past holdThreshold on<Name>Hold fires and
  // on<Key> does not; a release before it fires on<Key> on key-up. Unskip,
  // and delete the "not dispatched" test above, if hold maps come back.
  v.it.skip(
    'on<Name>Hold fires once a key is held past holdThreshold; a quicker release is an on<Key> tap',
    async () => {
      const r = recorder();
      const { down, up, dispose } = await mountLegacy({
        id: 'legacy',
        onEnter: r.handler('onEnter'),
        onEnterHold: r.handler('onEnterHold'),
      });
      v.vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      down('Enter', 13);
      v.vi.advanceTimersByTime(999);
      v.expect(r.order()).toEqual([]);
      v.vi.advanceTimersByTime(1);
      v.expect(r.order()).toEqual(['legacy.onEnterHold']);
      up('Enter', 13);
      r.clear();

      down('Enter', 13);
      v.vi.advanceTimersByTime(100);
      up('Enter', 13);
      v.expect(r.order()).toEqual(['legacy.onEnter']);
      dispose();
    },
  );

  async function mountUseHold() {
    const r = recorder();
    const onHold = v.vi.fn();
    const onTap = v.vi.fn();
    const onRelease = v.vi.fn();
    let holder!: ElementNode;
    const { target, dispose } = await mount(() => {
      const [startHold, releaseHold] = useHold({
        onHold,
        onEnter: onTap,
        onRelease,
        holdThreshold: 1000,
      });
      return (
        <view
          id="holder"
          ref={holder}
          autofocus
          onEnter={function (
            this: ElementNode,
            e: KeyboardEvent,
            t: ElementNode,
            h: ElementNode,
          ) {
            r.handler('onEnter').call(this, e, t, h);
            return startHold(e, t, h);
          }}
          onEnterRelease={function (
            this: ElementNode,
            e: KeyboardEvent,
            t: ElementNode,
            h: ElementNode,
          ) {
            r.handler('onEnterRelease').call(this, e, t, h);
            return releaseHold(e, t, h);
          }}
        />
      );
    });
    return { r, onHold, onTap, onRelease, holder, target, dispose };
  }

  v.it(
    'useHold on on<Key>/on<Key>Release: held past holdThreshold fires onHold once, release fires onRelease, no tap',
    async () => {
      const { r, onHold, onTap, onRelease, holder, target, dispose } =
        await mountUseHold();
      v.vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const e = target.down('Enter');
      v.vi.advanceTimersByTime(500);
      target.down('Enter', { repeat: true });
      v.expect(onHold).not.toHaveBeenCalled();
      v.vi.advanceTimersByTime(500);
      v.expect(onHold).toHaveBeenCalledTimes(1);
      v.expect(onHold).toHaveBeenCalledWith(e, holder, holder);
      // The focus manager also drops the repeats that follow a hold
      // (suppressKeyUntilRelease). That is pinned in keySuppression.test.tsx,
      // not here: useHold.spec.ts vi.mock()s the focus manager, and with
      // `isolate: false` the cached useHold module can keep that mock.
      target.up('Enter');
      v.expect(onRelease).toHaveBeenCalledTimes(1);
      v.expect(onTap).not.toHaveBeenCalled();
      v.expect(r.order()).toEqual([
        'holder.onEnter',
        'holder.onEnter',
        'holder.onEnterRelease',
      ]);
      dispose();
    },
  );

  v.it(
    'useHold: a release before holdThreshold is a tap and fires onEnter at once',
    async () => {
      const { onHold, onTap, holder, target, dispose } = await mountUseHold();
      v.vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      target.down('Enter');
      v.vi.advanceTimersByTime(100);
      const up = target.up('Enter');
      v.expect(onTap).toHaveBeenCalledTimes(1);
      v.expect(onTap).toHaveBeenCalledWith(up, holder, holder);
      v.vi.advanceTimersByTime(2000);
      v.expect(onHold).not.toHaveBeenCalled();
      v.expect(onTap).toHaveBeenCalledTimes(1);
      dispose();
    },
  );
});

v.describe('contract: per-element throttleInput', () => {
  // throttleInput compares performance.now() readings; drive the clock.
  let now: v.MockInstance<() => number>;
  const at = (ms: number) => now.mockReturnValue(ms);

  v.beforeEach(() => {
    now = v.vi.spyOn(performance, 'now');
  });
  v.afterEach(() => {
    now.mockRestore();
    Config.preventDefaultOnHandledKeys = false;
  });

  // outer > row (throttleInput=500) > item (autofocused)
  async function mountRow(
    rowRight: unknown,
    extra: {
      outer?: Record<string, unknown>;
      item?: Record<string, unknown>;
    } = {},
  ) {
    const r = recorder();
    const n: Nodes = {};
    const { target, dispose } = await mount(() => (
      <view id="outer" {...extra.outer}>
        <view
          id="row"
          ref={n.row}
          throttleInput={500}
          onRight={r.handler('onRight', rowRight)}
          onLeft={r.handler('onLeft', true)}
          onRightRelease={r.handler('onRightRelease')}
        >
          <view id="item" ref={n.item} autofocus {...extra.item} />
        </view>
      </view>
    ));
    return { r, n, target, dispose };
  }

  const count = (r: Rec, key: string) =>
    r.order().filter((k) => k === key).length;

  v.it(
    'a node drops the same key within throttleInput ms of a key it handled, and accepts it again from throttleInput ms on',
    async () => {
      const { r, target, dispose } = await mountRow(true);
      for (const t of [1000, 1100, 1499, 1500, 1600, 2000]) {
        at(t);
        target.down('ArrowRight');
      }
      // 1000 handled; 1100 and 1499 dropped; 1500 handled (exactly 500 later);
      // 1600 dropped; 2000 handled.
      v.expect(count(r, 'row.onRight')).toBe(3);
      dispose();
    },
  );

  v.it(
    'only repeats of the same key are throttled: a different key in between resets it',
    async () => {
      const { r, target, dispose } = await mountRow(true);
      at(1000);
      target.down('ArrowRight');
      at(1100);
      target.down('ArrowLeft');
      at(1200);
      target.down('ArrowRight');
      v.expect(r.order()).toEqual(['row.onRight', 'row.onLeft', 'row.onRight']);
      dispose();
    },
  );

  v.it(
    'the window starts only from a key the node itself handled (returned true)',
    async () => {
      const { r, target, dispose } = await mountRow(undefined);
      at(1000);
      target.down('ArrowRight');
      at(1100);
      target.down('ArrowRight');
      v.expect(count(r, 'row.onRight')).toBe(2);
      dispose();
    },
  );

  v.it(
    "a throttled ancestor drops the press before the focused leaf's handlers; capture handlers above it still run (current behaviour)",
    async () => {
      const outer = recorder();
      const item = recorder();
      const { r, target, dispose } = await mountRow(true, {
        outer: { onCaptureRight: outer.handler('onCaptureRight') },
        item: { onRight: item.handler('onRight') },
      });
      at(1000);
      target.down('ArrowRight');
      v.expect([...outer.order(), ...item.order(), ...r.order()]).toEqual([
        'outer.onCaptureRight',
        'item.onRight',
        'row.onRight',
      ]);
      outer.clear();
      item.clear();
      r.clear();
      at(1100);
      target.down('ArrowRight');
      v.expect(outer.order()).toEqual(['outer.onCaptureRight']);
      v.expect(item.order()).toEqual([]);
      v.expect(r.order()).toEqual([]);
      dispose();
    },
  );

  v.it(
    'a press dropped by throttleInput counts as consumed (preventDefault under Config.preventDefaultOnHandledKeys)',
    async () => {
      const { target, dispose } = await mountRow(true);
      Config.preventDefaultOnHandledKeys = true;
      at(1000);
      const first: TestKeyEvent = target.down('ArrowRight');
      at(1100);
      const dropped: TestKeyEvent = target.down('ArrowRight');
      v.expect(first.preventDefault).toHaveBeenCalledTimes(1);
      v.expect(dropped.preventDefault).toHaveBeenCalledTimes(1);
      dispose();
    },
  );

  // BUG: per-element throttling also drops key-ups. isElementThrottled
  // (src/core/focusManager.ts:285) is checked for releases too (lines 312 and
  // 350), and a key-up has the same key as the press it follows, so a release
  // within throttleInput ms of a handled press never reaches on<Key>Release
  // or onCapture<Key>Release. The global Config.throttleInput skips key-ups
  // (line 390). Breaks useHold on a throttled node (the release is lost, so a
  // tap waits for the hold timer). Expected: releases are never throttled.
  v.it.skip(
    'a key release right after a handled press still reaches on<Key>Release',
    async () => {
      const { r, target, dispose } = await mountRow(true);
      at(1000);
      target.down('ArrowRight');
      at(1050);
      target.up('ArrowRight');
      v.expect(r.order()).toEqual(['row.onRight', 'row.onRightRelease']);
      dispose();
    },
  );
});
