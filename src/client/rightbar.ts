/**
 * The right column: what its occupant is told, and when a frame stands for it.
 *
 * `ui-layout` always had a right column. It was a grid track that stayed in the
 * DOM at 0px while the panel was hidden, so the occupant was always mounted and
 * could say when it wanted to be shown. A frame cannot do that: `resizePane`'s
 * floor is 2% and the engine refuses a zero share, so "hidden" cannot be a very
 * narrow frame — it has to be no frame at all.
 *
 * Which splits the column in two, and this file is the seam:
 *
 * - the **seat** is the occupant's, and it outlives every frame: it is hosted in
 *   `frames.overlay`, so the panel, its store and its reporting keep running
 *   while nothing displays it;
 * - the **frame** only reserves the space. It exists exactly while the occupant
 *   reports that it is shown and wants a track.
 *
 * The numbers are the shipped ones, and the direction they travel in matters.
 * The occupant is told the width the column *would* take if the panel were shown
 * — never a zero because no frame is standing. `RightbarSeat` collapses itself
 * the moment it is shown and told `canShow: false`, and its report reaches this
 * layer a commit later than its own decision, so a width that only becomes real
 * after the report would cancel every attempt to open the panel. The shipped
 * shell says the same thing in `AppFrame.tsx:165-168`: eligibility must include
 * the space before the occupant's first shown report arrives.
 *
 * The width this column takes comes out of the panes that can give it. That was
 * once a deliberate difference from the shipped grid: the port's `resizePane`
 * charged every sibling in proportion, so opening the panel also squeezed the
 * navigation rail by a few pixels and the layer handed that back when the column
 * closed. The rail is now declared **fixed** (`grows: false`), so the core keeps
 * its share and charges the rest — which is what the shipped grid's
 * `280px minmax(0, 1fr) 0` did all along. The hand-back below stays as the
 * repair for a rail the *user* moved while the column was open, and for a rail
 * that is not declared fixed.
 */
import type { RightbarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  clampWidth, computeColumns, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN,
  SIDEBAR_COLLAPSED, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/** One docked pane, as this file reads it. */
export interface ColumnPane {
  readonly id: string
  readonly rect: { readonly x: number; readonly width: number }
  /** What the frame displays; `undefined` for one waiting for a choice. */
  readonly content: { readonly typeId: string } | undefined
}

/** What this file needs from the frame tree. */
export interface ColumnFrames {
  /** Make a frame beside a reference one, seeded with a type. */
  split(paneId: string | undefined, seed: string, axis: string): { ok: boolean }
  close(paneId: string): { ok: boolean }
  resizePane(paneId: string, fraction: number): { ok: boolean }
  focus(paneId: string): { ok: boolean }
  /** The projection, as the facade reads it too. */
  project(): {
    readonly viewport: { readonly width: number; readonly height: number } | undefined
    readonly docked: readonly ColumnPane[]
  }
  subscribe(listener: () => void): () => void
}

/** The type ids that play each part. */
export interface RightColumnOptions {
  /** The type whose frame reserves the column. */
  rightbarTypeId: string
  /** The type whose frame is the navigation column; its width is room taken. */
  sidebarTypeId: string
  /** The frame the column goes beside. */
  conversationTypeId: string
  /**
   * The pane the plugin body stood the navigation column up in, if it is there.
   *
   * The same distinction `columnOf` makes for this column, made for the one on
   * the left: a frame the user made that happens to display a navigation panel is
   * not the rail, so the room this column takes is measured against — and handed
   * back to — the rail and nothing else.
   */
  navPane: () => string | undefined
  /**
   * The width the panel was last left at, in px, from wherever the shell keeps it.
   *
   * `undefined` means it was never dragged, and then the shipped first-open
   * default applies: 45% of the frame, clamped to what the centre can spare.
   * Remembering it is what keeps a reload from going back to 45% of a window that
   * is now much wider — which is how a first-open default turns into "the sidebars
   * are too wide".
   */
  initialPreference?: number | undefined
  /** Told the width whenever the user changes it, so it can be remembered. */
  remember?: (width: number) => void
}

/** What the seat is handed, and how wide its own box is. */
export interface RightColumnSnapshot {
  readonly owner: RightbarOwnerProps
  /** The box the occupant is drawn in, in px; 0 while it is hidden. */
  readonly box: number
}

/** The right column, as the facade and the seat see it. */
export interface RightColumn {
  /**
   * The occupant's report that it is displayed.
   * @param track - whether it wants a column reserved for it. `false` means it
   *   covers the viewport itself, so no frame stands for it.
   */
  show(track: boolean): void
  /** The occupant's report that it is hidden. */
  dismiss(): void
  /** Make the tree and the box match the last report. Runs on every change. */
  reconcile(): void
  /** The published value; its identity changes only when the numbers do. */
  getSnapshot(): RightColumnSnapshot
  subscribe(listener: () => void): () => void
  /** Stop following the tree. */
  dispose(): void
}

/**
 * What the occupant is told for one viewport and one width preference.
 *
 * Exported because it is the whole of the fix in one pure function: the answer
 * does not depend on whether a frame is standing for the column, which is what
 * keeps the occupant's own expand from being cancelled.
 * @param viewport - the drawable width in px.
 * @param sidebar - the navigation column's width in px, 0 when it is closed.
 * @param preference - the width the panel was last left at, or `undefined`
 *   before it was ever shown.
 * @returns the width the column would take, and whether there is room for it.
 */
export function rightbarOwner(viewport: number, sidebar: number, preference: number | undefined): RightbarOwnerProps {
  const wanted = preference ?? viewport * RIGHTBAR_DEFAULT_RATIO
  const columns = computeColumns(viewport, sidebar, wanted)
  // Whole pixels: this is handed to a stylesheet, and a fraction of a pixel there
  // is only noise the comparisons above would then have to tolerate.
  return { width: Math.round(columns.rightbar), viewportWidth: viewport, canShow: columns.rightbar > 0 }
}

/**
 * The share to ask the core for, corrected by what the last ask produced.
 *
 * `resizePane` takes a share of the pane's *parent split*, and this layer cannot
 * know which split that is: a column opened beside a centre the user has already
 * split becomes a child of that inner split, not of the window. Rather than
 * guess, the caller asks in window fractions, measures what came back, and
 * scales the ask by the ratio — which divides the parent's width back out.
 * @param wanted - the width in px the column should have.
 * @param measured - the width in px the last ask produced.
 * @param asked - the share that produced it.
 * @returns the share to ask for.
 */
export function columnShare(wanted: number, measured: number, asked: number): number {
  if (!(measured > 0) || !Number.isFinite(measured) || !(asked > 0)) return asked
  return asked * (wanted / measured)
}

/**
 * Build the column over a frame tree.
 * @param frames - the tree, through the service the renderer published.
 * @param options - the type ids that play each part.
 * @returns the column, already following the tree.
 */
export function createRightColumn(frames: ColumnFrames, options: RightColumnOptions): RightColumn {
  /**
   * The width the panel was last left at, in px.
   *
   * Seeded from what the shell remembered, so a reload comes back to the width
   * the user dragged to — the shipped store did the same, which is why its 45%
   * first-open default was rarely what anyone saw. Set on first show when there is
   * nothing remembered.
   */
  let preference: number | undefined = options.initialPreference
  /** What the occupant last reported: shown at all, and whether it wants a track. */
  let shown = false
  let track = false
  /** Whether the last attempt to stand a frame up was refused (no room, mostly). */
  let refused = false
  /** The viewport and the width this layer last left the frame at. */
  let lastViewport: number | undefined
  let lastAsked: number | undefined
  /** The pane this layer opened for the column. Never a pane the user made. */
  let columnPane: string | undefined
  /** What the navigation column had before the third column took room. */
  let navRestore: { readonly id: string; readonly width: number } | undefined

  let listeners = new Set<() => void>()
  let reconciling = false
  let snapshot: RightColumnSnapshot = { owner: rightbarOwner(0, 0, undefined), box: 0 }

  /** The pane holding a type, if the tree has one. */
  const paneFor = (docked: readonly ColumnPane[], typeId: string): ColumnPane | undefined =>
    docked.find((pane) => pane.content?.typeId === typeId)

  const widthOf = (pane: ColumnPane | undefined, viewport: number): number =>
    // Whole pixels, because the same number is handed to a stylesheet as a width
    // and compared against what was asked for.
    pane === undefined ? 0 : Math.round(pane.rect.width * viewport)

  /**
   * The pane the plugin body stood up as the navigation column.
   *
   * Deliberately not "whichever pane shows the navigation type": the shell has to
   * register that content for a frame to display it, so the picker offers it, and
   * a user who puts a navigation panel in a frame of their own would otherwise
   * have this layer measuring and resizing *their* frame as if it were the rail.
   * @param docked - the projection's panes.
   * @returns the rail's pane, or undefined when the shell has none.
   */
  const navOf = (docked: readonly ColumnPane[]): ColumnPane | undefined => {
    const id = options.navPane()
    return id === undefined ? undefined : docked.find((pane) => pane.id === id)
  }

  /** The pane that already reaches furthest right, which is where a column goes. */
  const rightmost = (docked: readonly ColumnPane[]): ColumnPane | undefined =>
    docked.reduce<ColumnPane | undefined>(
      (best, pane) => best === undefined || pane.rect.x + pane.rect.width > best.rect.x + best.rect.width ? pane : best,
      undefined,
    )

  /** The width the navigation column takes out of the window, 0 when it is closed. */
  const sidebarWidth = (view: ReturnType<ColumnFrames['project']>, viewport: number): number =>
    widthOf(navOf(view.docked), viewport)

  /**
   * The pane standing for the column: the one this layer opened, and only that
   * one.
   *
   * Deliberately not "whichever pane shows the column's content". The shell
   * registers that content — it has to, since a frame displays a content — so the
   * picker offers it, and a user who puts it in a pane of their own would find
   * this layer resizing and closing it. Which pane is the column is this layer's
   * arrangement, so it remembers it.
   * @param docked - the projection's panes.
   * @returns the column's pane, or undefined when there is none.
   */
  const columnOf = (docked: readonly ColumnPane[]): ColumnPane | undefined => {
    if (columnPane === undefined) return undefined
    const found = docked.find((candidate) => candidate.id === columnPane)
    // The tree dropped it — closed by a gesture, or by a preset that does not
    // include it. The next reconciliation may stand one up again.
    if (found === undefined) columnPane = undefined
    return found
  }

  /** What the occupant is told right now. */
  const ownerNow = (): RightColumnSnapshot => {
    const view = frames.project()
    const viewport = view.viewport?.width ?? 0
    const pane = columnOf(view.docked)
    const solved = rightbarOwner(viewport, sidebarWidth(view, viewport), preference)
    // While a frame stands for the column, that frame *is* the width: the panel
    // and the column have to agree to the pixel, and whatever moved the frame
    // (a drag, the sidebar taking room back) moved the column with it.
    const width = pane === undefined ? solved.width : widthOf(pane, viewport)
    return {
      owner: { width, viewportWidth: viewport, canShow: solved.canShow && !refused },
      box: shown && track && !refused ? width : 0,
    }
  }

  /** Publish what the seat draws from: a fresh object only when it says something new. */
  const publish = (): void => {
    const next = ownerNow()
    const { owner, box } = next
    if (snapshot.owner.width === owner.width && snapshot.owner.viewportWidth === owner.viewportWidth
      && snapshot.owner.canShow === owner.canShow && snapshot.box === box) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  /**
   * Take the column down and hand the navigation column its room back.
   *
   * Only a navigation column that came out *narrower* than it went in is
   * repaired, and only down to its own contract floor: a width the user chose
   * while the panel was open is theirs to keep, and a rail that was collapsed
   * stays a rail.
   * @param pane - the pane standing for the column.
   * @param viewport - the drawable width in px.
   */
  const closeColumn = (pane: ColumnPane, viewport: number): void => {
    frames.close(pane.id)
    columnPane = undefined
    const record = navRestore
    navRestore = undefined
    if (record === undefined) return
    const navigation = navOf(frames.project().docked)
    if (navigation === undefined) return
    const current = widthOf(navigation, viewport)
    // A rail stays a rail: the occupant collapsed it while the panel was open,
    // and that is a decision, not a concession to undo.
    if (current <= SIDEBAR_COLLAPSED) return
    const floor = record.width <= SIDEBAR_COLLAPSED
      ? record.width
      : clampWidth(record.width, SIDEBAR_MIN, SIDEBAR_MAX)
    if (current >= floor - 1) return
    frames.resizePane(navigation.id, floor / viewport)
  }

  /** Stand a frame up for the column, or take the standing one down. */
  const settle = (): void => {
    const view = frames.project()
    const viewport = view.viewport?.width
    if (viewport === undefined || viewport <= 0) return

    const sameViewport = lastViewport === viewport
    const navigation = navOf(view.docked)
    let pane = columnOf(view.docked)
    // The first time the panel is shown it opens at the shipped width, kept from
    // then on so reopening comes back to the width the user left.
    if (shown && track) preference ??= Math.max(RIGHTBAR_MIN, Math.round(viewport * RIGHTBAR_DEFAULT_RATIO))

    if (pane !== undefined && sameViewport && lastAsked !== undefined) {
      const measured = widthOf(pane, viewport)
      if (Math.abs(measured - lastAsked) > 1) {
        // Someone else moved it: a divider drag, a preset, the navigation column
        // taking room back. That is the width now, clamped the way the shipped
        // `setRightbar` clamped it — and remembered, so it is the width next time
        // rather than a fresh 45% of whatever the frame happens to be.
        preference = clampWidth(measured, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
        lastAsked = preference
        options.remember?.(preference)
      }
    }
    const resizedViewport = lastViewport !== undefined && !sameViewport
    lastViewport = viewport

    if (!shown || !track || rightbarOwner(viewport, sidebarWidth(view, viewport), preference).width <= 0) {
      // No column: the occupant keeps running in the overlay, and the centre
      // takes the width back.
      if (pane !== undefined) closeColumn(pane, viewport)
      else navRestore = undefined
      lastAsked = undefined
      refused = false
      return
    }

    if (pane === undefined) {
      // Beside whatever already reaches the window's right edge: the shipped
      // grid's third column was always the outermost one, and the seat draws
      // itself against that edge. At boot that is the centre, which is why this
      // is the same placement `beside: centre` would give.
      const beside = rightmost(view.docked)
      const before = new Set(view.docked.map((candidate) => candidate.id))
      // A split, not `openContent`: opening a content de-duplicates by identity
      // and would focus a pane the *user* put that content in — the picker offers
      // it, so that is a reachable state — leaving this layer to size a pane that
      // is not its column. A split always makes the column, and the content it
      // seats is the one registered for it.
      const opened = frames.split(beside?.id, options.rightbarTypeId, 'row')
      if (!opened.ok) {
        refused = true
        return
      }
      refused = false
      // Opening a frame focuses it, and the shell belongs on its content — the
      // same repair the sidebar's seeding makes.
      const afterOpen = frames.project()
      const openedCentre = paneFor(afterOpen.docked, options.conversationTypeId)
      if (openedCentre !== undefined) frames.focus(openedCentre.id)
      // The pane that was not there a moment ago is the column, and this is the
      // only place that decides so.
      pane = afterOpen.docked.find((candidate) => !before.has(candidate.id))
      if (pane === undefined) return
      columnPane = pane.id
      lastAsked = undefined
    }

    // While the column is open at this viewport its frame is the width, so
    // nothing here re-asserts it: a drag, or a sibling giving room, is not undone
    // on the next change. A viewport that changed is different — then the
    // remembered width is solved again against it.
    const wanted = resizedViewport || lastAsked === undefined
      ? rightbarOwner(viewport, sidebarWidth(view, viewport), preference).width
      : lastAsked
    if (navigation !== undefined && navRestore === undefined) {
      // Taken once per column, not per change: it is what the navigation column
      // had before this column started taking room, so it must not be read back
      // after the concession it is meant to undo.
      navRestore = { id: navigation.id, width: widthOf(navigation, viewport) }
    }
    const measured = widthOf(pane, viewport)
    if (Math.abs(measured - wanted) > 1) {
      const asked = wanted / viewport
      frames.resizePane(pane.id, asked)
      // Ask in window fractions, measure what came back, and correct once: the
      // pane's parent split is not necessarily the window (see `columnShare`).
      // Measured through the pane this layer opened, not through the type: the
      // picker offers the content, so a pane showing it may be the user's.
      const landed = widthOf(columnOf(frames.project().docked), viewport)
      if (landed > 0 && Math.abs(landed - wanted) > 1) {
        const corrected = columnOf(frames.project().docked)
        if (corrected !== undefined) frames.resizePane(corrected.id, columnShare(wanted, landed, asked))
      }
    }
    lastAsked = widthOf(columnOf(frames.project().docked), viewport)
  }

  const reconcile = (): void => {
    // The service notifies synchronously, so this reconciles re-entrantly from
    // its own writes; one pass is the whole of the work.
    if (reconciling) return
    reconciling = true
    try {
      settle()
      publish()
    } finally {
      reconciling = false
    }
  }

  const off = frames.subscribe(() => {
    if (reconciling) return
    reconcile()
  })

  const column: RightColumn = {
    show(wantsTrack: boolean): void {
      shown = true
      track = wantsTrack
      reconcile()
    },
    dismiss(): void {
      shown = false
      reconcile()
    },
    reconcile,
    getSnapshot: (): RightColumnSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose(): void {
      off()
      listeners = new Set()
    },
  }

  // The seat is mounted before any of this is reported, so the published value
  // has to be right from the first read rather than from the first change.
  reconcile()
  return column
}
