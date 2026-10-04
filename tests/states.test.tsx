import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { renderer, waitForUpdate } from './setup.js';
import States from '../src/core/states.ts';

v.describe('State Specificity', () => {
  v.test('Applies states in the order defined by Config.stateOrder', async () => {
    // Save original mapper
    const originalOrder = lng.Config.stateOrder;

    // Define mapper: $active has lower specificity than $focus
    lng.Config.stateOrder = ['$active', '$focus'];

    let node!: lng.ElementNode;

    const dispose = renderer.render(() => (
      <view
        ref={node}
        color={0xff0000ff} // default red
        states={['$focus', '$active']} // passed in reverse order to ensure sorting works
        $active={{
          color: 0x00ff00ff, // green
          scale: 1.5,
          alpha: 0.5,
        }}
        $focus={{
          color: 0x0000ffff, // blue
          scale: 2.0,
        }}
      />
    ));

    await waitForUpdate();

    // Since $focus is after $active in stateOrder, $focus should win where properties collide
    v.assert.equal(node.color, 0x0000ffff);
    v.assert.equal(node.scale, 2.0);
    // alpha is only in $active, so it should still apply
    v.assert.equal(node.alpha, 0.5);

    dispose();

    // Restore original mapper
    lng.Config.stateOrder = originalOrder;
  });

  v.test('Unmapped states have lower specificity than mapped ones', async () => {
    const originalOrder = lng.Config.stateOrder;

    // Only map $focus
    lng.Config.stateOrder = ['$focus'];

    let node!: lng.ElementNode;

    const dispose = renderer.render(() => (
      <view
        ref={node}
        color={0xff0000ff} // default red
        states={['$focus', '$hover']} // hover is unmapped
        $hover={{
          color: 0x00ff00ff, // green
          scale: 1.5,
          alpha: 0.5,
        }}
        $focus={{
          color: 0x0000ffff, // blue
          scale: 2.0,
        }}
      />
    ));

    await waitForUpdate();

    // even though $hover comes after $focus in the states array, it is unmapped,
    // so it has lower specificity than $focus
    v.assert.equal(node.color, 0x0000ffff);
    v.assert.equal(node.scale, 2.0);
    v.assert.equal(node.alpha, 0.5);

    dispose();
    lng.Config.stateOrder = originalOrder;
  });

  v.test('Element-level stateOrder overrides global Config.stateOrder', async () => {
    const originalOrder = lng.Config.stateOrder;

    // Global order: $focus > $active
    lng.Config.stateOrder = ['$active', '$focus'];

    let node!: lng.ElementNode;

    const dispose = renderer.render(() => (
      <view
        ref={node}
        color={0xff0000ff}
        states={['$focus', '$active']}
        stateOrder={['$focus', '$active']} // Override: $active > $focus
        $active={{
          color: 0x00ff00ff, // green
        }}
        $focus={{
          color: 0x0000ffff, // blue
        }}
      />
    ));

    await waitForUpdate();

    // Local override says $active is higher specificity, so color should be green
    v.assert.equal(node.color, 0x00ff00ff);

    dispose();
    lng.Config.stateOrder = originalOrder;
  });
});

v.describe('States copies a list by index', () => {
  /** A list whose iterator throws: a spread of it fails. */
  function noIterator<T extends string[]>(list: T): T {
    Object.defineProperty(list, Symbol.iterator, {
      value() {
        throw new Error('iterated');
      },
    });
    return list;
  }

  v.test('merge takes an array or another States (forwardStates) without iterating it, in place', () => {
    const states = new States(() => {}, ['$a', '$b', '$c']);
    const parent = noIterator(new States(() => {}, ['$x']));

    v.expect(states.merge(parent)).toBe(states);
    v.expect([...states]).toEqual(['$x']);

    states.merge(noIterator(['$p', '$q'] as lng.DollarString[]));
    v.expect([...states]).toEqual(['$p', '$q']);

    // A self-merge clears the list, as in 1.6.
    states.merge(states);
    v.expect([...states]).toEqual([]);

    states.merge('$s');
    v.expect([...states]).toEqual(['$s']);

    states.merge({ $t: true, $s: false });
    v.expect([...states]).toEqual(['$t']);

    states.merge([]);
    v.expect(states.length).toBe(0);
  });

  v.test('the constructor takes an array without iterating it', () => {
    const states = new States(
      () => {},
      noIterator(['$a', '$b'] as lng.DollarString[]),
    );
    v.expect(states).toBeInstanceOf(States);
    v.expect([...states]).toEqual(['$a', '$b']);
    v.expect(new States(() => {}, '$c').slice()).toEqual(['$c']);
    v.expect(new States(() => {}, { $d: true, $e: false }).slice()).toEqual([
      '$d',
    ]);
  });
});
