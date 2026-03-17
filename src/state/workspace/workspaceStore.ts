import { create } from 'zustand';
import type { WorkspacePath } from '../../app/router';

interface WorkspaceState {
  activePath: WorkspacePath;
  activeSectionByPath: Partial<Record<WorkspacePath, string>>;
  lastVisitedAtByPath: Partial<Record<WorkspacePath, number>>;
  setActivePath: (path: WorkspacePath) => void;
  setActiveSection: (path: WorkspacePath, section: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activePath: '/market',
  activeSectionByPath: {},
  lastVisitedAtByPath: {},
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
}));
