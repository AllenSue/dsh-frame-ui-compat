/**
 * The legacy overlay layer: the seats that have to be drawn whether or not any
 * frame exists.
 *
 * `ui-layout` had one such layer — the shell's overlay track, rendered by
 * `AppFrame` outside the grid — and the right column is the other thing that
 * needs one. They are the same requirement, so they are the same entry: the
 * renderer draws `frames.overlay` once, always, and this is what it puts there.
 *
 * The right column is here rather than in its own frame's body because the loop
 * would otherwise close on itself: the frame is opened *because* the occupant
 * reported that it was shown, and the occupant only reports from inside a frame
 * that is being drawn. `frames.overlay` is drawn either way, so the seat is
 * mounted from the moment this plugin is, and the frame is left with one job it
 * can still do while the panel is hidden — reserving the width. `./rightbar.ts`
 * owns the numbers that decide that; this file only draws them.
 */
import { createElement, useSyncExternalStore } from 'react'
import type { RightColumn, RightColumnSnapshot } from './rightbar.ts'

/** Props a registration adds to its component, alongside the seat's own. */
export interface LegacyOverlayInjected {
  /** The right column's numbers and the tree behind them. */
  readonly column: RightColumn
}

/**
 * The layer's entry: the right column, then whatever the shell hangs over
 * everything.
 *
 * Order matters and is deliberate. The column comes first so the shell's overlays
 * — a dialog, a toast — paint over it, which is the stacking the shipped frame
 * had (the right column below the overlays, the overlays below floating panels).
 * @param props - the right column and the child renderers.
 * @returns the layer's contents.
 */
export function LegacyOverlay({ column, renderSlot }: LegacyOverlayInjected & {
  renderSlot(key: 'rightbar', owner: object): unknown
  renderSlot(key: 'shell.overlay', owner: object): unknown
}): unknown {
  const { owner, box }: RightColumnSnapshot = useSyncExternalStore(column.subscribe, column.getSnapshot)
  return createElement('div', { style: { position: 'absolute', inset: '0' } },
    // The occupant positions itself inside this box — the shipped panel is
    // absolute at the column's right edge — so the box is the column's width, and
    // 0 while the panel is hidden. A zero-width box draws nothing and swallows no
    // clicks, which is what makes being hidden cost nothing.
    createElement('div', {
      key: 'rightbar',
      style: {
        position: 'absolute',
        top: '0',
        right: '0',
        bottom: '0',
        width: `${box}px`,
        overflow: 'hidden',
        // The layer takes no pointer events of its own; this is the part of it
        // that does, because a panel nobody can click is not a panel.
        pointerEvents: 'auto',
      },
    }, renderSlot('rightbar', owner)),
    createElement('div', { key: 'shell.overlay' }, renderSlot('shell.overlay', {})),
  )
}
