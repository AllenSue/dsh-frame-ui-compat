/**
 * The compatibility layer's plugin body.
 *
 * `ui-layout` cannot be edited, so this stands in for it: it provides
 * `ctx.layout`, supplies the `usePanelInfo` standard prop, presents the theme to
 * the document, and registers the frame bodies that declare the legacy seats.
 *
 * The last part is the bridge. A registration may declare child slots, so
 * declaring `main` here makes `ui-conversation`'s existing
 * `slots.inject('main', …)` fire and its panel render inside a frame — with no
 * edit to `ui-conversation`.
 */
import { createLayoutFacade } from './facade.ts'
import { readColumnPrefs, writeColumnPrefs } from './column-prefs.ts'
import type { ColumnStorage } from './column-prefs.ts'
import { LegacyRightColumnPane, LegacySidebar } from './columns-body.ts'
import {
  navWidth, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT,
} from './columns.ts'
import { LegacyOverlay } from './overlay-body.ts'
import type { LegacyOverlayInjected } from './overlay-body.ts'
import { createPanels } from './panels.ts'
import type { Panels } from './panels.ts'
import { createRightColumn } from './rightbar.ts'
import { ThemePresenter } from './theme-presenter.ts'

/** Services this plugin needs before it activates. */
export const inject = ['slots', 'theme', 'locale', 'frames']

/**
 * The browser medium, when there is one.
 *
 * The same guard the renderer's preset port uses: a non-browser boot of this
 * bundle has no `localStorage`, and a shell that cannot remember its column
 * widths is not a shell that fails to start.
 * @returns the storage, or `undefined` when there is none.
 */
function columnStorage(): ColumnStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage as ColumnStorage
  } catch {
    // Reaching `localStorage` can throw outright when a document is sandboxed
    // without `allow-same-origin`.
    return undefined
  }
}

/** The frame types the bridge supplies, and the legacy keys they answer to. */
const CONVERSATION_TYPE = 'legacy.conversation'
const CONVERSATION_KEY = 'conversation'
const SIDEBAR_TYPE = 'legacy.sidebar'
const RIGHTBAR_TYPE = 'legacy.rightbar'

/** Props a registration adds to its component, alongside the seat's own. */
interface BridgeInjected {
  panels: Panels
}

/** Props the bridge's component receives: the selection and the child renderer. */
interface BridgeProps extends BridgeInjected {
  renderSlot(key: 'main', owner: object, options: { entryKey: string }): unknown
}

/**
 * The frame body that carries the centre.
 *
 * `main` is a keyed seat, so which panel shows is a key: the reserved
 * conversation key, or whatever the sidebar selected. Choosing it *here*, inside
 * one frame, is what lets any plugin register a panel and be selectable without
 * the frame core ever hearing about panels — and it is why this layer keeps the
 * selection rather than asking the core for it.
 * @param props - the selection and the child renderer for `main`.
 * @returns the selected panel.
 */
function LegacyConversation({ panels, renderSlot }: BridgeProps): unknown {
  return renderSlot('main', {}, { entryKey: panels.entryKey() })
}

/**
 * Register the compatibility layer.
 * @param ctx - the client context.
 */
export function apply(ctx: {
  effect(callback: () => () => void, label: string): unknown
  inject: unknown
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(options: unknown, component: unknown): unknown
    provideRoot(face: unknown): () => void
    /** The entries registered into a seat, each with the options it registered. */
    entries(key: string): readonly { readonly options: unknown }[]
    /** Called when a seat's entries change. */
    subscribe(key: string, listener: () => void): () => void
  }
  theme: { getTheme(): Parameters<ThemePresenter['apply']>[0] }
  on(event: 'theme/change', listener: (snapshot: Parameters<ThemePresenter['apply']>[0]) => void): () => void
  reflect: { provide(name: string, value: unknown): () => void }
  /** Read a service another plugin published; `frames` arrives this way. */
  get(name: string): unknown
}): void {
  ctx.effect(() => {
    const frames = ctx.get('frames') as {
      open(typeId: string): { ok: boolean }
      split(paneId: string | undefined, seed: string, axis: string): { ok: boolean }
      openContent(contentId: string, options?: { place?: string; beside?: string }): { ok: boolean }
      close(paneId: string): { ok: boolean }
      focus(paneId: string): { ok: boolean }
      resizePane(paneId: string, fraction: number): { ok: boolean }
      activeTypeId(): string | undefined
      isOpen(typeId: string): boolean
      hasType(typeId: string): boolean
      registerType(definition: {
        id: string
        title: () => string
        policy?: { grows?: boolean; closable?: boolean; placeable?: boolean; splittable?: boolean }
      }): void
      registerContent(content: { id: string; kind: string; title: string }): { ok: boolean }
      subscribe(listener: () => void): () => void
      project(): {
        readonly viewport: { readonly width: number; readonly height: number } | undefined
        readonly docked: readonly {
          readonly id: string
          readonly rect: { readonly x: number; readonly width: number }
          readonly content: { readonly typeId: string } | undefined
        }[]
      }
    }
    frames.registerType({ id: CONVERSATION_TYPE, title: () => 'Conversation' })
    // The navigation column has a fixed width and cannot be split.
    //
    // `grows: false` is the whole of "fixed": the column neither absorbs room a
    // departing sibling frees nor concedes room when a sibling asks for some, so
    // it stays 280px (or 56px collapsed) while the right column opens and closes
    // — which is what the shipped grid did, squeezing only the centre. `splittable:
    // false` refuses a split whose reference frame is the rail: half a rail is not
    // a thing, and the shell has one navigation column.
    //
    // It used to refuse the close gesture as well, and that was wrong twice over.
    // A policy is a property of the *type*, so it refused every frame displaying
    // a navigation panel — including one the user made from the picker, which
    // then could not be closed at all. And its reason ("nothing can bring this
    // column back") stopped being true once this layer's seeding became a
    // reconciliation: standing the column up again is exactly what the code below
    // does, which is the same arrangement the right column already has.
    frames.registerType({
      id: SIDEBAR_TYPE,
      title: () => 'Navigation',
      policy: { grows: false, splittable: false },
    })
    // The right column is closable, and has to be: closing its frame is exactly
    // what "hidden" means here. A close that arrives from anywhere else is
    // repaired by the column's next reconciliation, because whether the panel is
    // shown is its occupant's decision and not a frame manager's.
    //
    // It is also not placeable, which is the one thing about this column the core
    // has to know. Its panel is mounted on the overlay layer and drawn by this
    // layer at whatever width the column has — the frame only reserves that width
    // and draws an empty box. So a frame of the user's own displaying this content
    // could not show anything: the picker would be offering an empty box. The
    // sidebar stays placeable, because its own body does draw its seat.
    frames.registerType({ id: RIGHTBAR_TYPE, title: () => 'Right panel', policy: { placeable: false } })
    // A column has to be able to exist with no frame showing it — the sidebar is
    // closed by shrinking to the rail, and the right panel is closed by its
    // occupant deciding so. Registering the contents up front is what lets either
    // come back without being recreated.
    frames.registerContent({ id: SIDEBAR_TYPE, kind: SIDEBAR_TYPE, title: 'Navigation' })
    frames.registerContent({ id: RIGHTBAR_TYPE, kind: RIGHTBAR_TYPE, title: 'Right panel' })

    // Which panel the centre shows is this layer's own state, over the `main`
    // seat. It is deliberately not derived from the frame tree: to the core the
    // centre is one frame of one type.
    //
    // The selection's snapshot keeps its identity between changes, because
    // `useSyncExternalStore` compares by reference and a freshly built object on
    // every read would re-render forever.
    const panels = createPanels({
      keys: () => ctx.slots.entries('main').flatMap((entry) => {
        const key = (entry.options as { key?: unknown }).key
        return typeof key === 'string' ? [key] : []
      }),
      subscribe: (listener) => ctx.slots.subscribe('main', listener),
    }, CONVERSATION_KEY)
    // A panel whose plugin went away must not leave the centre drawing nothing.
    const offPanels = ctx.slots.subscribe('main', () => { panels.sync() })

    // The pane this layer stands the navigation column up in. Kept because "which
    // pane shows a navigation panel" and "which pane is the navigation column" are
    // different questions: the picker offers the content, so a user can put a
    // navigation panel in a frame of their own, and that frame is none of this
    // layer's business — the same distinction the right column learned first.
    let navPane: string | undefined

    // The right column is two things, and `./rightbar.ts` owns both: a seat that
    // outlives every frame, and the frame that reserves its width while the
    // occupant reports that it is shown. It is handed the navigation column's
    // pane for the same reason: the rail's width is room taken out of the window,
    // and the room was taken from *that* frame.
    /**
     * What the shell remembers about its two columns.
     *
     * Read at mount and written on every decision, so a width the user chose
     * survives a reload. The shipped shell kept these in its client store, and
     * that is why its right column rarely opened at the 45% first-open default:
     * the preference stayed. Without this, every reload gives a fresh 45% of
     * whatever the window happens to be — which reads as "the columns are too
     * wide" rather than as "the preference was forgotten".
     */
    const prefs: {
      sidebar: number
      collapsed: boolean
      narrowExpanded: boolean
      rightbar: number | undefined
    } = {
      ...readColumnPrefs(columnStorage(), {
        sidebar: SIDEBAR_DEFAULT,
        collapsed: false,
        narrowExpanded: false,
        rightbar: undefined,
      }),
    }
    const remember = (): void => { writeColumnPrefs(columnStorage(), prefs) }

    /** How wide the navigation column should be, in px, for this viewport. */
    const railWidth = (viewport: number): number =>
      navWidth(viewport, prefs.sidebar, prefs.collapsed, prefs.narrowExpanded)

    /** A pane's width in whole pixels. */
    const pxOf = (pane: { readonly rect: { readonly width: number } }, viewport: number): number =>
      Math.round(pane.rect.width * viewport)

    const column = createRightColumn(frames, {
      rightbarTypeId: RIGHTBAR_TYPE,
      sidebarTypeId: SIDEBAR_TYPE,
      conversationTypeId: CONVERSATION_TYPE,
      navPane: () => navPane,
      // Where the width it opens at comes from, and where a width the user
      // dragged it to goes.
      initialPreference: prefs.rightbar,
      remember: (width) => { prefs.rightbar = width; remember() },
    })

    const facade = createLayoutFacade({
      sidebarTypeId: SIDEBAR_TYPE,
      panels,
      column,
      // The width rules — the auto-collapse breakpoint and the narrow-frame
      // decision — live with the rest of the column geometry, so the toggle is
      // resolved here rather than in the facade.
      toggleSidebar: () => {
        const width = frames.project().viewport?.width
        if (width === undefined) return
        if (width < SIDEBAR_AUTO_COLLAPSE) prefs.narrowExpanded = !prefs.narrowExpanded
        else prefs.collapsed = !prefs.collapsed
        remember()
        reconcileNavigation()
      },
    })

    const dropPanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: panels } })
    const dropService = ctx.reflect.provide('layout', facade)

    // The sidebar goes up with the shell. `ui-sidebar` cannot put its own column
    // there — it renders into a seat, and a seat needs a frame to be drawn in —
    // so whoever owns the column types owns the opening. This is that: the
    // composition, which is the only layer that knows these three types exist.
    //
    // The right column is *not* opened here, and no longer needs to be. Its seat
    // is mounted with this plugin (below), so the occupant reports its own
    // presentation from boot: it says "hidden" until someone expands it, and the
    // column appears, resizes itself and goes away again on those reports. The
    // shipped shell opened onto no right column either.
    //
    // The core default is still one frame. A profile that mounts no compatibility
    // layer gets exactly that, which is what "one frame with nothing configured"
    // has always meant.
    /**
     * Stand the navigation column up when the shell has none, and keep it the
     * width the user last left it at.
     *
     * A reconciliation rather than a one-shot seeding, because the column is now
     * closable: `C-x C-d` on it is accepted (the close gesture is the user's, and
     * a frame they can see must not refuse it) and this is what puts the column
     * back. It asks for the column only when **nothing anywhere** is displaying
     * the navigation content, which keeps the promise the shell makes — the
     * navigation panel is always on screen in some frame — without standing a
     * second copy of it beside the one a user made.
     *
     * The width is applied on every pass, and that is what makes it a *width*
     * rather than a share: the tree stores a fraction of the viewport, so a rail
     * sized once from a 1000px window comes back 538px wide in a 1920px one.
     * Re-asking for the remembered pixels is also what makes the narrow-frame
     * rule stick (below `SIDEBAR_AUTO_COLLAPSE` the column is the 56px rail
     * unless the user expanded it there), and it is why a preset's share for this
     * one column does not survive a load: the width is a preference, the
     * arrangement is the layout.
     * @returns nothing; the tree is changed through the service.
     */
    const reconcileNavigation = (): void => {
      const view = frames.project()
      const viewport = view.viewport?.width
      if (viewport === undefined) return
      const standing = navPane === undefined ? undefined : view.docked.find((pane) => pane.id === navPane)
      if (standing !== undefined) {
        const wanted = railWidth(viewport)
        if (Math.abs(pxOf(standing, viewport) - wanted) > 1) frames.resizePane(standing.id, wanted / viewport)
        return
      }
      navPane = undefined
      if (view.docked.some((pane) => pane.content?.typeId === SIDEBAR_TYPE)) return
      // The shell opens onto its content, so the frame the column goes beside is
      // the centre rather than whatever is focused.
      const centre = view.docked.find((pane) => pane.content?.typeId === CONVERSATION_TYPE)
      const before = new Set(view.docked.map((pane) => pane.id))
      // Not measured yet — the renderer may not have reported, or a preset may be
      // mid-load. The next change tries again.
      if (!frames.openContent(SIDEBAR_TYPE, { place: 'left' }).ok) return
      const after = frames.project()
      const width = after.viewport?.width
      const rail = after.docked.find((pane) => !before.has(pane.id))
      if (rail === undefined || width === undefined) return
      navPane = rail.id
      frames.resizePane(rail.id, railWidth(width) / width)
      // Opening a frame focuses it, which would leave the caret on the navigation
      // column. The shell opens onto its content, so focus goes back.
      if (centre !== undefined) frames.focus(centre.id)
    }

    // The column is reconciled against the tree, so a close that got through is
    // repaired by the change that carried it — the same way the right column
    // treats a close it did not ask for.
    reconcileNavigation()
    const offNavigation = frames.subscribe(reconcileNavigation)
    // The right column's seat is hosted on the overlay seat rather than in a
    // frame's body, and that is the whole fix for a column that never appeared:
    // a seat mounted by a body exists only while that frame does, and the frame
    // is opened *because* the occupant reported it was shown — so the occupant
    // could never make the first report. `frames.overlay` is drawn whether or not
    // any frame exists, so the panel, its store and its reporting stay alive
    // while nothing displays it, and the frame is left with one job: reserving
    // the width.
    //
    // `shell.overlay` is declared on the same entry for the same reason and in
    // the same place the shipped frame had it: the shell's own overlays do not
    // belong to any frame either. `order: -1` keeps the entry under the other
    // overlay entries, which is where the shipped stacking put the right column
    // (below the shell's overlays, so a dialog still covers it).
    //
    // `id` is not decoration: this is a list seat, and the runtime refuses a list
    // entry without one — `list slot "frames.overlay" requires options.id`.
    const dropColumn = ctx.slots.inject('frames.overlay', () => ctx.slots.register({
      name: 'frames.overlay',
      id: 'legacy-overlay',
      order: -1,
      children: {
        rightbar: { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      inject: (): LegacyOverlayInjected => ({ column }),
    }, LegacyOverlay))
    // Three frame bodies. Two of them declare the seat they draw into; the right
    // column's declares nothing, because its seat belongs to the overlay entry
    // above. Declaration is exclusive render authority, so two entries naming
    // `sidebar` would be two claimants for one seat.
    const dropBridge = ctx.slots.inject('frames.body', () => ctx.slots.register({
      name: 'frames.body',
      key: CONVERSATION_TYPE,
      children: { main: { kind: 'keyed', scope: 'root' } },
      // The selection reaches the bridge the way a seat hands its occupant extra
      // props, rather than through the frame's own geometry.
      inject: (): BridgeInjected => ({ panels }),
    }, LegacyConversation))
    const dropSidebar = ctx.slots.inject('frames.body', () => ctx.slots.register({
      name: 'frames.body',
      key: SIDEBAR_TYPE,
      children: { sidebar: { kind: 'single', scope: 'root' } },
    }, LegacySidebar))
    // The right column's frame reserves the width and draws nothing: the panel
    // belongs to the seat above, which is mounted for as long as the content is
    // rather than for as long as this frame is.
    const dropRightbar = ctx.slots.inject('frames.body', () => ctx.slots.register({
      name: 'frames.body',
      key: RIGHTBAR_TYPE,
    }, LegacyRightColumnPane))

    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const offTheme = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })

    return () => {
      offTheme()
      offNavigation()
      presenter.dispose()
      dropBridge()
      offPanels()
      dropSidebar()
      dropRightbar()
      dropColumn()
      column.dispose()
      // provide()'s disposer settles asynchronously; teardown is fire-and-forget.
      void dropService()
      dropPanelInfo()
    }
  }, 'frames-ui-compat: layout, panel info, theme, and the conversation bridge')
}
