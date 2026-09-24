/**
 * The two column widths, remembered.
 *
 * The shipped shell kept these in its client store (`stores.ts`: `sidebar: SIDEBAR_DEFAULT`,
 * `rightbar: null`, `narrowExpanded: false`), and that is why its right column
 * rarely opened at the 45% first-open default: the user had dragged it once and
 * the preference stayed. Without somewhere to keep them, every reload gives a
 * fresh 45% — which reads as "the columns are too wide" rather than as "the
 * preference was forgotten".
 *
 * Kept in `localStorage`, the client's established medium here (the preset port
 * uses it, `@deepseek-ai/dsh-client-store` uses it, `ui-conversation` uses it).
 * This layer is the one that owns the geometry, so it owns the preference; the
 * interface is injected so a test needs no browser.
 */

/** The storage this file writes through; `window.localStorage` satisfies it. */
export interface ColumnStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Entry holding both widths and the narrow-frame decision. */
export const COLUMNS_KEY = 'dsh.frames.columns'

/** What the shell remembers about its columns. */
export interface ColumnPrefs {
  /** The navigation column's width in px, as the user left it. */
  readonly sidebar: number
  /** Whether the navigation column is collapsed. */
  readonly collapsed: boolean
  /**
   * Whether the user expanded it while the frame was narrow.
   *
   * A separate flag rather than a width, because it is a different statement: a
   * narrow frame collapses the column *unless* the user said otherwise, and that
   * answer has to survive a reload the way the shipped `narrowExpanded` did.
   */
  readonly narrowExpanded: boolean
  /** The right column's width in px, or `undefined` before it was ever dragged. */
  readonly rightbar: number | undefined
}

/** The shape a stored record has to have to be used; anything else is ignored. */
function parse(raw: string): Partial<ColumnPrefs> {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return {}
    const record = value as Record<string, unknown>
    const number = (key: string): number | undefined =>
      typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] as number : undefined
    const flag = (key: string): boolean | undefined =>
      typeof record[key] === 'boolean' ? record[key] as boolean : undefined
    return {
      sidebar: number('sidebar'),
      rightbar: number('rightbar'),
      collapsed: flag('collapsed'),
      narrowExpanded: flag('narrowExpanded'),
    }
  } catch {
    // One bad byte costs a preference, not the shell: the columns open at their
    // defaults instead of the composition failing to mount.
    return {}
  }
}

/**
 * Read what the shell remembers, filling in the shipped defaults.
 *
 * Every field is optional on disk and every one has a default, so a record
 * written by an older build (or a truncated one) still loads.
 * @param storage - the medium, or `undefined` when there is none.
 * @param defaults - the values to use for anything absent.
 * @returns the preferences to start the columns from.
 */
export function readColumnPrefs(
  storage: ColumnStorage | undefined,
  defaults: ColumnPrefs,
): ColumnPrefs {
  const raw = storage?.getItem(COLUMNS_KEY)
  const stored = raw === null || raw === undefined ? {} : parse(raw)
  return {
    sidebar: stored.sidebar ?? defaults.sidebar,
    collapsed: stored.collapsed ?? defaults.collapsed,
    narrowExpanded: stored.narrowExpanded ?? defaults.narrowExpanded,
    rightbar: stored.rightbar ?? defaults.rightbar,
  }
}

/**
 * Remember the columns as they stand.
 * @param storage - the medium, or `undefined` when there is none.
 * @param prefs - the widths and decisions to keep.
 */
export function writeColumnPrefs(storage: ColumnStorage | undefined, prefs: ColumnPrefs): void {
  try {
    storage?.setItem(COLUMNS_KEY, JSON.stringify(prefs))
  } catch {
    // A medium that refuses to write is not a reason for a resize to throw.
  }
}
