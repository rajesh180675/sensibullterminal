// components/OptionChain/constants.ts

import type { OISignal, OISignalConfig, CellFormatter } from './types';
import type { OptionRow } from '../../types/index';
import { fmtOI } from '../../utils/math';

// ════════════════════════════════════════════════════════════════
// § TIMING
// ════════════════════════════════════════════════════════════════

export const FLASH_DURATION_MS = 600;
export const SCROLL_DELAY_MS = 100;
export const REFRESH_COOLDOWN_MS = 2_000;
export const STALE_THRESHOLD_SEC = 120;
export const STALE_CHECK_INTERVAL_MS = 10_000;
export const DEFAULT_STRIKE_RANGE = 0;
export const OI_SIGNAL_THRESHOLD = 100;

// ════════════════════════════════════════════════════════════════
// § COLUMN DEFINITIONS
// ════════════════════════════════════════════════════════════════

export const CE_BASIC = [
  'ce_oi', 'ce_oiChg', 'ce_volume', 'ce_iv', 'ce_ltp',
] as const;

export const CE_GREEKS = [
  'ce_oi', 'ce_oiChg', 'ce_volume', 'ce_iv', 'ce_delta', 'ce_theta', 'ce_ltp',
] as const;

export const PE_BASIC = [
  'pe_ltp', 'pe_iv', 'pe_volume', 'pe_oiChg', 'pe_oi',
] as const;

export const PE_GREEKS = [
  'pe_ltp', 'pe_iv', 'pe_delta', 'pe_theta', 'pe_volume', 'pe_oiChg', 'pe_oi',
] as const;

// ════════════════════════════════════════════════════════════════
// § LABELS & TOOLTIPS
// ════════════════════════════════════════════════════════════════

export const LABELS: Readonly<Record<string, string>> = {
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
  strike: 'Strike',
};

export const TOOLTIPS: Readonly<Record<string, string>> = {
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

// ════════════════════════════════════════════════════════════════
// § STRIKE RANGE OPTIONS
// ════════════════════════════════════════════════════════════════

export const STRIKE_RANGE_OPTIONS = [
  { value: 0, label: 'All' },
  { value: 10, label: '±10' },
  { value: 15, label: '±15' },
  { value: 20, label: '±20' },
  { value: 25, label: '±25' },
  { value: 40, label: '±40' },
] as const;

// ════════════════════════════════════════════════════════════════
// § FLASH FIELD TRACKING
// ════════════════════════════════════════════════════════════════

export const TRACKED_FIELDS: ReadonlyArray<[string, (r: OptionRow) => number]> = [
  ['ce_ltp', (r) => r.ce_ltp],
  ['pe_ltp', (r) => r.pe_ltp],
  ['ce_oi', (r) => r.ce_oi],
  ['pe_oi', (r) => r.pe_oi],
];

export const FLASH_FIELD_KEYS = ['ce_ltp', 'pe_ltp', 'ce_oi', 'pe_oi'] as const;

// ════════════════════════════════════════════════════════════════
// § FORMAT REGISTRY (SPEC-A2)
// ════════════════════════════════════════════════════════════════

export const FORMATTERS: Readonly<Record<string, CellFormatter>> = {
  ce_oi:     (v) => fmtOI(Math.abs(v)),
  pe_oi:     (v) => fmtOI(Math.abs(v)),
  ce_oiChg:  (v) => (v >= 0 ? '+' : '') + fmtOI(v),
  pe_oiChg:  (v) => (v >= 0 ? '+' : '') + fmtOI(v),
  ce_ltp:    (v) => v.toFixed(2),
  pe_ltp:    (v) => v.toFixed(2),
  ce_iv:     (v) => v.toFixed(1) + '%',
  pe_iv:     (v) => v.toFixed(1) + '%',
  ce_delta:  (v) => v.toFixed(3),
  pe_delta:  (v) => v.toFixed(3),
  ce_theta:  (v) => v.toFixed(2),
  pe_theta:  (v) => v.toFixed(2),
  ce_volume: (v) => fmtOI(v),
  pe_volume: (v) => fmtOI(v),
};

// ════════════════════════════════════════════════════════════════
// § OI SIGNAL CONFIG (SPEC-F2)
// ════════════════════════════════════════════════════════════════

export const OI_SIGNAL_CONFIG: Readonly<Record<OISignal, OISignalConfig>> = {
  long_buildup: {
    label: 'Long Buildup',
    abbr: 'LB',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10',
  },
  short_buildup: {
    label: 'Short Buildup',
    abbr: 'SB',
    color: 'text-red-400',
    bgColor: 'bg-red-400/10',
  },
  short_covering: {
    label: 'Short Covering',
    abbr: 'SC',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
  },
  long_unwinding: {
    label: 'Long Unwinding',
    abbr: 'LU',
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
  },
  neutral: {
    label: 'Neutral',
    abbr: '—',
    color: 'text-gray-600',
    bgColor: '',
  },
};

// ════════════════════════════════════════════════════════════════
// § PREFERENCES
// ════════════════════════════════════════════════════════════════

export const PREFS_STORAGE_KEY = 'option_chain_prefs';

export const DEFAULT_PREFS = {
  showGreeks: false,
  showOIBars: true,
  strikeRange: 0,
  showOISignals: false,
} as const;
