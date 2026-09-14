import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REACT_CAPABILITIES } from '../../frames/src/model/platform.ts'
import type { FrameTypeDefinition } from '../../frames/src/model/types.ts'
import { createFramesService } from '../../frames/src/service/service.ts'
import { createLayoutFacade } from '../src/client/facade.ts'

const CONVERSATION: FrameTypeDefinition = { id: 'conversation', title: () => 'Conversation' }
const FILES: FrameTypeDefinition = { id: 'files', title: () => 'Files' }

/** A service with both types registered, plus the facade over it. */
function harness() {
  const service = createFramesService({ startup: CONVERSATION })
  service.attachRenderer({ id: 'react', capabilities: REACT_CAPABILITIES })
  service.reportMeasurements({ viewport: { width: 1000, height: 800 } })
  service.registerType(FILES)
  const facade = createLayoutFacade(service, {
    conversationTypeId: CONVERSATION.id,
    isRegistered: (typeId) => typeId === CONVERSATION.id || typeId === FILES.id,
  })
  return { service, facade }
}

test('selecting no panel returns to the conversation frame', () => {
  const { service, facade } = harness()
  service.split(undefined, FILES.id)
  assert.notEqual(service.activeTypeId(), CONVERSATION.id)

  facade.selectPanel(null)
  assert.equal(service.activeTypeId(), CONVERSATION.id)
})

test('an unregistered panel throws and leaves the selection alone', () => {
  const { service, facade } = harness()
  const before = service.activeTypeId()

  assert.throws(() => { facade.selectPanel('missing') }, /main panel "missing" is not registered/)
  assert.equal(service.activeTypeId(), before)
})

test('selecting a registered panel opens it', () => {
  const { service, facade } = harness()
  assert.equal(service.isOpen(FILES.id), false)

  facade.selectPanel(FILES.id)
  assert.equal(service.isOpen(FILES.id), true)
  assert.equal(service.activeTypeId(), FILES.id)
})

test('a selection aborts the navigation signal a caller is holding', () => {
  const { facade } = harness()
  const first = facade.beginNavigation()
  assert.equal(first.aborted, false)

  facade.selectPanel(null)
  assert.equal(first.aborted, true)
})

test('a later navigation aborts the one before it', () => {
  const { facade } = harness()
  const first = facade.beginNavigation()
  const second = facade.beginNavigation()

  assert.equal(first.aborted, true)
  assert.equal(second.aborted, false)
})

test('the geometry actions exist and do nothing', () => {
  const { facade } = harness()

  assert.doesNotThrow(() => {
    facade.toggleSidebar()
    facade.openRightbar(true, false)
    facade.closeRightbar()
  })
})
