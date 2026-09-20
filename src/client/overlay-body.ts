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
 * The hairline on the column's inner edge.
 *
 * The renderer draws one at every frame boundary, but it cannot draw *this* one:
 * the column's pixels are painted here rather than in the frame's body, and this
 * layer sits above the renderer's lines, so the line under the panel is covered —
 * which is exactly what "no boundary between the conversation and the right
 * column" looked like. The shipped shell has the same arrangement and the same
 * answer, written in its stylesheet: *the occupant draws its own left border*.
 * This is that border. It reads the same token the renderer's lines do.
 */
const BOUNDARY = 'var(--dsw-alias-border-l3, #39404c)'

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
        // The boundary between the centre and this column (see `BOUNDARY`), drawn
        // only while the column is standing: a zero-width box is what "hidden"
        // looks like, and hidden means there is no boundary here at all.
        //
        // `content-box` is load-bearing. The panel has to keep the exact width the
        // column has — that agreement is what the column's arithmetic is for — so
        // the border sits in the pixel this box takes from the centre, not in one
        // of the panel's own.
        boxSizing: 'content-box',
        borderLeft: box > 0 ? `1px solid ${BOUNDARY}` : undefined,
      },
    }, renderSlot('rightbar', owner)),
    createElement('div', { key: 'shell.overlay' }, renderSlot('shell.overlay', {})),
  )
}
