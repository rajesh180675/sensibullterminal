import { create } from 'zustand';
import type { SymbolCode } from '../../types/index';

interface SelectionState {
  linkedSymbol: SymbolCode;
  stagedSourceId: string | null;
  setLinkedSymbol: (symbol: SymbolCode) => void;
  setStagedSourceId: (id: string | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  linkedSymbol: 'NIFTY',
  stagedSourceId: null,
  setLinkedSymbol: (symbol) => set({ linkedSymbol: symbol }),
  setStagedSourceId: (stagedSourceId) => set({ stagedSourceId }),
}));
