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
import { ThemePresenter } from './theme-presenter.ts'

/** Services this plugin needs before it activates. */
export const inject = ['slots', 'theme', 'locale', 'frames']

/** The frame types the bridge supplies, and the legacy keys they answer to. */
const CONVERSATION_TYPE = 'legacy.conversation'
const CONVERSATION_KEY = 'conversation'
const SIDEBAR_TYPE = 'legacy.sidebar'
const RIGHTBAR_TYPE = 'legacy.rightbar'

/** The one panel-keyed field `usePanelInfo` publishes. */
interface PanelInfo {
  activePanelId: string | null
}

/** Props the bridge's component receives: the child renderer for `main`. */
interface BridgeProps {
  renderSlot(key: 'main', owner: object, options: { entryKey: string }): unknown
}

/**
 * The frame body that carries the conversation.
 *
 * It renders the legacy `main` key with the reserved `conversation` entry key,
 * which is exactly what the shipped shell did.
 * @param props - the child renderer for `main`.
 * @returns the conversation panel.
 */
function LegacyConversation({ renderSlot }: BridgeProps): unknown {
  return renderSlot('main', {}, { entryKey: CONVERSATION_KEY })
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
      resizePane(paneId: string, fraction: number): { ok: boolean }
      activeTypeId(): string | undefined
      isOpen(typeId: string): boolean
      hasType(typeId: string): boolean
      registerType(definition: { id: string; title: () => string }): void
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
    frames.registerType({ id: SIDEBAR_TYPE, title: () => 'Navigation' })
    frames.registerType({ id: RIGHTBAR_TYPE, title: () => 'Right panel' })
    // A column has to be able to exist with no frame showing it — the sidebar is
    // closed by shrinking to the rail, and the right panel is closed by its
    // occupant deciding so. Registering the contents up front is what lets either
    // come back without being recreated.
    frames.registerContent({ id: SIDEBAR_TYPE, kind: SIDEBAR_TYPE, title: 'Navigation' })
    frames.registerContent({ id: RIGHTBAR_TYPE, kind: RIGHTBAR_TYPE, title: 'Right panel' })

    // `ui-workspace` reads `activePanelId !== null` to know the centre is
    // occupied by something other than the conversation. The published snapshot
    // must keep its identity between changes: `useSyncExternalStore` compares by
    // reference, so a freshly built object on every read would re-render forever.
    const occupiedId = (): string | null => {
      const active = frames.activeTypeId()
      return active === undefined || active === CONVERSATION_TYPE ? null : active
    }
    let activePanelId = occupiedId()
    let panelSnapshot: PanelInfo = { activePanelId }
    const panelListeners = new Set<() => void>()
    const refresh = (): void => {
      const next = occupiedId()
      if (next === activePanelId) return
      activePanelId = next
      panelSnapshot = { activePanelId }
      for (const listener of panelListeners) listener()
    }
    const offFrames = frames.subscribe(refresh)
    const panelInfo = {
      getSnapshot: (): PanelInfo => panelSnapshot,
      subscribe: (listener: () => void): (() => void) => {
        panelListeners.add(listener)
        return () => { panelListeners.delete(listener) }
      },
    }

    const facade = createLayoutFacade(frames, {
      conversationTypeId: CONVERSATION_TYPE,
      sidebarTypeId: SIDEBAR_TYPE,
      rightbarTypeId: RIGHTBAR_TYPE,
    })

    const dropPanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo } })
    const dropService = ctx.reflect.provide('layout', facade)
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
    }, LegacyConversation))
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
      presenter.dispose()
      dropBridge()
      dropSidebar()
      dropRightbar()
      // provide()'s disposer settles asynchronously; teardown is fire-and-forget.
      void dropService()
      dropPanelInfo()
      offFrames()
    }
  }, 'frames-ui-compat: layout, panel info, theme, and the conversation bridge')
}
