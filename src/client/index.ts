/**
 * The compatibility layer's plugin body.
 *
 * `ui-layout` cannot be edited, so this stands in for it: it provides
 * `ctx.layout`, supplies the `usePanelInfo` standard prop, presents the theme to
 * the document, and registers one frame body that declares `main` as its child.
 *
 * The last part is the bridge. A registration may declare child slots, so
 * declaring `main` here makes `ui-conversation`'s existing
 * `slots.inject('main', …)` fire and its panel render inside a frame — with no
 * edit to `ui-conversation`.
 */
import { createLayoutFacade } from './facade.ts'
import { LegacyRightbar, LegacySidebar } from './columns-body.ts'
import { SIDEBAR_DEFAULT } from './columns.ts'
import { createPanels } from './panels.ts'
import type { Panels } from './panels.ts'
import { ThemePresenter } from './theme-presenter.ts'

/** Services this plugin needs before it activates. */
export const inject = ['slots', 'theme', 'locale', 'frames']

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
      openContent(contentId: string, options?: { place?: string; beside?: string }): { ok: boolean }
      close(paneId: string): { ok: boolean }
      focus(paneId: string): { ok: boolean }
      resizePane(paneId: string, fraction: number): { ok: boolean }
      activeTypeId(): string | undefined
      isOpen(typeId: string): boolean
      hasType(typeId: string): boolean
      registerType(definition: { id: string; title: () => string; policy?: { grows?: boolean } }): void
      registerContent(content: { id: string; kind: string; title: string }): { ok: boolean }
      subscribe(listener: () => void): () => void
      project(): {
        readonly viewport: { readonly width: number; readonly height: number } | undefined
        readonly docked: readonly {
          readonly id: string
          readonly rect: { readonly width: number }
          readonly tabs: readonly { readonly typeId: string }[]
        }[]
      }
    }
    frames.registerType({ id: CONVERSATION_TYPE, title: () => 'Conversation' })
    // The navigation column stays put. Closing the frame beside it widens what is
    // left; without this the rail would take a proportional share of the freed
    // space and the centre would not get all of it.
    frames.registerType({ id: SIDEBAR_TYPE, title: () => 'Navigation', policy: { grows: false } })
    frames.registerType({ id: RIGHTBAR_TYPE, title: () => 'Right panel' })
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

    const facade = createLayoutFacade(frames, {
      conversationTypeId: CONVERSATION_TYPE,
      sidebarTypeId: SIDEBAR_TYPE,
      rightbarTypeId: RIGHTBAR_TYPE,
      panels,
    })

    const dropPanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: panels } })
    const dropService = ctx.reflect.provide('layout', facade)

    // The sidebar goes up with the shell. `ui-sidebar` cannot put its own column
    // there — it renders into a seat, and a seat needs a frame to be drawn in —
    // so whoever owns the column types owns the opening. This is that: the
    // composition, which is the only layer that knows these three types exist.
    //
    // The right column is deliberately *not* opened here. Whether it is shown is
    // its occupant's recorded business, and it says so through `ctx.layout`; the
    // shipped shell opened onto no right column either.
    //
    // The core default is still one frame. A profile that mounts no compatibility
    // layer gets exactly that, which is what "one frame with nothing configured"
    // has always meant.
    const seedColumns = (): void => {
      const centre = frames.project().docked
        .find((pane) => pane.tabs.some((tab) => tab.typeId === CONVERSATION_TYPE))
      const brought = frames.openContent(SIDEBAR_TYPE, { place: 'left' })
      if (!brought.ok) return
      const view = frames.project()
      if (view.viewport === undefined) return
      const column = view.docked.find((pane) => pane.tabs.some((tab) => tab.typeId === SIDEBAR_TYPE))
      if (column !== undefined) frames.resizePane(column.id, SIDEBAR_DEFAULT / view.viewport.width)
      // Opening a frame focuses it, which would leave the caret on the navigation
      // column at boot. The shell opens onto its content, so focus goes back.
      if (centre !== undefined) frames.focus(centre.id)
    }

    // Seeding needs the renderer's measurements, and the two plugins mount in an
    // order this one does not control — so it tries, and keeps trying until the
    // frame is measured, rather than assuming the renderer got there first.
    let seeded = false
    const trySeed = (): void => {
      if (seeded) return
      const before = frames.project().docked.length
      seedColumns()
      if (frames.project().docked.length > before) seeded = true
    }
    trySeed()
    const offSeed = frames.subscribe(trySeed)
    // Three bodies, three seats. Each frame declares the seat it draws into and
    // nothing else — declaration is exclusive render authority, so two entries
    // naming `sidebar` would be two claimants for one seat.
    const dropBridge = ctx.slots.inject('frames.body', () => ctx.slots.register({
      name: 'frames.body',
      key: CONVERSATION_TYPE,
      children: {
        main: { kind: 'keyed', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      // The selection reaches the bridge the way a seat hands its occupant extra
      // props, rather than through the frame's own geometry.
      inject: (): BridgeInjected => ({ panels }),
    }, LegacyConversation))
    // The bridge needs the selection, which the seat supplies as an owner prop:
    // it is this layer's state, not the frame's.
    const dropSidebar = ctx.slots.inject('frames.body', () => ctx.slots.register({
      name: 'frames.body',
      key: SIDEBAR_TYPE,
      children: { sidebar: { kind: 'single', scope: 'root' } },
    }, LegacySidebar))
    const dropRightbar = ctx.slots.inject('frames.body', () => ctx.slots.register({
      name: 'frames.body',
      key: RIGHTBAR_TYPE,
      children: { rightbar: { kind: 'single', scope: 'root' } },
    }, LegacyRightbar))

    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const offTheme = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })

    return () => {
      offTheme()
      offSeed()
      presenter.dispose()
      dropBridge()
      offPanels()
      dropSidebar()
      dropRightbar()
      // provide()'s disposer settles asynchronously; teardown is fire-and-forget.
      void dropService()
      dropPanelInfo()
    }
  }, 'frames-ui-compat: layout, panel info, theme, and the conversation bridge')
}
