import { create } from 'zustand';
import type { OptionRow, SymbolCode } from '../../types/index';
import type { StreamTransport } from '../../services/streaming/streamAuthority';
import type { WsStatus } from '../../utils/breezeWs';

interface StreamStoreState {
  wsStatus: WsStatus;
  transport: StreamTransport;
  lastStatusAt: number;
  lastTickVersion: number | null;
  chainOverlay: Record<string, OptionRow[]>;
  spotPrices: Partial<Record<SymbolCode, number>>;
  setStreamStatus: (status: WsStatus, transport: StreamTransport, at: number) => void;
  setChainOverlay: (key: string, chain: OptionRow[], version: number | null) => void;
  clearChainOverlay: (key: string) => void;
  setSpotPrice: (symbol: SymbolCode, price: number) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  wsStatus: 'disconnected' as WsStatus,
  transport: 'system' as StreamTransport,
  lastStatusAt: Date.now(),
  lastTickVersion: null as number | null,
  chainOverlay: {} as Record<string, OptionRow[]>,
  spotPrices: {} as Partial<Record<SymbolCode, number>>,
};

export const useStreamStore = create<StreamStoreState>()((set) => ({
  ...INITIAL_STATE,
  setStreamStatus: (wsStatus, transport, at) => set({
    wsStatus,
    transport,
    lastStatusAt: at,
  }),
  setChainOverlay: (key, chain, version) => set((state) => ({
    chainOverlay: {
      ...state.chainOverlay,
      [key]: chain,
    },
    lastTickVersion: version,
  })),
  clearChainOverlay: (key) => set((state) => {
    if (!state.chainOverlay[key]) return state;
    const nextOverlay = { ...state.chainOverlay };
    delete nextOverlay[key];
    return {
      chainOverlay: nextOverlay,
    };
  }),
  setSpotPrice: (symbol, price) => set((state) => ({
    spotPrices: {
      ...state.spotPrices,
      [symbol]: price,
    },
  })),
  reset: () => set(INITIAL_STATE),
}));
