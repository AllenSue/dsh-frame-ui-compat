/**
 * The `ctx.layout` facade.
 *
 * `ui-layout` cannot be edited, so this reproduces its runtime interface over the
 * frame tree instead of migrating its consumers. `ui-workspace` and `ui-sidebar`
 * inject the service and call into it; nothing about them changes.
 *
 * The facade is pure over a frame tree, so it is testable without a browser.
 */

/** What the facade needs from the frame tree. */
export interface LayoutFrames {
  open(typeId: string): { ok: boolean }
  activeTypeId(): string | undefined
  isOpen(typeId: string): boolean
}

/** How the facade addresses the tree. */
export interface LayoutFacadeOptions {
  /** The type that plays the shell's centre: what "no panel selected" means. */
  conversationTypeId: string
  /** Whether a frame type is registered; the plugin owns the registry. */
  isRegistered(typeId: string): boolean
}

/** The panel-navigation and geometry actions `ui-layout` exposed as `ctx.layout`. */
export interface LayoutFacade {
  selectPanel(panelId: string | null): void
  beginNavigation(): AbortSignal
  toggleSidebar(): void
  openRightbar(track: boolean, fullscreen: boolean): void
  closeRightbar(): void
}

/**
 * Build the facade.
 *
 * Two behaviours are load-bearing because the shipped implementation has them and
 * its consumers may rely on either:
 *
 * - `selectPanel` with an unregistered id throws and leaves the current selection
 *   alone, and
 * - any accepted selection aborts the navigation signal a caller is holding,
 *   which is how a pending navigation learns it lost.
 * @param frames - the frame tree.
 * @param options - the conversation's type id and the registry probe.
 * @returns the facade.
 */
export function createLayoutFacade(frames: LayoutFrames, options: LayoutFacadeOptions): LayoutFacade {
  let navigation: AbortController | undefined

  const beginNavigation = (): AbortSignal => {
    navigation?.abort()
    navigation = new AbortController()
    return navigation.signal
  }

  const selectPanel = (panelId: string | null): void => {
    if (panelId === null) {
      frames.open(options.conversationTypeId)
      beginNavigation()
      return
    }
    if (!options.isRegistered(panelId)) {
      // The shipped message names the panel and the id; consumers and the
      // package's own specs both match on it.
      throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
    }
    frames.open(panelId)
    beginNavigation()
  }

  // The left and right columns are not frames yet, so the three geometry actions
  // do nothing. They exist so a caller does not throw; a control that calls them
  // is either not rendered or already gone.
  return {
    selectPanel,
    beginNavigation,
    toggleSidebar: () => {},
    openRightbar: () => {},
    closeRightbar: () => {},
  }
}
