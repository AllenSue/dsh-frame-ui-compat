/**
 * The column geometry `ui-layout` used, restated.
 *
 * These are numbers, not types, so `import type` cannot reach them and a runtime
 * import would drag in a package that is deliberately not mounted — `ui-layout`
 * is disabled in this composition and its bundle pulls React in at module scope.
 * So they are copied, and the copying is the thing to be careful about. The same
 * goes for `computeColumns`, which is arithmetic over those numbers: the right
 * column has to tell its occupant how wide it would be, and that answer is the
 * shipped one rather than a new rule invented here.
 *
 * Source, verified in the third-party tree: `packages/client/ui-layout/src/client/columns.ts`.
 * Both the values and the rules they encode are that file's, and this file is
 * where a divergence would have to be recorded.
 *
 * Where our model disagrees with theirs is deliberate and written down: our
 * `minPaneSize` is 72px and the collapsed rail is 56px, so the rail is below the
 * split minimum. It is not a violation — `minPaneSize` answers "can this pane be
 * split into two usable halves", which is a different question from "how narrow
 * may a column be told to be".
 */

/** Width before any user drag, in px. */
export const SIDEBAR_DEFAULT = 280

/** Drag clamp floor, in px. */
export const SIDEBAR_MIN = 264

/** Drag clamp ceiling, in px. */
export const SIDEBAR_MAX = 420

/** The closed-sidebar rail: an icon column, in px. */
export const SIDEBAR_COLLAPSED = 56

/** Below this, the column is drawn as the rail rather than as a full column. */
export const SIDEBAR_COLLAPSED_MAX = SIDEBAR_COLLAPSED

/** Right column drag clamp floor, in px. */
export const RIGHTBAR_MIN = 300

/** First-open right panel width, as a fraction of the frame. */
export const RIGHTBAR_DEFAULT_RATIO = 0.45

/** Largest normal right panel width, as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7

/** Centre width the third column protects while it is open, in px. */
export const CENTER_MIN = 400

/** Resolved widths for one frame. */
export interface Columns {
  sidebar: number
  center: number
  rightbar: number
}

/**
 * Clamp a column width into the range the shipped shell allowed.
 * @param px - the width asked for.
 * @param min - the range floor.
 * @param max - the range ceiling.
 * @returns the clamped, whole-pixel width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Whether a column of this width should be drawn as the compact rail.
 * @param width - the column's rendered width in px.
 * @returns whether the occupant should collapse.
 */
export function isCollapsed(width: number): boolean {
  return width <= SIDEBAR_COLLAPSED_MAX
}

/**
 * Solve the three column widths for one viewport frame.
 *
 * Copied from the shipped `computeColumns` for the same reason the constants
 * above are: it is arithmetic over numbers, `import type` cannot reach it, and a
 * runtime import would drag in the disabled `ui-layout` bundle. One caller needs
 * it — the right column, whose occupant is told the width it *would* take rather
 * than the frame's current one.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param rightbar - requested right panel width in px (0 = no track).
 * @returns actual widths: the right track shrinks, then loses its track, before
 *   the centre drops below its minimum.
 */
export function computeColumns(viewport: number, sidebar: number, rightbar: number): Columns {
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const available = viewport - s - CENTER_MIN
  const r = rightbar === 0 || available < RIGHTBAR_MIN
    ? 0
    : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r }
}
