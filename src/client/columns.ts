/**
 * The column geometry `ui-layout` used, restated.
 *
 * These are numbers, not types, so `import type` cannot reach them and a runtime
 * import would drag in a package that is deliberately not mounted — `ui-layout`
 * is disabled in this composition and its bundle pulls React in at module scope.
 * So they are copied, and the copying is the thing to be careful about.
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
