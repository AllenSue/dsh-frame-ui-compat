/**
 * The column bodies: the sidebar's seat, and the empty box the right column's
 * frame reserves.
 *
 * `ui-layout` drew a three-track grid — sidebar, centre, rightbar — and handed
 * each column's occupant a share of the geometry it had solved. There is no grid
 * here: each column is a frame, its area is the frame's area, and the width the
 * occupant is told is that area measured against the viewport.
 *
 * That conversion is this file's whole job, and it has to be exact in both
 * directions — a body is told how many pixels wide it is, and when the column is
 * asked for a width the core is told the share of the parent that comes to.
 *
 * The two columns differ in one thing, and it decides where each seat is drawn.
 * The sidebar's frame is always there, so its seat is drawn inside it. The right
 * column's frame exists only while the panel is shown, so its seat is hosted on
 * the overlay layer instead (`./overlay-body.ts`) and this frame reserves the
 * width. See `./rightbar.ts` for why that split is not optional.
 */
import { createElement } from 'react'
import type { SidebarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FrameBodyProps } from '../../../frames/src/index.ts'
import { isCollapsed } from './columns.ts'

/** What a frame body is handed: what every renderer gives, plus its own children. */
export interface ColumnBodyProps extends FrameBodyProps {
  renderSlot(key: string, owner?: object, options?: { entryKey: string }): unknown
}

/**
 * The left column.
 *
 * `ui-sidebar` is the only occupant. It reads `collapsed` to decide between the
 * full column and the compact rail, and `width` to lay itself out — so both have
 * to come from the frame the column is drawn in, which is why the renderer hands
 * a body its own rectangle.
 * @param props - the frame's area, the viewport, and the child renderer.
 * @returns the sidebar seat, or nothing when no plugin has taken it.
 */
export function LegacySidebar({ renderSlot, rect, viewport }: ColumnBodyProps): unknown {
  const width = rect.width * viewport.width
  const owner: SidebarOwnerProps = { width, collapsed: isCollapsed(width) }
  return renderSlot('sidebar', owner)
}

/**
 * The frame the right column reserves, drawn empty.
 *
 * The panel is deliberately not drawn here: it belongs to the seat on the overlay
 * layer, which is mounted for as long as the content exists rather than for as
 * long as this frame does. This body exists so the pane shows the empty room the
 * occupant positions itself in — a body that returned nothing would be replaced
 * by the renderer's title fallback, and the column would read as a labelled empty
 * box.
 * @returns the box that fills the frame.
 */
export function LegacyRightColumnPane(): unknown {
  return createElement('div', { style: { flex: '1 1 auto', minHeight: 0 } })
}
