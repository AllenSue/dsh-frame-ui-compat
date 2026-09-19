/**
 * The right column's rules, over a tree small enough to steer by hand.
 *
 * What is being guarded here is one deadlock and one cancellation:
 *
 * - the frame stands up only because the occupant reported it was shown, so the
 *   occupant must already be mounted and reporting with no frame there — which
 *   is what the boot case asserts;
 * - the occupant collapses itself the moment it is shown and told there is no
 *   room, and its report arrives after that decision, so the width it is told
 *   must never depend on whether a frame is standing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { columnShare, createRightColumn, rightbarOwner } from '../src/client/rightbar.ts'
import type { ColumnFrames } from '../src/client/rightbar.ts'

/** One pane in the fake tree: a share of the window, and what it shows. */
interface FakePane {
  id: string
  share: number
  typeId: string
}

/** The type ids the column is pointed at, named as the plugin body names them. */
const OPTIONS = {
  rightbarTypeId: 'rightbar',
  sidebarTypeId: 'sidebar',
  conversationTypeId: 'conversation',
}

/**
 * A frame tree small enough to steer by hand.
 *
 * One row split whose shares are of the whole window, which is the shape the real
 * tree has at boot, plus the three calls the column makes. A nested parent — the
 * case `columnShare` exists for — is asserted on its own rather than modelled.
 * @param viewport - the drawable width in px.
 * @returns the port, the mutable panes behind it, and a way to announce a change.
 */
function tree(viewport = 1200) {
  const state = {
    viewport,
    // The boot shape: the navigation column on the left at its shipped width,
    // and the centre taking the rest.
    panes: [
      { id: 'navigation', share: 280 / viewport, typeId: 'sidebar' },
      { id: 'centre', share: 1 - 280 / viewport, typeId: 'conversation' },
    ] as FakePane[],
    opened: [] as string[],
    focused: [] as string[],
    refuseOpen: false,
    next: 1,
  }
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }

  const frames: ColumnFrames = {
    project: () => {
      // The panes are drawn left to right in the order they are held, so a rect's
      // x is the room the ones before it take.
      let x = 0
      return {
        viewport: { width: state.viewport, height: 800 },
        docked: state.panes.map((pane) => {
          const rect = { x, width: pane.share }
          x += pane.share
          return { id: pane.id, rect, tabs: [{ typeId: pane.typeId }] }
        }),
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    openContent(contentId, options) {
      if (state.refuseOpen) return { ok: false }
      const id = `pane${String(state.next)}`
      state.next += 1
      const at = Math.max(0, state.panes.findIndex((pane) => pane.id === options?.beside))
      const beside = state.panes[at] as FakePane
      beside.share /= 2
      state.panes.splice(at + 1, 0, { id, share: beside.share, typeId: contentId })
      state.opened.push(id)
      notify()
      return { ok: true }
    },
    close(paneId) {
      const at = state.panes.findIndex((pane) => pane.id === paneId)
      if (at < 0) return { ok: false }
      const gone = state.panes.splice(at, 1)[0] as FakePane
      // The survivors take the freed share in proportion — except the navigation
      // column, which is registered `grows: false`, exactly as the plugin body
      // registers it.
      const takers = state.panes.filter((pane) => pane.typeId !== 'sidebar')
      const held = takers.reduce((sum, pane) => sum + pane.share, 0)
      for (const pane of takers) {
        pane.share += gone.share * (held > 0 ? pane.share / held : 1 / takers.length)
      }
      notify()
      return { ok: true }
    },
    resizePane(paneId, fraction) {
      const pane = state.panes.find((candidate) => candidate.id === paneId)
      if (pane === undefined) return { ok: false }
      const others = state.panes.filter((candidate) => candidate.id !== paneId)
      const held = others.reduce((sum, candidate) => sum + candidate.share, 0)
      pane.share = fraction
      for (const other of others) {
        other.share = held > 0 ? (other.share / held) * (1 - fraction) : (1 - fraction) / others.length
      }
      notify()
      return { ok: true }
    },
    focus(paneId) {
      state.focused.push(paneId)
      return { ok: true }
    },
  }
  return { frames, state, notify }
}

/** The pane standing for the column, if there is one. */
const standing = (panes: readonly FakePane[]): FakePane | undefined =>
  panes.find((pane) => pane.typeId === 'rightbar')

test('the occupant is told the width the column would take, not the frame it has', () => {
  // The shipped solution: 45% of the window, inside the room the third column
  // leaves the centre, clamped to the panel's own range.
  assert.deepEqual(rightbarOwner(1200, 280, undefined), { width: 520, viewportWidth: 1200, canShow: true })
  // A width the user left the panel at wins, as far as the room goes.
  assert.equal(rightbarOwner(1200, 280, 400).width, 400)
  // No room for the panel at all: the third column gives its track up.
  assert.deepEqual(rightbarOwner(700, 0, undefined), { width: 0, viewportWidth: 700, canShow: false })
})

test('the share asked for is corrected by what the last ask produced', () => {
  // A column opened inside a half-width split: the ask is scaled by the ratio
  // between the width that came back and the width wanted.
  assert.equal(columnShare(400, 200, 1 / 3), 2 / 3)
  assert.equal(columnShare(400, 0, 0.25), 0.25, 'nothing measured yet: ask as planned')
})

test('a mounted seat with no frame standing for it is already eligible', () => {
  const { frames, state } = tree()
  const column = createRightColumn(frames, OPTIONS)

  const boot = column.getSnapshot()
  assert.equal(boot.owner.canShow, true, 'the occupant must be told there is room before any report')
  assert.equal(boot.owner.width, 520)
  assert.equal(boot.box, 0, 'and nothing is drawn until it reports')
  assert.deepEqual(state.opened, [], 'the column plants no frame of its own')
})

test('a report that it is shown stands a column up, and focus stays on the content', () => {
  const { frames, state } = tree()
  const column = createRightColumn(frames, OPTIONS)

  column.show(true)

  assert.equal(state.opened.length, 1)
  assert.equal(state.panes.length, 3)
  const column0 = standing(state.panes) as FakePane
  assert.ok(Math.abs(column0.share * 1200 - 520) < 1, `column is ${String(column0.share * 1200)}px`)
  assert.deepEqual(state.focused, ['centre'], 'the shell opens onto its content, not the column')
  assert.equal(column.getSnapshot().box, 520, 'and the seat is drawn in the column')
})

test('a report that it is hidden takes the column away and leaves the seat eligible', () => {
  const { frames, state } = tree()
  const column = createRightColumn(frames, OPTIONS)
  column.show(true)

  column.dismiss()

  assert.equal(standing(state.panes), undefined)
  const hidden = column.getSnapshot()
  assert.equal(hidden.box, 0, 'nothing is drawn')
  assert.equal(hidden.owner.canShow, true, 'and the panel can still ask to be shown again')
  assert.equal(hidden.owner.width, 520, 'at the width it was left at')
})

test('the width the user drags the column to is the width it comes back at', () => {
  const { frames, state, notify } = tree()
  const column = createRightColumn(frames, OPTIONS)
  column.show(true)
  const dragged = standing(state.panes) as FakePane

  // A divider drag, as the core sees it: the share changes and nothing else.
  dragged.share = 0.3
  notify()

  assert.equal(column.getSnapshot().owner.width, 360, '360px is the user\u2019s width now')
  assert.ok(Math.abs(dragged.share * 1200 - 360) < 1, 'and the frame is left where the drag put it')

  column.dismiss()
  column.show(true)
  const again = standing(state.panes) as FakePane
  assert.ok(Math.abs(again.share * 1200 - 360) < 1, 'reopening restores the chosen width, not the default')
})

test('a column the tree lost is put back while the occupant still says it is shown', () => {
  const { frames, state, notify } = tree()
  const column = createRightColumn(frames, OPTIONS)
  column.show(true)

  // Something else removed the frame: a preset that does not include it, or a
  // close that got through before the column types refused them.
  state.panes = state.panes.filter((pane) => pane.typeId !== 'rightbar')
  notify()

  assert.notEqual(standing(state.panes), undefined, 'the column comes back')
})

test('a panel that covers the viewport reserves no track', () => {
  const { frames, state } = tree()
  const column = createRightColumn(frames, OPTIONS)

  column.show(false)

  assert.equal(standing(state.panes), undefined)
  assert.equal(column.getSnapshot().box, 0)
})

test('a column that cannot be stood up is reported as no room, not as shown', () => {
  const { frames, state } = tree()
  const column = createRightColumn(frames, OPTIONS)
  state.refuseOpen = true

  column.show(true)

  assert.deepEqual(state.opened, [], 'the core refused the frame')
  assert.equal(column.getSnapshot().owner.canShow, false, 'so the occupant is told the truth and collapses')
  assert.equal(column.getSnapshot().box, 0)
})

test('a navigation column collapsed to its rail is left collapsed', () => {
  const { frames, state } = tree()
  const column = createRightColumn(frames, OPTIONS)
  column.show(true)

  // `toggleSidebar`, as the facade sends it: the column never disappears, it
  // becomes the rail.
  const navigation = state.panes.find((pane) => pane.typeId === 'sidebar') as FakePane
  navigation.share = 56 / 1200
  column.dismiss()

  assert.ok(
    Math.abs(navigation.share * 1200 - 56) < 1,
    `the rail was expanded back to ${String(navigation.share * 1200)}px by the close`,
  )
})

test('the column takes the window edge, not the pane the conversation is in', () => {
  const { frames, state } = tree()
  // The user has already split the centre, so the conversation is no longer the
  // rightmost pane — and the shipped third column was always the outermost one.
  state.panes = [
    { id: 'navigation', share: 280 / 1200, typeId: 'sidebar' },
    { id: 'centre', share: 0.4, typeId: 'conversation' },
    { id: 'notes', share: 0.3667, typeId: 'notes' },
  ]
  const column = createRightColumn(frames, OPTIONS)

  column.show(true)

  assert.equal(state.panes[state.panes.length - 1]?.typeId, 'rightbar', 'the column is the outermost one')
})

test('opening and closing the column does not walk the sidebar narrower', () => {
  // The core gives a pane its share proportionally from every sibling, so the
  // third column takes a little of the navigation column's room; a close hands
  // the freed share to the centre and leaves the rail where it was squeezed to.
  // Without the column handing that room back, every cycle would cost the sidebar
  // another slice — which is the failure this asserts against.
  const { frames, state } = tree()
  const column = createRightColumn(frames, OPTIONS)
  const navWidth = (): number =>
    (state.panes.find((pane) => pane.typeId === 'sidebar') as FakePane).share * state.viewport
  const before = navWidth()

  for (let cycle = 0; cycle < 3; cycle += 1) {
    column.show(true)
    column.dismiss()
  }

  assert.ok(
    Math.abs(navWidth() - before) < 1,
    `the navigation column is ${String(navWidth())}px, it was ${String(before)}px`,
  )
})

test('a narrowed window takes the track away without forgetting the width', () => {
  const { frames, state, notify } = tree()
  const column = createRightColumn(frames, OPTIONS)
  column.show(true)
  // The user leaves the panel at 360px.
  const dragged = standing(state.panes) as FakePane
  dragged.share = 0.3
  notify()
  assert.equal(column.getSnapshot().owner.width, 360)

  state.viewport = 700
  notify()

  assert.equal(standing(state.panes), undefined, 'no room for the panel, so no track')
  assert.equal(column.getSnapshot().owner.canShow, false)

  state.viewport = 1600
  notify()

  // A fresh panel would solve to 45% of 1600 — 720px. The 360px the user chose is
  // what the column remembers, so that is what a later open comes back to.
  const back = column.getSnapshot().owner
  assert.equal(back.canShow, true)
  assert.equal(back.width, 360)
})
