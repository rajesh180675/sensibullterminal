import { create } from 'zustand';
import { DEFAULT_SPOT_PRICES } from '../../config/market';
import type { SymbolCode } from '../../types/index';

interface SpotPriceState {
  prices: Record<SymbolCode, number>;
  dayOpens: Partial<Record<SymbolCode, number>>;
  lastUpdated: Partial<Record<SymbolCode, number>>;
  setSpot: (symbol: SymbolCode, price: number) => boolean;
  setDayOpen: (symbol: SymbolCode, price: number) => void;
  getSpot: (symbol: SymbolCode) => number;
}

export const useSpotPriceStore = create<SpotPriceState>((set, get) => ({
  prices: { ...DEFAULT_SPOT_PRICES },
  dayOpens: {},
  lastUpdated: {},
  setSpot: (symbol, price) => {
    const current = get().prices[symbol];
    if (current > 0 && Math.abs(price - current) / current > 0.15) {
      return false;
    }
    set((state) => ({
      prices: { ...state.prices, [symbol]: price },
      lastUpdated: { ...state.lastUpdated, [symbol]: Date.now() },
    }));
    return true;
  },
  setDayOpen: (symbol, price) => set((state) => ({
    dayOpens: { ...state.dayOpens, [symbol]: price },
  })),
  getSpot: (symbol) => get().prices[symbol] ?? DEFAULT_SPOT_PRICES[symbol],
}));
