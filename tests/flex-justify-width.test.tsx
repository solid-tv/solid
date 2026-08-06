import * as v from 'vitest'
import * as lng from '@solidtv/solid'

import {renderer, waitForUpdate} from './setup.js'

const PARENT = 600
const CHILD = 100

v.test('flex row without width fills parent when justifyContent needs free space', async () => {
  let center!: lng.ElementNode
  let centerOne!: lng.ElementNode
  let between!: lng.ElementNode
  let betweenTwo!: lng.ElementNode

  const dispose = renderer.render(() => (
    <view width={PARENT} height={PARENT}>
      <view ref={center} display='flex' justifyContent='center' gap={0}>
        <view ref={centerOne} width={CHILD} height={CHILD} />
        <view width={CHILD} height={CHILD} />
      </view>
      <view ref={between} display='flex' justifyContent='spaceBetween' y={CHILD} gap={0}>
        <view width={CHILD} height={CHILD} />
        <view ref={betweenTwo} width={CHILD} height={CHILD} />
      </view>
    </view>
  ))

  await waitForUpdate()

  // Container fills the parent instead of shrinking to its children...
  v.assert.equal(center.width, PARENT)
  // ...so there is free space to center into: (600 - 200) / 2
  v.assert.equal(centerOne.x, (PARENT - CHILD * 2) / 2)

  // spaceBetween pushes the last child to the far edge rather than to a
  // negative offset against a zero-width container.
  v.assert.equal(between.width, PARENT)
  v.assert.equal(betweenTwo.x, PARENT - CHILD)

  dispose()
})

v.test('flex row without width still shrinks to fit for flexStart and no justifyContent', async () => {
  let implicit!: lng.ElementNode
  let start!: lng.ElementNode

  const dispose = renderer.render(() => (
    <view width={PARENT} height={PARENT}>
      <view ref={implicit} display='flex' gap={0}>
        <view width={CHILD} height={CHILD} />
        <view width={CHILD} height={CHILD} />
      </view>
      <view ref={start} display='flex' justifyContent='flexStart' y={CHILD} gap={0}>
        <view width={CHILD} height={CHILD} />
        <view width={CHILD} height={CHILD} />
      </view>
    </view>
  ))

  await waitForUpdate()

  v.assert.equal(implicit.width, CHILD * 2)
  v.assert.equal(start.width, CHILD * 2)

  dispose()
})

v.test('an explicit flexBoundary contain wins over justifyContent and warns', async () => {
  const warn = v.vi.spyOn(console, 'warn').mockImplementation(() => {})
  let contained!: lng.ElementNode

  const dispose = renderer.render(() => (
    <view width={PARENT} height={PARENT}>
      <view
        ref={contained}
        display='flex'
        flexBoundary='contain'
        justifyContent='center'
        gap={0}
      >
        <view width={CHILD} height={CHILD} />
        <view width={CHILD} height={CHILD} />
      </view>
    </view>
  ))

  await waitForUpdate()

  // The explicit contain is honored — the container is not widened to the parent.
  v.assert.notEqual(contained.width, PARENT)
  v.assert.isTrue(
    warn.mock.calls.some((args) => String(args[0]).includes('justifyContent')),
    'expected a dev warning about the contradiction',
  )

  warn.mockRestore()
  dispose()
})
