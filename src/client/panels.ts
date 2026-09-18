/**
 * Which panel the centre frame is showing.
 *
 * `ui-layout` kept this in its own store and the frame read it: `main` is a keyed
 * seat, so the frame draws whichever entry the selected key names. This is that
 * selection, over the same seat, and it belongs here rather than in the frame
 * core — to the core the centre is one frame of one type, and what is inside it
 * is the compatibility layer's business.
 *
 * Keeping it here is also what makes an unknown plugin work: a plugin that
 * registers a `main` entry is selectable the moment it does, whether or not
 * anyone knew about it when this layer was written.
 */

/** The one panel-keyed field `usePanelInfo` publishes. */
export interface PanelInfo {
  /** Selected global panel; `null` displays the conversation. */
  readonly activePanelId: string | null
}

/**
 * The seat this selection is over.
 *
 * Narrowed to what the selection needs, so a test can drive it with a map: the
 * keys registered right now, and a subscription for when that set changes.
 */
export interface PanelSource {
  /** Keys the seat currently has registered. Entries without a key are not panels. */
  keys(): readonly string[]
  /** Called when the set of registered keys changes. */
  subscribe(listener: () => void): () => void
}

/** The centre frame's panel selection. */
export interface Panels {
  /** The published value; its reference changes only when the selection does. */
  getSnapshot(): PanelInfo
  subscribe(listener: () => void): () => void
  /**
   * Select a panel.
   * @throws when the key is not registered, leaving the selection alone — the
   *   shipped implementation's behaviour, which its consumers and its own specs
   *   both match on.
   */
  select(id: string | null): void
  /** The key the centre should draw: the selection, or the reserved one. */
  entryKey(): string
  /**
   * Re-read the seat. A selection whose plugin has gone falls back to the
   * conversation rather than leaving the centre drawing nothing.
   */
  sync(): void
}

/**
 * Build the selection over a seat.
 * @param source - the registered `main` keys and a subscription to them.
 * @param conversationKey - the reserved key that means "the conversation".
 * @returns the selection, ready to publish and to drive the frame.
 */
export function createPanels(source: PanelSource, conversationKey: string): Panels {
  let activePanelId: string | null = null
  let snapshot: PanelInfo = { activePanelId }
  const listeners = new Set<() => void>()

  const publish = (): void => {
    snapshot = { activePanelId }
    for (const listener of listeners) listener()
  }
  const registered = (id: string): boolean => source.keys().includes(id)

  return {
    getSnapshot: (): PanelInfo => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    select(id: string | null): void {
      if (id !== null && !registered(id)) {
        // The shipped message names the panel and the id; consumers match on it.
        throw new Error(`layout.selectPanel: main panel "${id}" is not registered`)
      }
      if (id === activePanelId) return
      activePanelId = id
      publish()
    },

    entryKey: (): string => activePanelId ?? conversationKey,

    sync(): void {
      if (activePanelId === null || registered(activePanelId)) return
      activePanelId = null
      publish()
    },
  }
}
