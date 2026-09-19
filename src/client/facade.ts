/**
 * The `ctx.layout` facade.
 *
 * `ui-layout` cannot be edited, so this reproduces its runtime interface over the
 * frame tree instead of migrating its consumers. `ui-workspace`, `ui-sidebar` and
 * `ui-sidebar-right` inject the service and call into it; nothing about them
 * changes.
 *
 * Three of the five calls need saying more precisely than the interface does:
 *
 * - `toggleSidebar()` toggles the sidebar between *collapsed* and *expanded*, not
 *   between present and absent. In the shipped grid the column never disappeared:
 *   it shrank to a 56px rail and the occupant drew a compact version of itself.
 *   Here that is a frame whose share changes, so the frame — and with it every
 *   seat `ui-sidebar` declares — stays mounted. That is what makes collapsing
 *   safe, and it is the whole reason the content registry exists.
 * - `openRightbar()` and `closeRightbar()` are **reports, not commands**. The
 *   occupant decides whether it is shown and tells the frame how much room to
 *   reserve; the interface says as much. So this facade takes the occupant at its
 *   word and hands the report to the right column, which owns the numbers and the
 *   frame that reserves them (`./rightbar.ts`).
 * - the sidebar's own geometry is still this file's, because its column never
 *   disappears and so its frame is always there to resize.
 *
 * The facade is pure over a frame tree and a viewport, so it is testable without
 * a browser.
 */
import {
  clampWidth, isCollapsed, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'
import type { Panels } from './panels.ts'
import type { RightColumn } from './rightbar.ts'

/** One docked frame as the facade reads it. */
export interface FacadePane {
  readonly id: string
  readonly rect: { readonly width: number }
  readonly tabs: readonly { readonly typeId: string }[]
}

/** What the facade needs from the frame tree. */
export interface LayoutFrames {
  resizePane(paneId: string, fraction: number): { ok: boolean }
  /** The projection: where the frames are, and how big the area they fill is. */
  project(): {
    readonly viewport: { readonly width: number; readonly height: number } | undefined
    readonly docked: readonly FacadePane[]
  }
}

/** How the facade addresses the tree. */
export interface LayoutFacadeOptions {
  /** The type that plays the navigation column. */
  sidebarTypeId: string
  /** Which panel the centre frame is showing. */
  panels: Panels
  /** The right column: it owns its own frame, its own width, and its own seat. */
  column: RightColumn
}

/** The panel-navigation and geometry actions `ui-layout` exposed as `ctx.layout`. */
export interface LayoutFacade {
  selectPanel(panelId: string | null): void
  beginNavigation(): AbortSignal
  toggleSidebar(): void
  openRightbar(track: boolean, fullscreen: boolean): void
  closeRightbar(): void
}

/**
 * Build the facade.
 *
 * Three behaviours are load-bearing because the shipped implementation has them
 * and its consumers may rely on them:
 *
 * - `selectPanel` with an unregistered id throws and leaves the current selection
 *   alone;
 * - any accepted selection aborts the navigation signal a caller is holding,
 *   which is how a pending navigation learns it lost;
 * - the sidebar toggle flips the *collapsed* state, so a collapse followed by an
 *   expand comes back to the width the user had chosen rather than to the default.
 * @param frames - the frame tree.
 * @param options - the type ids that play each column.
 * @returns the facade.
 */
export function createLayoutFacade(frames: LayoutFrames, options: LayoutFacadeOptions): LayoutFacade {
  let navigation: AbortController | undefined

  const beginNavigation = (): AbortSignal => {
    navigation?.abort()
    navigation = new AbortController()
    return navigation.signal
  }

  const selectPanel = (panelId: string | null): void => {
    // The selection is this layer's, not the tree's: to the core the centre is
    // one frame of one type, and which panel is inside it is nobody's business
    // but ours. Throws before the navigation signal is touched, so a rejected
    // selection leaves a pending navigation alone.
    options.panels.select(panelId)
    beginNavigation()
  }

  /** The frame showing a type, and how many pixels wide it is. */
  const column = (typeId: string): { id: string; width: number } | undefined => {
    const view = frames.project()
    if (view.viewport === undefined) return undefined
    const pane = view.docked.find((candidate) => candidate.tabs.some((tab) => tab.typeId === typeId))
    return pane === undefined ? undefined : { id: pane.id, width: pane.rect.width * view.viewport.width }
  }

  /** The width the sidebar was last left at, so expanding restores the choice. */
  let sidebarPreference = SIDEBAR_DEFAULT

  const toggleSidebar = (): void => {
    const view = frames.project()
    const sidebar = column(options.sidebarTypeId)
    if (view.viewport === undefined || sidebar === undefined) return

    if (!isCollapsed(sidebar.width)) sidebarPreference = sidebar.width
    const wanted = isCollapsed(sidebar.width)
      ? clampWidth(sidebarPreference, SIDEBAR_MIN, SIDEBAR_MAX)
      : SIDEBAR_COLLAPSED
    // The core is told a share of the parent split; the caller is the only side
    // that knows the viewport, so it does the division.
    frames.resizePane(sidebar.id, wanted / view.viewport.width)
  }

  const openRightbar = (track: boolean, _fullscreen: boolean): void => {
    // A report, not a command: the occupant says it is displayed, and whether it
    // wants a column reserved for it. `fullscreen` needs nothing from this layer
    // — a panel that covers the viewport presents itself that way, which is the
    // same division the shipped grid had (`track ? pref : 0` for the track).
    options.column.show(track)
  }

  const closeRightbar = (): void => {
    // Also a report: the occupant says it is hidden. The column goes away and
    // the content stays.
    options.column.dismiss()
  }

  return { selectPanel, beginNavigation, toggleSidebar, openRightbar, closeRightbar }
}
