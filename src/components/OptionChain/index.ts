// components/OptionChain/index.ts

// ── Main component ─────────────────────────────────────────────
export { OptionChain } from './OptionChain';

// ── Types ──────────────────────────────────────────────────────
export type {
  OptionChainProps,
  ChainStats,
  FlashDir,
  FlashEntry,
  StatItem,
  SortState,
  SortableColumn,
  SortDirection,
  OISignal,
  OISignalConfig,
  ChainPreferences,
  CellFormatter,
} from './types';

// ── Hooks (for composition) ────────────────────────────────────
export { useChainStats } from './hooks/useChainStats';
export { useFlashCells } from './hooks/useFlashCells';
export { useFilteredData } from './hooks/useFilteredData';
export { useScrollToATM } from './hooks/useScrollToATM';
export { useRefreshThrottle } from './hooks/useRefreshThrottle';
export { useColumnSort } from './hooks/useColumnSort';
export { useStalenessTimer } from './hooks/useStalenessTimer';
export { useChainPreferences } from './hooks/useChainPreferences';

// ── Utilities ──────────────────────────────────────────────────
export { exportToCSV } from './utils/exportToCSV';
export { formatCell } from './utils/formatCell';
export { getRowValue } from './utils/getRowValue';
export { computeMaxPain } from './utils/computeMaxPain';
export { deriveOISignal, hasOISignalData } from './utils/deriveOISignal';

// ── Constants ──────────────────────────────────────────────────
export {
  FLASH_DURATION_MS,
  REFRESH_COOLDOWN_MS,
  STALE_THRESHOLD_SEC,
  LABELS,
  TOOLTIPS,
  FORMATTERS,
  OI_SIGNAL_CONFIG,
} from './constants';
