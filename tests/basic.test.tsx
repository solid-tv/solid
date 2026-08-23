import * as v from 'vitest'
import * as s from 'solid-js'
import * as lng from '@solidtv/solid'

import {renderer} from './setup.js'

v.test('Basic test', () => {
  const dispose = renderer.render(() => <></>)
  v.assert.ok(renderer.rootNode instanceof lng.ElementNode)
  dispose()
})

v.test('Update text', () => {

  const [count, setCount] = s.createSignal(0)

  const dispose = renderer.render(() => <>
    <view>
      <text>Count is {''+count()}!</text>
    </view>
  </>)

  v.assert.equal(renderer.rootNode.children[0]!.children[0]!.text, 'Count is 0!')

  // Solid 2.0 batches writes to a microtask, so a write is not visible to a
  // synchronous read until flush(). Under 1.x these assertions passed without
  // it. This is the one migration change that fails silently in app code.
  setCount(1)
  s.flush()
  v.assert.equal(renderer.rootNode.children[0]!.children[0]!.text, 'Count is 1!')

  setCount(2)
  s.flush()
  v.assert.equal(renderer.rootNode.children[0]!.children[0]!.text, 'Count is 2!')

  dispose()
})

// Solid 2.0 changed createElement from `createElement(tag)` to
// `createElement(tag, staticProps)`, passing every compile-time-constant prop
// as one object instead of a setProp call each. A renderer that ignores the
// second argument still typechecks and still compiles — it just silently drops
// every static prop and renders a blank UI. Nothing else in this suite would
// catch that, so assert it directly.
//
// The node is captured by ref rather than indexed off rootNode.children: the
// suite shares one renderer (isolate: false) and node removal is deferred via
// enqueueDelete, so disposed siblings can still be present.
v.test('static JSX props reach the node (Solid 2.0 createElement staticProps)', () => {
  let node!: lng.ElementNode

  const dispose = renderer.render(() => <>
    <view ref={node} width={100} height={50} x={7} y={9} color="#ff0000ff" />
  </>)

  v.assert.equal(node.width, 100, 'width')
  v.assert.equal(node.height, 50, 'height')
  v.assert.equal(node.x, 7, 'x')
  v.assert.equal(node.y, 9, 'y')
  v.assert.equal(node.color, '#ff0000ff', 'color')

  dispose()
})

// Static and reactive props are applied through different code paths in 2.0
// (the staticProps bag vs. a setProp inside an effect). Mixing them on one
// element checks that the bag does not clobber the reactive writes.
v.test('static and reactive props coexist on one element', () => {
  const [w, setW] = s.createSignal(10)
  let node!: lng.ElementNode

  const dispose = renderer.render(() => <>
    <view ref={node} width={w()} height={50} color="#00ff00ff" />
  </>)

  v.assert.equal(node.width, 10)
  v.assert.equal(node.height, 50)

  setW(80)
  s.flush()
  v.assert.equal(node.width, 80, 'reactive prop updates')
  v.assert.equal(node.height, 50, 'static prop survives a reactive update')

  dispose()
})
