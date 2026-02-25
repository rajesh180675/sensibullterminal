// ================================================================
// OPTION CHAIN — Production-Grade Dense CE/PE Grid
// ================================================================
//
// Features:
//   • Memoized rows with custom areEqual (only re-render on actual change)
//   • Flash-tick detection via snapshot diffing (ce_ltp, pe_ltp, ce_oi, pe_oi)
//   • OI heatmap bars with smooth width transitions
//   • Full CSV export (BOM, escaping, revoked blob)
//   • Strike-range filtering (±10 … ±40 around ATM)
//   • Keyboard navigation (↑↓ rows, B/S buy/sell, Shift for PE)
//   • Scroll-to-ATM button + auto-scroll on symbol change
//   • Rate-limited refresh (2s cooldown)
//   • Error boundary, loading skeleton, empty state
//   • Full ARIA: grid roles, labels, live regions
//   • Support / Resistance (max PE-OI / CE-OI strike) in stats
//   • Greeks toggle (Δ Θ columns)
//   • Data staleness warning (>2 min)
//   • Responsive horizontal scroll with min-width
//
// Data contract:
//   Feed `data` from generateChain() (demo) or fetchOptionChain() (Breeze).
//   The component is display-only — all mutations flow out via
//   onAddLeg / onRefresh / onExpiryChange.
//
// Required CSS (add to global stylesheet or Tailwind @layer):
//
//   @keyframes flash-green {
//     0%   { background-color: rgba(16, 185, 129, 0.25); }
//     100% { background-color: transparent; }
//   }
//   @keyframes flash-red {
//     0%   { background-color: rgba(239, 68, 68, 0.25); }
//     100% { background-color: transparent; }
//   }
//   .flash-up { animation: flash-green 0.6s ease-out; }
//   .flash-dn { animation: flash-red   0.6s ease-out; }
//
//   @keyframes pulse-glow {
//     0%, 100% { opacity: 1; }
//     50%      { opacity: 0.4; }
//   }
//   .pulse-dot { animation: pulse-glow 2s cubic-bezier(0.4,0,0.6,1) infinite; }
//
//   .no-scroll::-webkit-scrollbar { display: none; }
//   .no-scroll { -ms-overflow-style: none; scrollbar-width: none; }
//
// ================================================================

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
  Component,
  type ReactNode,
} from 'react';

import {
  RefreshCw,
  Download,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Zap,
  AlertCircle,
  Target,
} from 'lucide-react';

import type {
  OptionRow,
  OptionLeg,
  ExpiryDate,
  SymbolCode,
} from '../types/index';

import { getExpiries, SYMBOL_CONFIG } from '../config/market';
import { fmtOI } from '../utils/math';


// ════════════════════════════════════════════════════════════════
// § 1 — TYPES & INTERFACES
// ════════════════════════════════════════════════════════════════

export interface OptionChainProps {
  /** Symbol code (e.g. 'NIFTY', 'BANKNIFTY') */
  symbol: SymbolCode;
  /** Full option chain row data */
  data: OptionRow[];
  /** Current spot / underlying price */
  spotPrice: number;
  /** Currently selected expiry date */
  selectedExpiry: ExpiryDate;
  /** Callback when user selects a different expiry */
  onExpiryChange: (e: ExpiryDate) => void;
  /** Callback when user adds a leg to the strategy builder */
  onAddLeg: (leg: Omit<OptionLeg, 'id'>) => void;
  /** Set of strike prices currently in the strategy (highlighted) */
  highlightedStrikes: Set<number>;
  /** Timestamp of the last data update */
  lastUpdate: Date;
  /** Whether data is currently being fetched */
  isLoading: boolean;
  /** Callback to trigger a data refresh */
  onRefresh: () => void;
  /** Whether connected to a live data feed */
  isLive?: boolean;
  /** Optional loading status message */
  loadingMsg?: string;
  /** If set, renders an error banner with a Retry action */
  error?: string | null;
  /** Initial strike-range filter: number of strikes above/below ATM (0 = all) */
  strikeRange?: number;
}

/** Direction of a price/OI tick flash */
type FlashDir = 'up' | 'down';

/** A single flash entry with direction and timestamp */
interface FlashEntry {
  direction: FlashDir;
  timestamp: number;
}

/** Aggregate statistics computed from the full chain */
interface ChainStats {
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
}

/** A single item in the stats strip */
interface StatItem {
  label: string;
  value: string;
  cls: string;
  title?: string;
}


// ════════════════════════════════════════════════════════════════
// § 2 — CONSTANTS
// ════════════════════════════════════════════════════════════════

/** Duration (ms) that flash animation stays visible */
const FLASH_DURATION_MS = 600;

/** Delay (ms) before auto-scrolling to ATM row after symbol change */
const SCROLL_DELAY_MS = 350;

/** Minimum time (ms) between consecutive refresh actions */
const REFRESH_COOLDOWN_MS = 2_000;

/** Default strike range filter (0 = show all strikes) */
const DEFAULT_STRIKE_RANGE = 0;

/** Threshold (seconds) after which data is considered stale */
const STALE_THRESHOLD_SEC = 120;

/** CE columns without Greeks */
const CE_BASIC = [
  'ce_oi', 'ce_oiChg', 'ce_volume', 'ce_iv', 'ce_ltp',
] as const;

/** CE columns with Greeks */
const CE_GREEKS = [
  'ce_oi', 'ce_oiChg', 'ce_volume', 'ce_iv', 'ce_delta', 'ce_theta', 'ce_ltp',
] as const;

/** PE columns without Greeks */
const PE_BASIC = [
  'pe_ltp', 'pe_iv', 'pe_volume', 'pe_oiChg', 'pe_oi',
] as const;

/** PE columns with Greeks */
const PE_GREEKS = [
  'pe_ltp', 'pe_iv', 'pe_delta', 'pe_theta', 'pe_volume', 'pe_oiChg', 'pe_oi',
] as const;

/** Human-readable column labels */
const LABELS: Readonly<Record<string, string>> = {
  ce_oi: 'OI',
  ce_oiChg: 'OI Chg',
  ce_volume: 'Vol',
  ce_iv: 'IV',
  ce_delta: 'Δ',
  ce_theta: 'Θ',
  ce_ltp: 'LTP',
  pe_ltp: 'LTP',
  pe_iv: 'IV',
  pe_delta: 'Δ',
  pe_theta: 'Θ',
  pe_volume: 'Vol',
  pe_oiChg: 'OI Chg',
  pe_oi: 'OI',
};

/** Accessible tooltips for column headers */
const TOOLTIPS: Readonly<Record<string, string>> = {
  ce_oi: 'Call Open Interest',
  ce_oiChg: 'Call OI change from previous close',
  ce_volume: 'Call traded volume',
  ce_iv: 'Call Implied Volatility',
  ce_delta: 'Call Delta',
  ce_theta: 'Call Theta (daily time-decay)',
  ce_ltp: 'Call Last Traded Price',
  pe_ltp: 'Put Last Traded Price',
  pe_iv: 'Put Implied Volatility',
  pe_delta: 'Put Delta',
  pe_theta: 'Put Theta (daily time-decay)',
  pe_volume: 'Put traded volume',
  pe_oiChg: 'Put OI change from previous close',
  pe_oi: 'Put Open Interest',
};

/** Strike range filter options for the dropdown */
const STRIKE_RANGE_OPTIONS = [
  { value: 0, label: 'All' },
  { value: 10, label: '±10' },
  { value: 15, label: '±15' },
  { value: 20, label: '±20' },
  { value: 25, label: '±25' },
  { value: 40, label: '±40' },
] as const;

/** Fields tracked for flash-tick detection */
const TRACKED_FIELDS: ReadonlyArray<[string, (r: OptionRow) => number]> = [
  ['ce_ltp', (r) => r.ce_ltp],
  ['pe_ltp', (r) => r.pe_ltp],
  ['ce_oi', (r) => r.ce_oi],
  ['pe_oi', (r) => r.pe_oi],
];

/** Flash field keys used in memo areEqual comparison */
const FLASH_FIELD_KEYS = ['ce_ltp', 'pe_ltp', 'ce_oi', 'pe_oi'] as const;


// ════════════════════════════════════════════════════════════════
// § 3 — UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Safely read a numeric property from an OptionRow by string key.
 * Returns 0 for missing, undefined, NaN, or Infinity values.
 */
function getRowValue(row: OptionRow, col: string): number {
  const v = (row as unknown as Record<string, unknown>)[col];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Format a numeric value according to the column's semantics.
 * Returns '—' for non-finite values (NaN, Infinity, etc).
 */
function formatCell(key: string, value: number): string {
  if (!Number.isFinite(value)) return '—';

  // OI (but not OI Change, not IV)
  if (key.endsWith('_oi') && !key.includes('iv') && !key.includes('Chg')) {
    return fmtOI(Math.abs(value));
  }
  // OI Change — show sign prefix
  if (key.includes('oiChg')) {
    return (value >= 0 ? '+' : '') + fmtOI(value);
  }
  // LTP, Bid, Ask — 2 decimals
  if (key.includes('_ltp') || key.includes('bid') || key.includes('ask')) {
    return value.toFixed(2);
  }
  // IV — 1 decimal + percent
  if (key.includes('_iv')) {
    return value.toFixed(1) + '%';
  }
  // Delta — 3 decimals
  if (key.includes('delta')) {
    return value.toFixed(3);
  }
  // Theta — 2 decimals
  if (key.includes('theta')) {
    return value.toFixed(2);
  }
  // Volume — compact notation
  if (key.includes('volume')) {
    return fmtOI(value);
  }

  return String(value);
}

/**
 * Build & trigger a CSV download for the full option chain.
 * Includes a UTF-8 BOM for Excel compatibility, proper field escaping,
 * metadata comment row, and automatic blob cleanup.
 */
function exportToCSV(
  data: ReadonlyArray<OptionRow>,
  symbol: string,
  expiry: string,
  spotPrice: number,
): void {
  if (data.length === 0) return;

  const headers = [
    'CE_OI', 'CE_OI_Chg', 'CE_Volume', 'CE_IV', 'CE_Delta', 'CE_Theta',
    'CE_Gamma', 'CE_Vega', 'CE_LTP',
    'Strike', 'Is_ATM',
    'PE_LTP', 'PE_IV', 'PE_Delta', 'PE_Theta',
    'PE_Gamma', 'PE_Vega', 'PE_Volume', 'PE_OI_Chg', 'PE_OI',
  ];

  const escapeField = (v: unknown): string => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const rows = data.map((r) =>
    [
      r.ce_oi, r.ce_oiChg, r.ce_volume, r.ce_iv, r.ce_delta, r.ce_theta,
      r.ce_gamma, r.ce_vega, r.ce_ltp,
      r.strike, r.isATM ? 'Y' : '',
      r.pe_ltp, r.pe_iv, r.pe_delta, r.pe_theta,
      r.pe_gamma, r.pe_vega, r.pe_volume, r.pe_oiChg, r.pe_oi,
    ]
      .map(escapeField)
      .join(','),
  );

  const meta = [
    `# ${symbol} Option Chain`,
    `Expiry: ${expiry}`,
    `Spot: ${spotPrice}`,
    `Exported: ${new Date().toISOString()}`,
  ].join(' | ');

  const csv = [meta, headers.join(','), ...rows].join('\n');

  // BOM prefix for proper Excel UTF-8 detection
  const blob = new Blob(['\uFEFF' + csv], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${symbol}_chain_${expiry.replace(/\s+/g, '_')}_${Date.now()}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  // Clean up after browser picks up the download
  requestAnimationFrame(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  });
}


// ════════════════════════════════════════════════════════════════
// § 4 — CUSTOM HOOKS
// ════════════════════════════════════════════════════════════════

/**
 * useFlashCells
 *
 * Snapshot-diffs ce_ltp / pe_ltp / ce_oi / pe_oi between successive
 * data arrays and produces flash directives keyed by `${field}_${strike}`.
 * Automatically clears the map after FLASH_DURATION_MS.
 *
 * Memory safety:
 *   - Timer tracked in ref with unconditional unmount cleanup
 *   - Previous data shallow-cloned to prevent mutation bleed
 */
function useFlashCells(
  data: ReadonlyArray<OptionRow>,
): ReadonlyMap<string, FlashEntry> {
  const [flashed, setFlashed] = useState<Map<string, FlashEntry>>(
    () => new Map(),
  );
  const prevRef = useRef<Map<number, OptionRow>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const next = new Map<string, FlashEntry>();
    const prev = prevRef.current;

    for (const row of data) {
      const p = prev.get(row.strike);
      if (!p) continue;

      for (const [field, accessor] of TRACKED_FIELDS) {
        const cur = accessor(row);
        const old = accessor(p);

        if (
          cur !== old &&
          Number.isFinite(cur) &&
          Number.isFinite(old)
        ) {
          next.set(`${field}_${row.strike}`, {
            direction: cur > old ? 'up' : 'down',
            timestamp: now,
          });
        }
      }
    }

    // Always update snapshot — shallow-clone each row
    prevRef.current = new Map(
      data.map((r) => [r.strike, { ...r }]),
    );

    if (next.size > 0) {
      setFlashed(next);

      // Clear any previously scheduled clear
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        setFlashed(new Map());
        timerRef.current = null;
      }, FLASH_DURATION_MS);
    }
  }, [data]);

  // Unconditional unmount cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      prevRef.current.clear();
    };
  }, []);

  return flashed;
}

/**
 * useChainStats
 *
 * Single-pass derivation of every aggregate stat the chain UI needs.
 * Returns a stable reference as long as data / spotPrice / symbol
 * haven't changed (via useMemo).
 */
function useChainStats(
  data: ReadonlyArray<OptionRow>,
  spotPrice: number,
  symbol: SymbolCode,
): ChainStats {
  return useMemo(() => {
    const cfg = SYMBOL_CONFIG[symbol];

    const empty: ChainStats = {
      maxOI: 1,
      totalCeOI: 0,
      totalPeOI: 0,
      pcr: 'N/A',
      pcrNumeric: 0,
      maxPain: 0,
      atmRow: undefined,
      maxCeOIStrike: 0,
      maxPeOIStrike: 0,
      totalCeVolume: 0,
      totalPeVolume: 0,
    };

    if (!cfg || data.length === 0) return empty;

    let maxOI = 1;
    let totalCeOI = 0;
    let totalPeOI = 0;
    let totalCeVol = 0;
    let totalPeVol = 0;
    let peakCeOI = 0;
    let peakPeOI = 0;
    let maxCeOIStrike = 0;
    let maxPeOIStrike = 0;
    let atmRow: OptionRow | undefined;

    for (const row of data) {
      totalCeOI += row.ce_oi;
      totalPeOI += row.pe_oi;
      totalCeVol += row.ce_volume;
      totalPeVol += row.pe_volume;

      if (row.ce_oi > peakCeOI) {
        peakCeOI = row.ce_oi;
        maxCeOIStrike = row.strike;
      }
      if (row.pe_oi > peakPeOI) {
        peakPeOI = row.pe_oi;
        maxPeOIStrike = row.strike;
      }

      const localMax = Math.max(row.ce_oi, row.pe_oi);
      if (localMax > maxOI) maxOI = localMax;

      if (row.isATM) atmRow = row;
    }

    const pcrNum = totalCeOI > 0 ? totalPeOI / totalCeOI : 0;
    const step = cfg.strikeStep || 1;

    return {
      maxOI,
      totalCeOI,
      totalPeOI,
      pcr: totalCeOI > 0 ? pcrNum.toFixed(2) : 'N/A',
      pcrNumeric: pcrNum,
      maxPain: Math.round(spotPrice / step) * step,
      atmRow,
      maxCeOIStrike,
      maxPeOIStrike,
      totalCeVolume: totalCeVol,
      totalPeVolume: totalPeVol,
    };
  }, [data, spotPrice, symbol]);
}

/**
 * useFilteredData
 *
 * Filters rows to ±N strikes around ATM.
 * Returns all rows (by reference) when range ≤ 0.
 */
function useFilteredData(
  data: ReadonlyArray<OptionRow>,
  range: number,
  spotPrice: number,
  symbol: SymbolCode,
): OptionRow[] {
  return useMemo(() => {
    if (range <= 0 || data.length === 0) {
      return data as OptionRow[];
    }

    const cfg = SYMBOL_CONFIG[symbol];
    if (!cfg) return data as OptionRow[];

    const step = cfg.strikeStep || 1;
    const atm = Math.round(spotPrice / step) * step;
    const half = range * step;

    return data.filter(
      (r) => r.strike >= atm - half && r.strike <= atm + half,
    );
  }, [data, range, spotPrice, symbol]);
}

/**
 * useScrollToATM
 *
 * Scrolls the ATM row into view via DOM query after a short delay.
 * Re-fires when the symbol changes. Returns a manual scroll function.
 */
function useScrollToATM(
  symbol: SymbolCode,
  containerRef: React.RefObject<HTMLDivElement | null>,
): () => void {
  const scrollNow = useCallback(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      'tr[data-atm="true"]',
    );
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [containerRef]);

  useEffect(() => {
    const timer = setTimeout(scrollNow, SCROLL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [symbol, scrollNow]);

  return scrollNow;
}

/**
 * useRefreshThrottle
 *
 * Returns [canRefresh, startCooldown].
 * After each call to startCooldown(), canRefresh is false
 * for REFRESH_COOLDOWN_MS milliseconds.
 */
function useRefreshThrottle(
  isLoading: boolean,
): [boolean, () => void] {
  const [cooling, setCooling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    setCooling(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCooling(false);
      timer.current = null;
    }, REFRESH_COOLDOWN_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return [!isLoading && !cooling, start];
}


// ════════════════════════════════════════════════════════════════
// § 5 — MEMOIZED SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════

// ── Separator ──────────────────────────────────────────────────

const Sep = memo(function Sep() {
  return (
    <div
      className="h-3 w-px bg-gray-800 mx-0.5 shrink-0"
      aria-hidden="true"
    />
  );
});
Sep.displayName = 'Sep';

// ── OI Heatmap Bar ─────────────────────────────────────────────

interface OIBarProps {
  value: number;
  max: number;
  side: 'ce' | 'pe';
}

const OIBar = memo<OIBarProps>(function OIBar({ value, max, side }) {
  const pct = Math.min(
    100,
    (Math.abs(value) / Math.max(max, 1)) * 100,
  );

  // Don't render bars below 0.5% — not visually meaningful
  if (pct < 0.5) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      <div
        className={`
          absolute inset-y-0 opacity-[0.12]
          transition-[width] duration-300 ease-out
          ${side === 'ce' ? 'right-0 bg-blue-400' : 'left-0 bg-orange-400'}
        `}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});
OIBar.displayName = 'OIBar';

// ── Action Buttons (Buy / Sell) ────────────────────────────────

interface ActionButtonsProps {
  visible: boolean;
  onBuy: () => void;
  onSell: () => void;
  side: 'CE' | 'PE';
  strike: number;
}

const ActionButtons = memo<ActionButtonsProps>(
  function ActionButtons({ visible, onBuy, onSell, side, strike }) {
    return (
      <td className="px-1 py-[2px] text-center" role="gridcell">
        <div
          className={`
            flex gap-0.5 justify-center transition-opacity duration-150
            ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}
          `}
        >
          <button
            onClick={onBuy}
            aria-label={`Buy ${side} ${strike}`}
            tabIndex={visible ? 0 : -1}
            className="
              px-1.5 py-0.5
              bg-emerald-600/20 hover:bg-emerald-500/40
              text-emerald-400 text-[8px]
              rounded font-bold
              border border-emerald-600/25
              leading-none
              focus-visible:outline focus-visible:outline-2
              focus-visible:outline-emerald-400
            "
          >
            B
          </button>
          <button
            onClick={onSell}
            aria-label={`Sell ${side} ${strike}`}
            tabIndex={visible ? 0 : -1}
            className="
              px-1.5 py-0.5
              bg-red-600/20 hover:bg-red-500/40
              text-red-400 text-[8px]
              rounded font-bold
              border border-red-600/25
              leading-none
              focus-visible:outline focus-visible:outline-2
              focus-visible:outline-red-400
            "
          >
            S
          </button>
        </div>
      </td>
    );
  },
);
ActionButtons.displayName = 'ActionButtons';

// ── Data Cell ──────────────────────────────────────────────────

interface DataCellProps {
  col: string;
  value: number;
  flash: FlashEntry | undefined;
  showOIBars: boolean;
  maxOI: number;
  side: 'ce' | 'pe';
  align: 'text-right' | 'text-left';
}

const DataCell = memo<DataCellProps>(function DataCell({
  col,
  value,
  flash,
  showOIBars,
  maxOI,
  side,
  align,
}) {
  const isLTP = col.endsWith('_ltp');
  const isChg = col.includes('oiChg');
  const isOI =
    col.endsWith('_oi') &&
    !col.includes('Chg') &&
    !col.includes('iv');

  // Flash animation CSS class
  const flashCls = flash
    ? flash.direction === 'up'
      ? 'flash-up'
      : 'flash-dn'
    : '';

  // Value color styling
  const valCls = isLTP
    ? `font-bold ${
        side === 'ce' ? 'text-blue-300' : 'text-orange-300'
      } text-[11px]`
    : isChg
      ? value >= 0
        ? 'text-emerald-400'
        : 'text-red-400'
      : 'text-gray-500';

  return (
    <td
      className={`py-[3px] px-2 ${align} relative ${flashCls}`}
      role="gridcell"
      aria-label={`${TOOLTIPS[col] ?? col}: ${formatCell(col, value)}`}
    >
      {/* OI heatmap bar (behind the text) */}
      {isOI && showOIBars && (
        <OIBar value={value} max={maxOI} side={side} />
      )}

      {/* Formatted value */}
      <span className={`relative z-10 mono ${valCls}`}>
        {/* Directional arrow on LTP flash */}
        {isLTP && flash && (
          flash.direction === 'up' ? (
            <TrendingUp
              size={7}
              className="inline mr-0.5 text-emerald-400"
              aria-hidden="true"
            />
          ) : (
            <TrendingDown
              size={7}
              className="inline mr-0.5 text-red-400"
              aria-hidden="true"
            />
          )
        )}
        {formatCell(col, value)}
      </span>
    </td>
  );
});
DataCell.displayName = 'DataCell';

// ── Strike Cell ────────────────────────────────────────────────

interface StrikeCellProps {
  strike: number;
  isATM: boolean;
  isHighlighted: boolean;
  isMaxCeOI: boolean;
  isMaxPeOI: boolean;
}

const StrikeCell = memo<StrikeCellProps>(function StrikeCell({
  strike,
  isATM,
  isHighlighted,
  isMaxCeOI,
  isMaxPeOI,
}) {
  return (
    <td
      className={`
        py-[3px] px-2 text-center font-bold text-[11px]
        bg-[#080b12]/30 border-x border-gray-800/20
        ${isATM ? 'text-yellow-400' : 'text-gray-300'}
      `}
      role="rowheader"
      aria-label={[
        `Strike ${strike}`,
        isATM && 'at the money',
        isHighlighted && 'in strategy',
        isMaxCeOI && 'max CE open interest (resistance)',
        isMaxPeOI && 'max PE open interest (support)',
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <div className="flex flex-col items-center leading-tight">
        {/* ATM badge */}
        {isATM && (
          <span
            className="
              text-[7px] bg-yellow-500/12 text-yellow-500
              px-1 rounded border border-yellow-500/20
              mb-0.5 select-none
            "
          >
            ATM
          </span>
        )}

        {/* Strike price */}
        <span className="mono">
          {strike.toLocaleString('en-IN')}
        </span>

        {/* Indicator badges */}
        <div className="flex items-center gap-0.5 mt-0.5 empty:hidden">
          {isHighlighted && (
            <Zap
              size={7}
              className="text-blue-400"
              aria-label="In strategy"
            />
          )}
          {isMaxCeOI && (
            <span
              className="
                text-[6px] text-blue-400 bg-blue-400/10
                px-0.5 rounded
              "
              title="Highest CE OI — resistance"
            >
              R
            </span>
          )}
          {isMaxPeOI && (
            <span
              className="
                text-[6px] text-orange-400 bg-orange-400/10
                px-0.5 rounded
              "
              title="Highest PE OI — support"
            >
              S
            </span>
          )}
        </div>
      </div>
    </td>
  );
});
StrikeCell.displayName = 'StrikeCell';

// ── Chain Row ──────────────────────────────────────────────────

interface ChainRowProps {
  row: OptionRow;
  ceCols: readonly string[];
  peCols: readonly string[];
  isATM: boolean;
  isHighlighted: boolean;
  isMaxCeOI: boolean;
  isMaxPeOI: boolean;
  showOIBars: boolean;
  maxOI: number;
  flashed: ReadonlyMap<string, FlashEntry>;
  onAddLeg: (
    strike: number,
    type: 'CE' | 'PE',
    action: 'BUY' | 'SELL',
  ) => void;
  rowIndex: number;
  focusedStrike: number | null;
  onFocusStrike: (s: number | null) => void;
}

const ChainRow = memo<ChainRowProps>(
  function ChainRow({
    row,
    ceCols,
    peCols,
    isATM,
    isHighlighted,
    isMaxCeOI,
    isMaxPeOI,
    showOIBars,
    maxOI,
    flashed,
    onAddLeg,
    rowIndex,
    focusedStrike,
    onFocusStrike,
  }) {
    const isHovered = focusedStrike === row.strike;

    // Keyboard shortcuts: B/S for CE, Shift+B/S for PE
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTableRowElement>) => {
        const key = e.key.toLowerCase();
        if (key !== 'b' && key !== 's') return;

        e.preventDefault();
        e.stopPropagation();

        const type: 'CE' | 'PE' = e.shiftKey ? 'PE' : 'CE';
        const action: 'BUY' | 'SELL' = key === 'b' ? 'BUY' : 'SELL';
        onAddLeg(row.strike, type, action);
      },
      [onAddLeg, row.strike],
    );

    // Row background color based on state
    const bgClass = isATM
      ? 'bg-yellow-400/[0.035] border-yellow-700/20'
      : isHighlighted
        ? 'bg-blue-500/[0.055] border-blue-700/20'
        : isHovered
          ? 'bg-gray-700/[0.12] border-gray-700/20'
          : 'border-gray-800/20';

    return (
      <tr
        className={`
          border-b transition-colors duration-75 ${bgClass}
          focus-visible:outline focus-visible:outline-1
          focus-visible:outline-blue-500/50
          focus-visible:-outline-offset-1
        `}
        onMouseEnter={() => onFocusStrike(row.strike)}
        onMouseLeave={() => onFocusStrike(null)}
        onFocus={() => onFocusStrike(row.strike)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="row"
        aria-rowindex={rowIndex + 1}
        aria-selected={isHighlighted}
        data-strike={row.strike}
        data-atm={isATM || undefined}
        data-testid={`chain-row-${row.strike}`}
      >
        {/* CE action buttons */}
        <ActionButtons
          visible={isHovered}
          onBuy={() => onAddLeg(row.strike, 'CE', 'BUY')}
          onSell={() => onAddLeg(row.strike, 'CE', 'SELL')}
          side="CE"
          strike={row.strike}
        />

        {/* CE data columns */}
        {ceCols.map((col) => (
          <DataCell
            key={col}
            col={col}
            value={getRowValue(row, col)}
            flash={flashed.get(`${col}_${row.strike}`)}
            showOIBars={showOIBars}
            maxOI={maxOI}
            side="ce"
            align="text-right"
          />
        ))}

        {/* Strike column */}
        <StrikeCell
          strike={row.strike}
          isATM={isATM}
          isHighlighted={isHighlighted}
          isMaxCeOI={isMaxCeOI}
          isMaxPeOI={isMaxPeOI}
        />

        {/* PE data columns */}
        {peCols.map((col) => (
          <DataCell
            key={col}
            col={col}
            value={getRowValue(row, col)}
            flash={flashed.get(`${col}_${row.strike}`)}
            showOIBars={showOIBars}
            maxOI={maxOI}
            side="pe"
            align="text-left"
          />
        ))}

        {/* PE action buttons */}
        <ActionButtons
          visible={isHovered}
          onBuy={() => onAddLeg(row.strike, 'PE', 'BUY')}
          onSell={() => onAddLeg(row.strike, 'PE', 'SELL')}
          side="PE"
          strike={row.strike}
        />
      </tr>
    );
  },

  // ── Custom areEqual ──────────────────────────────────────
  // Only re-render if something meaningful to THIS row changed
  (prev, next) => {
    // Data reference changed (new tick data)
    if (prev.row !== next.row) return false;

    // Row metadata changed
    if (prev.isATM !== next.isATM) return false;
    if (prev.isHighlighted !== next.isHighlighted) return false;
    if (prev.isMaxCeOI !== next.isMaxCeOI) return false;
    if (prev.isMaxPeOI !== next.isMaxPeOI) return false;

    // Display settings changed
    if (prev.showOIBars !== next.showOIBars) return false;
    if (prev.maxOI !== next.maxOI) return false;
    if (prev.ceCols !== next.ceCols) return false;
    if (prev.peCols !== next.peCols) return false;

    // Hover state toggled for THIS row
    const wasHovered = prev.focusedStrike === prev.row.strike;
    const nowHovered = next.focusedStrike === next.row.strike;
    if (wasHovered !== nowHovered) return false;

    // Flash state changed for THIS row
    const strike = prev.row.strike;
    const hadFlash = FLASH_FIELD_KEYS.some((k) =>
      prev.flashed.has(`${k}_${strike}`),
    );
    const hasFlash = FLASH_FIELD_KEYS.some((k) =>
      next.flashed.has(`${k}_${strike}`),
    );
    if (hadFlash !== hasFlash) return false;

    // Nothing meaningful changed — skip re-render
    return true;
  },
);
ChainRow.displayName = 'ChainRow';

// ── Table Header ───────────────────────────────────────────────

interface ChainHeaderProps {
  ceCols: readonly string[];
  peCols: readonly string[];
}

const ChainHeader = memo<ChainHeaderProps>(function ChainHeader({
  ceCols,
  peCols,
}) {
  return (
    <thead className="sticky top-0 z-20">
      {/* Group headers: CALLS | STRIKE | PUTS */}
      <tr>
        <th
          colSpan={ceCols.length + 1}
          scope="colgroup"
          className="
            py-1 text-center bg-blue-950/60
            border-b border-blue-900/30
            text-blue-400 font-semibold text-[9px] tracking-widest
          "
        >
          ← CALLS (CE)
        </th>
        <th
          scope="col"
          style={{ minWidth: 90 }}
          className="
            py-1 text-center bg-[#0e1018]
            border-b border-gray-800/40
            text-gray-600 font-semibold text-[9px] tracking-wide
          "
        >
          STRIKE
        </th>
        <th
          colSpan={peCols.length + 1}
          scope="colgroup"
          className="
            py-1 text-center bg-orange-950/60
            border-b border-orange-900/30
            text-orange-400 font-semibold text-[9px] tracking-widest
          "
        >
          PUTS (PE) →
        </th>
      </tr>

      {/* Column headers */}
      <tr className="bg-[#0e1018] border-b border-gray-800/50">
        <th
          scope="col"
          aria-label="Call actions"
          className="
            py-1 px-1.5 w-[52px]
            text-gray-700 text-[9px] font-medium
          "
        >
          Act
        </th>

        {ceCols.map((c) => (
          <th
            key={c}
            scope="col"
            title={TOOLTIPS[c]}
            className="
              py-1 px-2
              text-gray-600 font-medium text-[9px]
              text-right whitespace-nowrap
            "
          >
            {LABELS[c]}
          </th>
        ))}

        <th
          scope="col"
          className="
            py-1 px-2
            text-gray-500 font-bold text-[9px]
            text-center bg-[#080b12]/50
          "
        >
          Price
        </th>

        {peCols.map((c) => (
          <th
            key={c}
            scope="col"
            title={TOOLTIPS[c]}
            className="
              py-1 px-2
              text-gray-600 font-medium text-[9px]
              text-left whitespace-nowrap
            "
          >
            {LABELS[c]}
          </th>
        ))}

        <th
          scope="col"
          aria-label="Put actions"
          className="
            py-1 px-1.5 w-[52px]
            text-gray-700 text-[9px] font-medium
          "
        >
          Act
        </th>
      </tr>
    </thead>
  );
});
ChainHeader.displayName = 'ChainHeader';

// ── Stats Strip ────────────────────────────────────────────────

interface StatsStripProps {
  spotPrice: number;
  stats: ChainStats;
  selectedExpiry: ExpiryDate;
}

const StatsStrip = memo<StatsStripProps>(function StatsStrip({
  spotPrice,
  stats,
  selectedExpiry,
}) {
  const items: StatItem[] = useMemo(
    () => [
      {
        label: 'SPOT',
        value: `₹${spotPrice.toLocaleString('en-IN')}`,
        cls: 'text-white font-bold mono',
      },
      {
        label: 'PCR',
        value: stats.pcr,
        cls: `font-bold mono ${
          stats.pcrNumeric > 1
            ? 'text-emerald-400'
            : stats.pcr === 'N/A'
              ? 'text-gray-500'
              : 'text-red-400'
        }`,
      },
      {
        label: 'ATM IV',
        value: stats.atmRow
          ? `${stats.atmRow.ce_iv.toFixed(1)}%`
          : '—',
        cls: 'text-purple-400 font-bold mono',
      },
      {
        label: 'Max Pain',
        value: `₹${stats.maxPain.toLocaleString('en-IN')}`,
        cls: 'text-amber-400 font-bold mono',
      },
      {
        label: 'DTE',
        value: `${selectedExpiry.daysToExpiry}d`,
        cls: 'text-blue-400 font-bold',
      },
      {
        label: 'Resistance',
        value:
          stats.totalCeOI > 0
            ? `₹${stats.maxCeOIStrike.toLocaleString('en-IN')}`
            : '—',
        cls: 'text-blue-300 mono',
        title: `Highest CE OI strike`,
      },
      {
        label: 'Support',
        value:
          stats.totalPeOI > 0
            ? `₹${stats.maxPeOIStrike.toLocaleString('en-IN')}`
            : '—',
        cls: 'text-orange-300 mono',
        title: `Highest PE OI strike`,
      },
      {
        label: 'CE OI',
        value: fmtOI(stats.totalCeOI),
        cls: 'text-blue-400',
      },
      {
        label: 'PE OI',
        value: fmtOI(stats.totalPeOI),
        cls: 'text-orange-400',
      },
    ],
    [spotPrice, stats, selectedExpiry.daysToExpiry],
  );

  return (
    <div
      className="
        flex items-center gap-4 px-3 py-1
        bg-[#0e1018] border-b border-gray-800/50
        text-[10px] flex-shrink-0
        overflow-x-auto no-scroll
      "
      role="status"
      aria-label="Option chain summary"
    >
      {items.map((s) => (
        <span
          key={s.label}
          className="flex items-center gap-1 shrink-0"
          title={s.title}
        >
          <span className="text-gray-700">{s.label}</span>
          <span className={s.cls}>{s.value}</span>
        </span>
      ))}

      {/* Legend */}
      <span
        className="ml-auto flex items-center gap-2 shrink-0 text-[9px]"
        aria-hidden="true"
      >
        <span className="text-blue-500">■ CE</span>
        <span className="text-orange-500">■ PE</span>
      </span>
    </div>
  );
});
StatsStrip.displayName = 'StatsStrip';

// ── Toolbar ────────────────────────────────────────────────────

interface ToolbarProps {
  cfg: (typeof SYMBOL_CONFIG)[SymbolCode];
  expiries: ExpiryDate[];
  selectedExpiry: ExpiryDate;
  onExpiryChange: (e: ExpiryDate) => void;
  showGreeks: boolean;
  onToggleGreeks: () => void;
  showOIBars: boolean;
  onToggleOIBars: () => void;
  strikeRange: number;
  onStrikeRangeChange: (n: number) => void;
  isLoading: boolean;
  isLive?: boolean;
  loadingMsg?: string;
  lastUpdate: Date;
  canRefresh: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onScrollATM: () => void;
}

const Toolbar = memo<ToolbarProps>(function Toolbar({
  cfg,
  expiries,
  selectedExpiry,
  onExpiryChange,
  showGreeks,
  onToggleGreeks,
  showOIBars,
  onToggleOIBars,
  strikeRange,
  onStrikeRangeChange,
  isLoading,
  isLive,
  loadingMsg,
  lastUpdate,
  canRefresh,
  onRefresh,
  onExport,
  onScrollATM,
}) {
  return (
    <div
      className="
        flex items-center gap-2 px-3 py-1.5
        border-b border-gray-800/50
        bg-[#1a1d2e] flex-shrink-0
        flex-wrap gap-y-1
      "
      role="toolbar"
      aria-label="Option chain controls"
    >
      {/* ── Symbol badge ──────────────────────────────── */}
      <span className="text-gray-600 text-[10px] font-medium shrink-0">
        {cfg.displayName} ·{' '}
        <span className="text-gray-500">
          {cfg.breezeStockCode}/{cfg.breezeExchangeCode}
        </span>{' '}
        · Lot{' '}
        <span className="text-amber-400 font-bold">{cfg.lotSize}</span>{' '}
        · Step ₹{cfg.strikeStep}
      </span>

      <Sep />

      {/* ── Expiry selector ───────────────────────────── */}
      <span
        className="text-gray-700 text-[10px] shrink-0"
        id="expiry-label"
      >
        Expiry:
      </span>
      <div
        className="flex items-center gap-1 flex-wrap"
        role="radiogroup"
        aria-labelledby="expiry-label"
      >
        {expiries.map((exp) => {
          const isSelected =
            selectedExpiry.breezeValue === exp.breezeValue;
          return (
            <button
              key={exp.breezeValue}
              onClick={() => onExpiryChange(exp)}
              role="radio"
              aria-checked={isSelected}
              className={`
                px-2.5 py-0.5 text-[10px] rounded-lg font-medium
                transition-all shrink-0
                focus-visible:outline focus-visible:outline-2
                focus-visible:outline-blue-400
                ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                    : 'bg-[#20233a] text-gray-500 hover:text-white border border-gray-700/30'
                }
              `}
            >
              {exp.label}
              <span className="ml-1 opacity-50 text-[8px]">
                {exp.daysToExpiry}d
              </span>
            </button>
          );
        })}
      </div>

      <Sep />

      {/* ── Greeks toggle ─────────────────────────────── */}
      <button
        onClick={onToggleGreeks}
        aria-pressed={showGreeks}
        className={`
          px-2 py-0.5 text-[10px] rounded-lg font-medium
          transition-colors shrink-0 border
          focus-visible:outline focus-visible:outline-2
          focus-visible:outline-purple-400
          ${
            showGreeks
              ? 'bg-purple-600/15 text-purple-300 border-purple-500/25'
              : 'bg-[#20233a] text-gray-600 hover:text-white border-gray-700/30'
          }
        `}
      >
        Δ Greeks
      </button>

      {/* ── OI bar toggle ─────────────────────────────── */}
      <button
        onClick={onToggleOIBars}
        aria-pressed={showOIBars}
        aria-label={showOIBars ? 'Hide OI bars' : 'Show OI bars'}
        className={`
          flex items-center gap-0.5
          px-2 py-0.5 text-[10px] rounded-lg font-medium
          transition-colors shrink-0 border
          focus-visible:outline focus-visible:outline-2
          focus-visible:outline-blue-400
          ${
            showOIBars
              ? 'bg-blue-600/10 text-blue-400 border-blue-500/20'
              : 'bg-[#20233a] text-gray-600 hover:text-white border-gray-700/30'
          }
        `}
      >
        {showOIBars ? <Eye size={9} /> : <EyeOff size={9} />} OI
      </button>

      {/* ── Strike range selector ─────────────────────── */}
      <div className="flex items-center gap-1 shrink-0">
        <label
          htmlFor="strike-range-sel"
          className="text-gray-700 text-[10px]"
        >
          Range:
        </label>
        <select
          id="strike-range-sel"
          value={strikeRange}
          onChange={(e) =>
            onStrikeRangeChange(Number(e.target.value))
          }
          aria-label="Strike range around ATM"
          className="
            bg-[#20233a] text-gray-400 text-[10px]
            px-1.5 py-0.5 rounded-lg border border-gray-700/30
            focus-visible:outline focus-visible:outline-2
            focus-visible:outline-blue-400
            appearance-none cursor-pointer
          "
        >
          {STRIKE_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Scroll-to-ATM button ──────────────────────── */}
      <button
        onClick={onScrollATM}
        title="Scroll to ATM"
        aria-label="Scroll to ATM strike"
        className="
          p-1 text-gray-700
          hover:text-yellow-400 hover:bg-gray-700/40
          rounded-lg transition-colors
          focus-visible:outline focus-visible:outline-2
          focus-visible:outline-yellow-400
        "
      >
        <Target size={11} />
      </button>

      {/* ── Right cluster ─────────────────────────────── */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {/* Loading spinner */}
        {isLoading && (
          <RefreshCw
            size={10}
            className="text-blue-400 animate-spin"
            aria-label="Refreshing"
          />
        )}

        {/* Live / Demo indicator */}
        {isLive ? (
          <span
            className="
              flex items-center gap-1
              text-emerald-400 text-[9px] font-semibold
            "
            role="status"
          >
            <span
              className="
                w-1.5 h-1.5 bg-emerald-400
                rounded-full pulse-dot
              "
              aria-hidden="true"
            />
            LIVE
          </span>
        ) : (
          <span className="text-amber-500 text-[9px] font-semibold">
            DEMO
          </span>
        )}

        {/* Loading message */}
        {loadingMsg && (
          <span
            className="
              text-gray-600 text-[9px]
              max-w-[200px] truncate
            "
            title={loadingMsg}
            role="status"
          >
            {loadingMsg}
          </span>
        )}

        {/* Timestamp */}
        <time
          className="text-gray-700 text-[10px] mono"
          dateTime={lastUpdate.toISOString()}
        >
          {lastUpdate.toLocaleTimeString()}
        </time>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          disabled={!canRefresh}
          title={canRefresh ? 'Refresh chain' : 'Cooling down…'}
          aria-label="Refresh option chain"
          className="
            p-1 text-gray-700
            hover:text-gray-300 hover:bg-gray-700/40
            rounded-lg transition-colors
            disabled:opacity-30 disabled:cursor-not-allowed
            focus-visible:outline focus-visible:outline-2
            focus-visible:outline-blue-400
          "
        >
          <RefreshCw size={11} />
        </button>

        {/* Export CSV button */}
        <button
          onClick={onExport}
          title="Download CSV"
          aria-label="Export chain as CSV"
          className="
            p-1 text-gray-700
            hover:text-gray-300 hover:bg-gray-700/40
            rounded-lg transition-colors
            focus-visible:outline focus-visible:outline-2
            focus-visible:outline-blue-400
          "
        >
          <Download size={11} />
        </button>
      </div>
    </div>
  );
});
Toolbar.displayName = 'Toolbar';

// ── Loading Skeleton ───────────────────────────────────────────

const LoadingSkeleton = memo(function LoadingSkeleton() {
  return (
    <div
      className="flex-1 overflow-hidden px-2 py-3"
      role="status"
      aria-label="Loading option chain"
    >
      <div className="space-y-1.5">
        {Array.from({ length: 15 }, (_, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="h-5 bg-gray-800/40 rounded animate-pulse flex-1" />
            <div className="h-5 w-20 bg-gray-700/30 rounded animate-pulse" />
            <div className="h-5 bg-gray-800/40 rounded animate-pulse flex-1" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading option chain data…</span>
    </div>
  );
});
LoadingSkeleton.displayName = 'LoadingSkeleton';

// ── Empty State ────────────────────────────────────────────────

interface EmptyStateProps {
  symbol: string;
  expiry: string;
}

const EmptyState = memo<EmptyStateProps>(function EmptyState({
  symbol,
  expiry,
}) {
  return (
    <div
      className="
        flex-1 flex flex-col items-center justify-center
        gap-3 py-16 text-gray-600
      "
      role="status"
      data-testid="chain-empty"
    >
      <Target size={32} className="text-gray-700" />
      <p className="text-sm font-medium">No option chain data</p>
      <p className="text-xs text-gray-700">
        {symbol} · {expiry} — data may be unavailable or still loading.
      </p>
    </div>
  );
});
EmptyState.displayName = 'EmptyState';

// ── Error Banner ───────────────────────────────────────────────

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

const ErrorBanner = memo<ErrorBannerProps>(function ErrorBanner({
  message,
  onRetry,
}) {
  return (
    <div
      className="
        mx-3 my-2 px-3 py-2
        bg-red-900/20 border border-red-800/30
        rounded-lg flex items-center gap-2
        text-red-400 text-xs
      "
      role="alert"
      data-testid="chain-error"
    >
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="
            px-2 py-0.5
            bg-red-800/30 hover:bg-red-700/40
            rounded text-[10px] font-medium
            transition-colors
            focus-visible:outline focus-visible:outline-2
            focus-visible:outline-red-400
          "
        >
          Retry
        </button>
      )}
    </div>
  );
});
ErrorBanner.displayName = 'ErrorBanner';

// ── Staleness Warning ──────────────────────────────────────────

interface StalenessWarningProps {
  staleSec: number;
  canRefresh: boolean;
  onRefresh: () => void;
}

const StalenessWarning = memo<StalenessWarningProps>(
  function StalenessWarning({ staleSec, canRefresh, onRefresh }) {
    return (
      <div
        className="
          flex items-center gap-2 px-3 py-1
          bg-amber-900/15 border-b border-amber-800/20
          text-amber-400 text-[10px]
        "
        role="alert"
        aria-live="polite"
      >
        <AlertCircle size={10} className="shrink-0" />
        <span>
          Data is {Math.floor(staleSec / 60)}m {staleSec % 60}s old.
        </span>
        <button
          onClick={onRefresh}
          disabled={!canRefresh}
          className="
            text-amber-300 underline
            hover:text-amber-200
            disabled:opacity-40 disabled:no-underline
            disabled:cursor-not-allowed
            text-[10px]
          "
        >
          Refresh now
        </button>
      </div>
    );
  },
);
StalenessWarning.displayName = 'StalenessWarning';

// ── Footer ─────────────────────────────────────────────────────

interface ChainFooterProps {
  rowCount: number;
  totalCount: number;
  stockCode: string;
  exchangeCode: string;
  expiryVal: string;
}

const ChainFooter = memo<ChainFooterProps>(function ChainFooter({
  rowCount,
  totalCount,
  stockCode,
  exchangeCode,
  expiryVal,
}) {
  return (
    <div
      className="
        flex items-center gap-3 px-3 py-1.5
        border-t border-gray-800/50
        bg-[#0e1018] text-[9px] text-gray-700
        flex-shrink-0
      "
      role="contentinfo"
    >
      {/* Keyboard shortcuts help */}
      <span>
        Hover row →{' '}
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-emerald-500 font-bold text-[8px]">
          B
        </kbd>
        =Buy{' '}
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-red-500 font-bold text-[8px]">
          S
        </kbd>
        =Sell · Focus +{' '}
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-[8px]">
          B
        </kbd>
        /
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-[8px]">
          S
        </kbd>{' '}
        CE,{' '}
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-[8px]">
          ⇧B
        </kbd>
        /
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-[8px]">
          ⇧S
        </kbd>{' '}
        PE
      </span>

      {/* Row count & identifiers */}
      <span className="ml-auto">
        {rowCount === totalCount
          ? `${rowCount} strikes`
          : `${rowCount} of ${totalCount} strikes`}{' '}
        · {stockCode}/{exchangeCode} · {expiryVal}
      </span>
    </div>
  );
});
ChainFooter.displayName = 'ChainFooter';


// ════════════════════════════════════════════════════════════════
// § 6 — ERROR BOUNDARY
// ════════════════════════════════════════════════════════════════

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

class OptionChainErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(
    error: Error,
  ): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // In production: forward to Sentry / DataDog / your telemetry
    console.error(
      '[OptionChain] Unhandled render error:',
      error,
      info.componentStack,
    );
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="
            flex flex-col items-center justify-center
            h-full bg-[#13161f] text-gray-400 gap-4 p-8
          "
          role="alert"
        >
          <AlertCircle size={40} className="text-red-500" />
          <h3 className="text-sm font-semibold text-red-400">
            Option Chain Error
          </h3>
          <p className="text-xs text-gray-600 text-center max-w-md">
            {this.state.error?.message ??
              'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleReset}
            className="
              px-4 py-1.5 bg-blue-600 hover:bg-blue-500
              text-white text-xs rounded-lg font-medium
              transition-colors
              focus-visible:outline focus-visible:outline-2
              focus-visible:outline-blue-400
            "
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}


// ════════════════════════════════════════════════════════════════
// § 7 — MAIN COMPONENT
// ════════════════════════════════════════════════════════════════

const OptionChainInner: React.FC<OptionChainProps> = ({
  symbol,
  data,
  spotPrice,
  selectedExpiry,
  onExpiryChange,
  onAddLeg,
  highlightedStrikes,
  lastUpdate,
  isLoading,
  onRefresh,
  isLive,
  loadingMsg,
  error,
  strikeRange: strikeRangeProp,
}) => {
  // ── Local state ──────────────────────────────────────────
  const [showGreeks, setShowGreeks] = useState(false);
  const [showOIBars, setShowOIBars] = useState(true);
  const [focusedStrike, setFocusedStrike] = useState<number | null>(
    null,
  );
  const [strikeRange, setStrikeRange] = useState(
    strikeRangeProp ?? DEFAULT_STRIKE_RANGE,
  );

  // ── Refs ─────────────────────────────────────────────────
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // ── Sync external strikeRange prop ───────────────────────
  useEffect(() => {
    if (strikeRangeProp !== undefined) {
      setStrikeRange(strikeRangeProp);
    }
  }, [strikeRangeProp]);

  // ── Derived data & hooks ─────────────────────────────────
  const cfg = SYMBOL_CONFIG[symbol];

  const expiries = useMemo(
    () => (cfg ? getExpiries(symbol) : []),
    [symbol, cfg],
  );

  const filteredData = useFilteredData(
    data,
    strikeRange,
    spotPrice,
    symbol,
  );

  // Stats computed from FULL data (not filtered)
  const stats = useChainStats(data, spotPrice, symbol);

  const flashed = useFlashCells(data);

  const [canRefresh, startCooldown] =
    useRefreshThrottle(isLoading);

  const scrollToATM = useScrollToATM(symbol, tableContainerRef);

  // Memoize column arrays for stable references
  const ceCols = useMemo(
    () => [...(showGreeks ? CE_GREEKS : CE_BASIC)].reverse(),
    [showGreeks],
  );
  const peCols = useMemo(
    () => [...(showGreeks ? PE_GREEKS : PE_BASIC)],
    [showGreeks],
  );

  // ── Callbacks ────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    if (!canRefresh) return;
    startCooldown();
    onRefresh();
  }, [canRefresh, startCooldown, onRefresh]);

  const handleExport = useCallback(() => {
    exportToCSV(
      data,
      symbol,
      selectedExpiry.breezeValue,
      spotPrice,
    );
  }, [data, symbol, selectedExpiry.breezeValue, spotPrice]);

  const handleScrollATM = useCallback(() => {
    scrollToATM();
  }, [scrollToATM]);

  /**
   * Central leg-add handler.
   * Looks up the full row from `data` (not `filteredData`)
   * so strikes outside the filter window still resolve.
   */
  const handleAddLeg = useCallback(
    (
      strike: number,
      type: 'CE' | 'PE',
      action: 'BUY' | 'SELL',
    ) => {
      const row = data.find((r) => r.strike === strike);
      if (!row) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[OptionChain] handleAddLeg: strike ${strike} not found`,
          );
        }
        return;
      }

      const isCE = type === 'CE';

      onAddLeg({
        symbol,
        type,
        strike: row.strike,
        action,
        lots: 1,
        ltp: isCE ? row.ce_ltp : row.pe_ltp,
        iv: isCE ? row.ce_iv : row.pe_iv,
        delta: isCE ? row.ce_delta : row.pe_delta,
        theta: isCE ? row.ce_theta : row.pe_theta,
        gamma: isCE ? row.ce_gamma : row.pe_gamma,
        vega: isCE ? row.ce_vega : row.pe_vega,
        expiry: selectedExpiry.breezeValue,
      });
    },
    [data, onAddLeg, symbol, selectedExpiry.breezeValue],
  );

  const handleFocusStrike = useCallback(
    (s: number | null) => {
      setFocusedStrike(s);
    },
    [],
  );

  const handleToggleGreeks = useCallback(
    () => setShowGreeks((g) => !g),
    [],
  );

  const handleToggleOIBars = useCallback(
    () => setShowOIBars((b) => !b),
    [],
  );

  /**
   * Arrow-key navigation between table rows.
   * Handled at container level so it works even if focus
   * is on a button inside the row.
   */
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const container = tableContainerRef.current;
      if (!container) return;

      e.preventDefault();

      const rows = Array.from(
        container.querySelectorAll<HTMLTableRowElement>(
          'tbody tr[data-strike]',
        ),
      );
      if (rows.length === 0) return;

      // Find which row (or its child) currently has focus
      const active = document.activeElement as HTMLElement | null;
      let currentIdx = -1;
      if (active) {
        currentIdx = rows.findIndex(
          (r) => r === active || r.contains(active),
        );
      }

      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(currentIdx + 1, rows.length - 1)
          : Math.max(currentIdx - 1, 0);

      const nextRow = rows[nextIdx];
      if (nextRow) {
        nextRow.focus({ preventScroll: false });
        const strike = Number(nextRow.dataset.strike);
        if (Number.isFinite(strike)) {
          setFocusedStrike(strike);
        }
      }
    },
    [],
  );

  // ── Guard: unknown symbol config ─────────────────────────
  if (!cfg) {
    return (
      <div
        className="
          flex items-center justify-center
          h-full bg-[#13161f]
          text-red-400 text-sm
        "
        role="alert"
        data-testid="chain-unknown-symbol"
      >
        <AlertCircle size={16} className="mr-2" />
        Unknown symbol:{' '}
        <code className="ml-1 font-mono text-red-300">{symbol}</code>
      </div>
    );
  }

  // ── Render-state flags ───────────────────────────────────
  const showTable = filteredData.length > 0 && !error;
  const showEmpty =
    filteredData.length === 0 && !isLoading && !error;
  const showSkeleton = isLoading && data.length === 0;

  // ── Data staleness ───────────────────────────────────────
  const staleSec = Math.floor(
    (Date.now() - lastUpdate.getTime()) / 1000,
  );
  const isStale = staleSec > STALE_THRESHOLD_SEC;

  // ── JSX ──────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col h-full bg-[#13161f] overflow-hidden"
      role="region"
      aria-label={`${cfg.displayName} option chain`}
      data-testid="option-chain"
    >
      {/* ── Toolbar ───────────────────────────────────── */}
      <Toolbar
        cfg={cfg}
        expiries={expiries}
        selectedExpiry={selectedExpiry}
        onExpiryChange={onExpiryChange}
        showGreeks={showGreeks}
        onToggleGreeks={handleToggleGreeks}
        showOIBars={showOIBars}
        onToggleOIBars={handleToggleOIBars}
        strikeRange={strikeRange}
        onStrikeRangeChange={setStrikeRange}
        isLoading={isLoading}
        isLive={isLive}
        loadingMsg={loadingMsg}
        lastUpdate={lastUpdate}
        canRefresh={canRefresh}
        onRefresh={handleRefresh}
        onExport={handleExport}
        onScrollATM={handleScrollATM}
      />

      {/* ── Staleness warning ─────────────────────────── */}
      {isStale && !isLoading && (
        <StalenessWarning
          staleSec={staleSec}
          canRefresh={canRefresh}
          onRefresh={handleRefresh}
        />
      )}

      {/* ── Stats strip (only with data) ──────────────── */}
      {data.length > 0 && (
        <StatsStrip
          spotPrice={spotPrice}
          stats={stats}
          selectedExpiry={selectedExpiry}
        />
      )}

      {/* ── Error banner ──────────────────────────────── */}
      {error && (
        <ErrorBanner message={error} onRetry={handleRefresh} />
      )}

      {/* ── Loading skeleton ──────────────────────────── */}
      {showSkeleton && <LoadingSkeleton />}

      {/* ── Empty state ───────────────────────────────── */}
      {showEmpty && (
        <EmptyState
          symbol={cfg.displayName}
          expiry={selectedExpiry.label}
        />
      )}

      {/* ── Main grid ─────────────────────────────────── */}
      {showTable && (
        <div
          ref={tableContainerRef}
          className="flex-1 overflow-auto"
          onKeyDown={handleTableKeyDown}
        >
          <table
            className="w-full border-collapse text-[10px]"
            style={{ minWidth: 800 }}
            role="grid"
            aria-label={`${cfg.displayName} option chain grid`}
            aria-rowcount={filteredData.length}
            aria-colcount={ceCols.length + peCols.length + 3}
          >
            <ChainHeader ceCols={ceCols} peCols={peCols} />

            <tbody>
              {filteredData.map((row, idx) => {
                const isATM = !!row.isATM;
                return (
                  <ChainRow
                    key={row.strike}
                    row={row}
                    ceCols={ceCols}
                    peCols={peCols}
                    isATM={isATM}
                    isHighlighted={highlightedStrikes.has(
                      row.strike,
                    )}
                    isMaxCeOI={
                      row.strike === stats.maxCeOIStrike &&
                      stats.totalCeOI > 0
                    }
                    isMaxPeOI={
                      row.strike === stats.maxPeOIStrike &&
                      stats.totalPeOI > 0
                    }
                    showOIBars={showOIBars}
                    maxOI={stats.maxOI}
                    flashed={flashed}
                    onAddLeg={handleAddLeg}
                    rowIndex={idx}
                    focusedStrike={focusedStrike}
                    onFocusStrike={handleFocusStrike}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────── */}
      <ChainFooter
        rowCount={filteredData.length}
        totalCount={data.length}
        stockCode={cfg.breezeStockCode}
        exchangeCode={cfg.breezeExchangeCode}
        expiryVal={selectedExpiry.breezeValue}
      />
    </div>
  );
};


// ════════════════════════════════════════════════════════════════
// § 8 — PUBLIC EXPORT
// ════════════════════════════════════════════════════════════════

/**
 * Production-ready Option Chain component.
 *
 * Wraps the inner implementation with an error boundary so that
 * a rendering crash in any sub-component (bad data, missing field, etc.)
 * shows a graceful fallback instead of taking down the entire app.
 *
 * @example
 * ```tsx
 * <OptionChain
 *   symbol="NIFTY"
 *   data={chainData}
 *   spotPrice={22450}
 *   selectedExpiry={currentExpiry}
 *   onExpiryChange={setExpiry}
 *   onAddLeg={addLeg}
 *   highlightedStrikes={selectedStrikes}
 *   lastUpdate={new Date()}
 *   isLoading={false}
 *   onRefresh={fetchChain}
 *   isLive={wsConnected}
 *   error={fetchError}
 *   strikeRange={20}
 * />
 * ```
 */
export const OptionChain: React.FC<OptionChainProps> = (props) => {
  return (
    <OptionChainErrorBoundary onReset={props.onRefresh}>
      <OptionChainInner {...props} />
    </OptionChainErrorBoundary>
  );
};


// ════════════════════════════════════════════════════════════════
// § 9 — PERFORMANCE MONITORING (opt-in, dev only)
// ════════════════════════════════════════════════════════════════

/**
 * Drop-in profiling hook for development.
 * Logs render counts, data-update frequency, and flash rates
 * every 10 seconds to help identify unnecessary re-renders.
 *
 * @example
 * ```tsx
 * // Inside OptionChainInner, before the return statement:
 * useChainPerfMonitor(data, flashed, filteredData, 'OptionChain');
 * ```
 */
export function useChainPerfMonitor(
  data: ReadonlyArray<OptionRow>,
  flashed: ReadonlyMap<string, FlashEntry>,
  filteredData: ReadonlyArray<OptionRow>,
  label = 'OptionChain',
): void {
  const renderCount = useRef(0);
  const dataChangeCount = useRef(0);
  const flashCount = useRef(0);
  const lastDataRef = useRef(data);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Increment on every render
  useEffect(() => {
    renderCount.current += 1;
  });

  // Track data reference changes
  useEffect(() => {
    if (lastDataRef.current !== data) {
      dataChangeCount.current += 1;
      lastDataRef.current = data;
    }
  }, [data]);

  // Track flash batches
  useEffect(() => {
    if (flashed.size > 0) {
      flashCount.current += 1;
    }
  }, [flashed]);

  // Periodic logging (dev only)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;

    intervalRef.current = setInterval(() => {
      console.debug(
        `[${label}] ` +
          `renders=${renderCount.current} ` +
          `dataUpdates=${dataChangeCount.current} ` +
          `flashBatches=${flashCount.current} ` +
          `rows=${filteredData.length}/${data.length}`,
      );
    }, 10_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [label, filteredData.length, data.length]);
}


// ════════════════════════════════════════════════════════════════
// § 10 — RE-EXPORTS
// ════════════════════════════════════════════════════════════════

export type {
  OptionChainProps,
  ChainStats,
  FlashDir,
  FlashEntry,
  StatItem,
};

export {
  // Utilities
  exportToCSV,
  formatCell,
  getRowValue,

  // Hooks (for composition in other components)
  useChainStats,
  useFlashCells,
  useFilteredData,
  useScrollToATM,
  useRefreshThrottle,

  // Constants (for testing / external configuration)
  FLASH_DURATION_MS,
  REFRESH_COOLDOWN_MS,
  STALE_THRESHOLD_SEC,
  LABELS,
  TOOLTIPS,
};
