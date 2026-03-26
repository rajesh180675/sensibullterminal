import { create } from 'zustand';

interface PersistedLayoutPanels {
  bottomDockOpen: boolean;
  bottomDockHeight: number;
  rightDrawerOpen: boolean;
}

interface LayoutState {
  bottomDockOpen: boolean;
  bottomDockHeight: number;
  rightDrawerOpen: boolean;
  setBottomDockOpen: (open: boolean) => void;
  setBottomDockHeight: (height: number) => void;
  setRightDrawerOpen: (open: boolean) => void;
  hydrate: (panels: Partial<PersistedLayoutPanels>) => void;
  snapshot: () => PersistedLayoutPanels;
}

function clampDockHeight(height: number) {
  return Math.max(140, Math.min(height, 320));
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  bottomDockOpen: true,
  bottomDockHeight: 188,
  rightDrawerOpen: false,
  setBottomDockOpen: (open) => set({ bottomDockOpen: open }),
  setBottomDockHeight: (height) => set({ bottomDockHeight: clampDockHeight(height) }),
  setRightDrawerOpen: (open) => set({ rightDrawerOpen: open }),
  hydrate: (panels) => set((state) => ({
    bottomDockOpen: typeof panels.bottomDockOpen === 'boolean' ? panels.bottomDockOpen : state.bottomDockOpen,
    bottomDockHeight: typeof panels.bottomDockHeight === 'number' ? clampDockHeight(panels.bottomDockHeight) : state.bottomDockHeight,
    rightDrawerOpen: typeof panels.rightDrawerOpen === 'boolean' ? panels.rightDrawerOpen : state.rightDrawerOpen,
  })),
  snapshot: () => {
    const state = get();
    return {
      bottomDockOpen: state.bottomDockOpen,
      bottomDockHeight: state.bottomDockHeight,
      rightDrawerOpen: state.rightDrawerOpen,
    };
  },
}));
