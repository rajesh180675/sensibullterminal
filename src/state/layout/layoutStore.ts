import { create } from 'zustand';

interface LayoutState {
  bottomDockOpen: boolean;
  bottomDockHeight: number;
  rightDrawerOpen: boolean;
  setBottomDockOpen: (open: boolean) => void;
  setBottomDockHeight: (height: number) => void;
  setRightDrawerOpen: (open: boolean) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  bottomDockOpen: true,
  bottomDockHeight: 188,
  rightDrawerOpen: false,
  setBottomDockOpen: (open) => set({ bottomDockOpen: open }),
  setBottomDockHeight: (height) => set({ bottomDockHeight: Math.max(140, Math.min(height, 320)) }),
  setRightDrawerOpen: (open) => set({ rightDrawerOpen: open }),
}));
