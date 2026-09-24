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
import {
  navWidth, SIDEBAR_COLLAPSED, SIDEBAR_MAX, SIDEBAR_MIN,
} from '../src/client/columns.ts'
import { COLUMNS_KEY, readColumnPrefs, writeColumnPrefs } from '../src/client/column-prefs.ts'
import type { ColumnPrefs } from '../src/client/column-prefs.ts'

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
  // The pane the plugin body stood the rail up in. This is the pane the column's
  // arithmetic is about — never "whichever pane shows a navigation panel", which
  // can be a frame the user made.
  navPane: (): string | undefined => 'navigation',
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
    /** Every `resizePane` the layer asked for, so a test can say what it touched. */
    resized: [] as { id: string; fraction: number }[],
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
          return { id: pane.id, rect, content: { typeId: pane.typeId } }
        }),
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    split(paneId, seed, axis) {
      if (state.refuseOpen) return { ok: false }
      if (axis !== 'row') return { ok: false }
      const at = Math.max(0, state.panes.findIndex((pane) => pane.id === paneId))
      const reference = state.panes[at] as FakePane
      const id = `pane${String(state.next)}`
      state.next += 1
      const share = reference.share / 2
      reference.share = share
      state.panes.splice(at + 1, 0, { id, share, typeId: seed })
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
      state.resized.push({ id: paneId, fraction })
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

// ---------------------------------------- the navigation column's width rules

test('the navigation column is a width in pixels, not a share of the frame', () => {
  // 280px is 280px: the same answer for a small frame and a large one. Sized as a
  // fraction it would come back 538px wide in a 1920px window, which is what made
  // the rail look far too wide after maximising a desktop window. (Both frames here
  // are above the auto-collapse breakpoint; the narrow rule has its own test.)
  assert.equal(navWidth(1200, 280, false, false), 280)
  assert.equal(navWidth(1920, 280, false, false), 280)
  // A drag is clamped into the shipped range.
  assert.equal(navWidth(1920, 900, false, false), SIDEBAR_MAX)
  assert.equal(navWidth(1920, 10, false, false), SIDEBAR_MIN)
})

test('a narrow frame collapses the column, and the user can say otherwise', () => {
  // The shipped LG breakpoint: below it the column is the 56px rail.
  assert.equal(navWidth(1023, 280, false, false), SIDEBAR_COLLAPSED)
  assert.equal(navWidth(1024, 280, false, false), 280, 'the breakpoint itself is not narrow')
  // A manual expand while narrow is a decision about this frame, not about width.
  assert.equal(navWidth(900, 280, false, true), 280)
  // And collapsing in a wide frame is the user's own toggle.
  assert.equal(navWidth(1400, 280, true, false), SIDEBAR_COLLAPSED)
  // The narrow decision does not survive leaving the narrow range.
  assert.equal(navWidth(1400, 280, false, true), 280)
})

test('the remembered columns survive a reload, and a broken record does not', () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
  }
  const defaults: ColumnPrefs = { sidebar: 280, collapsed: false, narrowExpanded: false, rightbar: undefined }

  assert.deepEqual(readColumnPrefs(storage, defaults), defaults, 'nothing stored: the shipped defaults')
  assert.deepEqual(readColumnPrefs(undefined, defaults), defaults, 'no medium at all')

  writeColumnPrefs(storage, { sidebar: 360, collapsed: true, narrowExpanded: true, rightbar: 420 })
  assert.deepEqual(readColumnPrefs(storage, defaults), {
    sidebar: 360, collapsed: true, narrowExpanded: true, rightbar: 420,
  })

  // A narrower record — an older build, or one field lost — loads what it has.
  store.set(COLUMNS_KEY, JSON.stringify({ sidebar: 300 }))
  assert.deepEqual(readColumnPrefs(storage, defaults), { ...defaults, sidebar: 300 })
  // And garbage costs a preference, not the shell.
  store.set(COLUMNS_KEY, 'not json')
  assert.deepEqual(readColumnPrefs(storage, defaults), defaults)
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

test('a pane the user put the column content in is not the column', () => {
  // The shell holds that content — it has to, since a frame displays a content —
  // so the picker offers it. A user who shows it in a pane of their own must not
  // find this layer resizing or closing it: which pane is the column is this
  // layer's arrangement, and it remembers the one it made.
  const { frames, state, notify } = tree()
  const column = createRightColumn(frames, OPTIONS)
  state.panes.push({ id: 'theirs', share: 0.2, typeId: 'rightbar' })

  notify()

  assert.equal(state.panes.some((pane) => pane.id === 'theirs'), true, 'the user\u2019s pane survives')
  assert.equal(column.getSnapshot().box, 0, 'and nothing is drawn as a column')
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

test('a frame the user made that shows a navigation panel is not the rail', () => {
  const { frames, state } = tree()
  // The picker offers the navigation *content*, so putting a navigation panel in
  // a frame of one's own is a reachable state — and that frame comes first in the
  // draw order here, which is exactly how the layer would mistake it for the rail
  // if it asked "which pane shows a navigation panel".
  state.panes.unshift({ id: 'mine', share: 200 / 1200, typeId: 'sidebar' })
  const column = createRightColumn(frames, OPTIONS)

  column.show(true)
  state.resized.length = 0
  column.dismiss()

  const touched = state.resized.map((call) => call.id)
  assert.ok(touched.includes('navigation'), 'the room goes back to the rail the layer stood up')
  assert.equal(touched.includes('mine'), false, "and never to a frame the user made, which is none of this layer's business")
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
