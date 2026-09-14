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
import { ThemePresenter } from './theme-presenter.ts'

/** Services this plugin needs before it activates. */
export const inject = ['slots', 'theme', 'locale', 'frames']

/** The frame type the bridge supplies, and the legacy key it answers to. */
const CONVERSATION_TYPE = 'legacy.conversation'
const CONVERSATION_KEY = 'conversation'

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
}): void {
  ctx.effect(() => {
    const frames = ctx.get('frames') as {
      open(typeId: string): { ok: boolean }
      activeTypeId(): string | undefined
      isOpen(typeId: string): boolean
      registerType(definition: { id: string; title: () => string }): void
      subscribe(listener: () => void): () => void
    }

    frames.registerType({ id: CONVERSATION_TYPE, title: () => 'Conversation' })

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
      isRegistered: (typeId) => typeId === CONVERSATION_TYPE,
    })

    const dropPanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo } })
    const dropService = ctx.reflect.provide('layout', facade)
    const dropBridge = ctx.slots.inject('frames.body', () => ctx.slots.register({
      name: 'frames.body',
      key: CONVERSATION_TYPE,
      children: {
        main: { kind: 'keyed', scope: 'root' },
        sidebar: { kind: 'single', scope: 'root' },
        rightbar: { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    }, LegacyConversation))

    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const offTheme = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })

    return () => {
      offTheme()
      presenter.dispose()
      dropBridge()
      // provide()'s disposer settles asynchronously; teardown is fire-and-forget.
      void dropService()
      dropPanelInfo()
      offFrames()
    }
  }, 'frames-ui-compat: layout, panel info, theme, and the conversation bridge')
}
