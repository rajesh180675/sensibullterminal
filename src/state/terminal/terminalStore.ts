import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspacePath } from '../../app/router';
import type { SymbolCode } from '../../types/index';

export type KeyboardMode = 'normal' | 'chain' | 'ticket' | 'command';
export interface PersistedTerminalWorkspaceState {
  activePath: WorkspacePath;
  activeSectionByPath: Partial<Record<WorkspacePath, string>>;
  linkedSymbol: SymbolCode;
  stagedSourceId: string | null;
}

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
  hydrateWorkspaceState: (state: Partial<PersistedTerminalWorkspaceState>) => void;
  snapshotWorkspaceState: () => PersistedTerminalWorkspaceState;
}

export const useTerminalStore = create<TerminalStoreState>()(
  persist(
    (set, get) => ({
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
      hydrateWorkspaceState: (payload) => set((state) => ({
        activePath: payload.activePath ?? state.activePath,
        activeSectionByPath: payload.activeSectionByPath && typeof payload.activeSectionByPath === 'object'
          ? payload.activeSectionByPath
          : state.activeSectionByPath,
        linkedSymbol: payload.linkedSymbol ?? state.linkedSymbol,
        stagedSourceId: payload.stagedSourceId ?? state.stagedSourceId,
      })),
      snapshotWorkspaceState: (): PersistedTerminalWorkspaceState => {
        const state = get();
        return {
          activePath: state.activePath,
          activeSectionByPath: state.activeSectionByPath,
          linkedSymbol: state.linkedSymbol,
          stagedSourceId: state.stagedSourceId,
        };
      },
    }),
    {
      name: 'terminal-state',
      partialize: (state) => state.snapshotWorkspaceState(),
    },
  ),
);
