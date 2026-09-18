import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REACT_CAPABILITIES } from '../../frames/src/model/platform.ts'
import type { FrameTypeDefinition } from '../../frames/src/model/types.ts'
import { createFramesService } from '../../frames/src/service/service.ts'
import { createLayoutFacade } from '../src/client/facade.ts'
import { createPanels } from '../src/client/panels.ts'
import type { PanelSource } from '../src/client/panels.ts'

const CONVERSATION: FrameTypeDefinition = { id: 'conversation', title: () => 'Conversation' }
const FILES: FrameTypeDefinition = { id: 'files', title: () => 'Files' }

/** A `main` seat over a mutable list of registered keys. */
function seat(initial: readonly string[] = []): PanelSource & { set(keys: readonly string[]): void } {
  let keys = [...initial]
  const listeners = new Set<() => void>()
  return {
    keys: () => keys,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next) {
      keys = [...next]
      for (const listener of listeners) listener()
    },
  }
}

/**
 * A service with both types registered, a `main` seat, and the facade over both.
 *
 * The panel selection is the compatibility layer's, so it is exercised here over
 * a seat rather than through the frame tree.
 */
function harness(registered: readonly string[] = ['conversation', 'files']) {
  const service = createFramesService({ startup: CONVERSATION })
  service.attachRenderer({ id: 'react', capabilities: REACT_CAPABILITIES })
  service.reportMeasurements({ viewport: { width: 1000, height: 800 } })
  service.registerType(FILES)
  const mainSeat = seat(registered)
  const panels = createPanels(mainSeat, CONVERSATION.id)
  const facade = createLayoutFacade(service, {
    conversationTypeId: CONVERSATION.id,
    sidebarTypeId: 'legacy.sidebar',
    rightbarTypeId: 'legacy.rightbar',
    panels,
  })
  return { service, facade, panels, mainSeat }
}

test('selecting no panel returns the centre to the conversation', () => {
  const { facade, panels } = harness()
  facade.selectPanel('files')
  assert.equal(panels.entryKey(), 'files')

  facade.selectPanel(null)
  assert.equal(panels.entryKey(), 'conversation', 'the reserved key means the conversation')
  assert.equal(panels.getSnapshot().activePanelId, null)
})

test('an unregistered panel throws and leaves the selection alone', () => {
  const { facade, panels } = harness()
  facade.selectPanel('files')

  assert.throws(() => { facade.selectPanel('missing') }, /main panel "missing" is not registered/)
  assert.equal(panels.entryKey(), 'files', 'the selection survived the refusal')
})

test('selecting a registered panel is what the centre then draws', () => {
  const { facade, panels } = harness()

  facade.selectPanel('files')

  assert.equal(panels.entryKey(), 'files')
  assert.equal(panels.getSnapshot().activePanelId, 'files')
})

test('a selection aborts the navigation signal a caller is holding', () => {
  const { facade } = harness()
  const first = facade.beginNavigation()
  assert.equal(first.aborted, false)

  facade.selectPanel(null)
  assert.equal(first.aborted, true)
})

test('a refused selection leaves a pending navigation alone', () => {
  const { facade } = harness()
  const pending = facade.beginNavigation()

  assert.throws(() => { facade.selectPanel('missing') })

  assert.equal(pending.aborted, false, 'the caller learns nothing happened, which is the truth')
})

test('a later navigation aborts the one before it', () => {
  const { facade } = harness()
  const first = facade.beginNavigation()
  const second = facade.beginNavigation()

  assert.equal(first.aborted, true)
  assert.equal(second.aborted, false)
})

// ------------------------------------------- panels the layer never heard of

test('a plugin that registers a panel after mounting is selectable at once', () => {
  // The whole point of keeping this selection here: an extension nobody knew
  // about when this layer was written works the moment it registers.
  const { facade, panels, mainSeat } = harness(['conversation'])
  assert.throws(() => { facade.selectPanel('a-plugin-from-the-future') }, /is not registered/)

  mainSeat.set(['conversation', 'a-plugin-from-the-future'])
  facade.selectPanel('a-plugin-from-the-future')

  assert.equal(panels.entryKey(), 'a-plugin-from-the-future')
})

test('a panel whose plugin goes away falls back rather than drawing nothing', () => {
  const { facade, panels, mainSeat } = harness(['conversation', 'files'])
  facade.selectPanel('files')

  mainSeat.set(['conversation'])
  panels.sync()

  assert.equal(panels.entryKey(), 'conversation')
  assert.equal(panels.getSnapshot().activePanelId, null)
})

test('the published snapshot keeps its identity until the selection changes', () => {
  const { facade, panels } = harness()
  const before = panels.getSnapshot()

  assert.equal(panels.getSnapshot(), before, 'a read must not build a new object')
  panels.sync()
  assert.equal(panels.getSnapshot(), before, 'and a no-op sync must not either')

  facade.selectPanel('files')
  assert.notEqual(panels.getSnapshot(), before)
})

test('the geometry actions exist and do nothing', () => {
  const { facade } = harness()

  assert.doesNotThrow(() => {
    facade.toggleSidebar()
    facade.openRightbar(true, false)
    facade.closeRightbar()
  })
})
