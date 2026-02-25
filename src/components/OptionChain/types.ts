// components/OptionChain/types.ts

import type { OptionRow, OptionLeg, ExpiryDate, SymbolCode } from '../../types/index';

// ════════════════════════════════════════════════════════════════
// § COMPONENT PROPS
// ════════════════════════════════════════════════════════════════

export interface OptionChainProps {
  symbol: SymbolCode;
  data: OptionRow[];
  spotPrice: number;
  selectedExpiry: ExpiryDate;
  onExpiryChange: (e: ExpiryDate) => void;
  onAddLeg: (leg: Omit<OptionLeg, 'id'>) => void;
  highlightedStrikes: Set<number>;
  lastUpdate: Date;
  isLoading: boolean;
  onRefresh: () => void;
  isLive?: boolean;
  loadingMsg?: string;
  error?: string | null;
  strikeRange?: number;
  // FIX-5: live expiries from backend so Toolbar shows correct options
  availableExpiries?: ExpiryDate[];
}

// ════════════════════════════════════════════════════════════════
// § FLASH SYSTEM
// ════════════════════════════════════════════════════════════════

export type FlashDir = 'up' | 'down';

export interface FlashEntry {
  direction: FlashDir;
  timestamp: number;
}

// ════════════════════════════════════════════════════════════════
// § CHAIN STATISTICS
// ════════════════════════════════════════════════════════════════

export interface ChainStats {
  maxOI: number;
  totalCeOI: number;
  totalPeOI: number;
  pcr: string;
  pcrNumeric: number;
  maxPain: number;
  atmRow: OptionRow | undefined;
  maxCeOIStrike: number;
  maxPeOIStrike: number;
  totalCeVolume: number;
  totalPeVolume: number;
  atmStraddlePremium: number;
  expectedMovePercent: number;
}

// ════════════════════════════════════════════════════════════════
// § SORTING
// ════════════════════════════════════════════════════════════════

export type SortableColumn =
  | 'ce_oi' | 'ce_oiChg' | 'ce_volume' | 'ce_iv' | 'ce_ltp'
  | 'pe_ltp' | 'pe_iv' | 'pe_volume' | 'pe_oiChg' | 'pe_oi'
  | 'strike'
  | null;

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  column: SortableColumn;
  direction: SortDirection;
}

// ════════════════════════════════════════════════════════════════
// § OI INTERPRETATION
// ════════════════════════════════════════════════════════════════

export type OISignal =
  | 'long_buildup'
  | 'short_buildup'
  | 'short_covering'
  | 'long_unwinding'
  | 'neutral';

export interface OISignalConfig {
  label: string;
  abbr: string;
  color: string;
  bgColor: string;
}

// ════════════════════════════════════════════════════════════════
// § PREFERENCES
// ════════════════════════════════════════════════════════════════

export interface ChainPreferences {
  showGreeks: boolean;
  showOIBars: boolean;
  strikeRange: number;
  showOISignals: boolean;
}

// ════════════════════════════════════════════════════════════════
// § UI
// ════════════════════════════════════════════════════════════════

export interface StatItem {
  label: string;
  value: string;
  cls: string;
  title?: string;
}

export type CellFormatter = (value: number) => string;

// Re-export domain types used by consumers
export type { OptionRow, OptionLeg, ExpiryDate, SymbolCode };
