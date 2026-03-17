import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspacePath } from '../../app/router';
import type { SymbolCode } from '../../types/index';

export type KeyboardMode = 'normal' | 'chain' | 'ticket' | 'command';

interface TerminalStoreState {
  activePath: WorkspacePath;
  activeSectionByPath: Partial<Record<WorkspacePath, string>>;
  lastVisitedAtByPath: Partial<Record<WorkspacePath, number>>;
  linkedSymbol: SymbolCode;
  stagedSourceId: string | null;
  keyboardMode: KeyboardMode;
  commandPaletteOpen: boolean;
  setActivePath: (path: WorkspacePath) => void;
  setActiveSection: (path: WorkspacePath, section: string) => void;
  setLinkedSymbol: (symbol: SymbolCode) => void;
  setStagedSourceId: (id: string | null) => void;
  setKeyboardMode: (mode: KeyboardMode) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
}

export const useTerminalStore = create<TerminalStoreState>()(
  persist(
    (set) => ({
      activePath: '/market',
      activeSectionByPath: {},
      lastVisitedAtByPath: {},
      linkedSymbol: 'NIFTY',
      stagedSourceId: null,
      keyboardMode: 'normal',
      commandPaletteOpen: false,
      setActivePath: (path) => set((state) => ({
        activePath: path,
        lastVisitedAtByPath: {
          ...state.lastVisitedAtByPath,
          [path]: Date.now(),
        },
      })),
      setActiveSection: (path, section) => set((state) => ({
        activeSectionByPath: {
          ...state.activeSectionByPath,
          [path]: section,
        },
      })),
      setLinkedSymbol: (linkedSymbol) => set({ linkedSymbol }),
      setStagedSourceId: (stagedSourceId) => set({ stagedSourceId }),
      setKeyboardMode: (keyboardMode) => set({ keyboardMode }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({
        commandPaletteOpen,
        keyboardMode: commandPaletteOpen ? 'command' : 'normal',
      }),
      toggleCommandPalette: () => set((state) => {
        const nextOpen = !state.commandPaletteOpen;
        return {
          commandPaletteOpen: nextOpen,
          keyboardMode: nextOpen ? 'command' : 'normal',
        };
      }),
    }),
    {
      name: 'terminal-state',
      partialize: (state) => ({
        activePath: state.activePath,
        activeSectionByPath: state.activeSectionByPath,
        linkedSymbol: state.linkedSymbol,
      }),
    },
  ),
);
