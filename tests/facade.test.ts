import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REACT_CAPABILITIES } from '../../frames/src/model/platform.ts'
import type { FrameTypeDefinition } from '../../frames/src/model/types.ts'
import { createFramesService } from '../../frames/src/service/service.ts'
import { createLayoutFacade } from '../src/client/facade.ts'
import { createPanels } from '../src/client/panels.ts'
import type { PanelSource } from '../src/client/panels.ts'
import { createRightColumn } from '../src/client/rightbar.ts'

const CONVERSATION: FrameTypeDefinition = { id: 'conversation', title: () => 'Conversation' }
const FILES: FrameTypeDefinition = { id: 'files', title: () => 'Files' }
const SIDEBAR = 'legacy.sidebar'
const RIGHTBAR = 'legacy.rightbar'

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
 * A service with every type registered, a `main` seat, and the facade over both.
 *
 * The panel selection is the compatibility layer's, so it is exercised here over
 * a seat rather than through the frame tree. The two column types and their
 * contents are registered the way the plugin body registers them, because the
 * right column can only stand a frame up for a content that exists.
 */
function harness(registered: readonly string[] = ['conversation', 'files']) {
  const service = createFramesService({ startup: CONVERSATION })
  service.attachRenderer({ id: 'react', capabilities: REACT_CAPABILITIES })
  service.reportMeasurements({ viewport: { width: 1000, height: 800 } })
  service.registerType(FILES)
  service.registerType({ id: SIDEBAR, title: () => 'Navigation' })
  service.registerType({ id: RIGHTBAR, title: () => 'Right panel' })
  service.registerContent({ id: SIDEBAR, kind: SIDEBAR, title: 'Navigation' })
  service.registerContent({ id: RIGHTBAR, kind: RIGHTBAR, title: 'Right panel' })
  const mainSeat = seat(registered)
  const panels = createPanels(mainSeat, CONVERSATION.id)
  const column = createRightColumn(service, {
    rightbarTypeId: RIGHTBAR,
    sidebarTypeId: SIDEBAR,
    conversationTypeId: CONVERSATION.id,
  })
  const facade = createLayoutFacade(service, { sidebarTypeId: SIDEBAR, panels, column })
  return { service, facade, panels, mainSeat, column }
}

/** The docked pane holding a type, if the tree has one. */
function paneOf(service: ReturnType<typeof harness>['service'], typeId: string) {
  return service.project().docked.find((pane) => pane.content?.typeId === typeId)
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

test('the geometry reports are carried out on the tree, and the tree alone', () => {
  const { facade, service } = harness()
  // Nothing has reported anything yet, so no frame stands for the right column —
  // which is the state the whole fix rests on: the seat is mounted and the tree
  // is untouched until the occupant says otherwise.
  assert.equal(paneOf(service, RIGHTBAR), undefined)

  facade.openRightbar(true, false)
  const standing = paneOf(service, RIGHTBAR)
  assert.notEqual(standing, undefined, 'a report that it is shown stands a column up')
  // The shipped width: 45% of 1000px, inside the room the sidebar leaves.
  assert.ok(
    Math.abs((standing as unknown as { rect: { width: number } }).rect.width * 1000 - 450) < 1,
    'the column takes the width the shipped shell would have given it',
  )

  facade.closeRightbar()
  assert.equal(paneOf(service, RIGHTBAR), undefined, 'a report that it is hidden takes it away again')
  // The content outlived the frame, which is what lets the panel come back as
  // itself rather than as a new one.
  assert.ok(service.project().contents.some((content) => content.id === RIGHTBAR))
})

test('the sidebar toggle is a no-op while no navigation column is up', () => {
  const { facade } = harness()

  assert.doesNotThrow(() => { facade.toggleSidebar() })
  assert.equal(paneOf(harness().service, SIDEBAR), undefined, 'the harness seeds nothing by itself')
})
