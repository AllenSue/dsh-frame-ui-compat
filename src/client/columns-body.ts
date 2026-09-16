/**
 * The column frames: the two legacy seats that are columns rather than a centre.
 *
 * `ui-layout` drew a three-track grid — sidebar, centre, rightbar — and handed
 * each column's occupant a share of the geometry it had solved. There is no grid
 * here: each column is a frame, its area is the frame's area, and the width the
 * occupant is told is that area measured against the viewport.
 *
 * That conversion is this file's whole job, and it has to be exact in both
 * directions — a body is told how many pixels wide it is, and when the column is
 * asked for a width the core is told the share of the parent that comes to.
 */
import type { RightbarOwnerProps, SidebarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FrameBodyProps } from '../../../frames/src/index.ts'
import { isCollapsed, RIGHTBAR_MIN } from './columns.ts'

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
 * The right column.
 *
 * Unlike the sidebar this one is not always there: whether it is shown is the
 * occupant's own recorded business, which it reports back through `ctx.layout`.
 * So the body reports what the frame has room for and lets the occupant decide,
 * exactly as the shipped grid did. The one difference is that here "not shown"
 * can mean the frame is not in the tree at all.
 * @param props - the frame's area, the viewport, and the child renderer.
 * @returns the rightbar seat, or nothing when no plugin has taken it.
 */
export function LegacyRightbar({ renderSlot, rect, viewport }: ColumnBodyProps): unknown {
  const width = rect.width * viewport.width
  const owner: RightbarOwnerProps = {
    width,
    viewportWidth: viewport.width,
    canShow: width >= RIGHTBAR_MIN,
  }
  return renderSlot('rightbar', owner)
}
