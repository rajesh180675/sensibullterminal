// ════════════════════════════════════════════════════════════════════════════
// POSITIONS PANEL v10 — Debug & Integration Fix Pass
//
// CHANGES FROM v9:
// ────────────────
// [CRITICAL FIX] useAutoRefresh: callback was invoked inside a React state-
//   updater function (setTick). React 19 + StrictMode double-invokes state
//   updater functions to detect impurity, causing every auto-refresh to fire
//   the API callback TWICE. Fixed by using a ref (tickRef) for the countdown
//   and invoking cbRef.current() directly in the setInterval handler.
//
// [HIGH FIX] Tab state preservation — v9 promised CSS display toggle in the
//   changelog but implemented conditional rendering instead, causing
//   OrderBookTable/TradeBookTable/FundsDashboard to unmount on every tab
//   switch (losing internal search query, sort order, and pagination).
//   Fixed: sell/orders/trades/funds tabs now use style={{ display }} toggle.
//
// [MEDIUM FIX] SquareOffModal: validateLimitPrice was called 3-4× per leg
//   per render (className, aria-invalid, condition, error text). Extracted
//   to a per-render local variable via IIFE.
//
// [MEDIUM FIX] SquareOffModal progress indicator: step index was recomputed
//   inside every .map() iteration (allocating a new array + linear search).
//   Hoisted to a single IIFE outside the map loop.
//
// [MINOR FIX] TradeOptionsPanel onDone now also calls loadOrders() so a
//   newly placed order immediately appears in Orders/Sell tabs without
//   requiring manual tab navigation.
// ════════════════════════════════════════════════════════════════════════════

import React, {
  useState, useCallback, useEffect, useMemo, useRef,
  type ReactNode, type FC,
} from 'react';
import { createPortal } from 'react-dom';
import {
  TrendingUp, TrendingDown, Clock, CheckCircle, FileText,
  ChevronDown, ChevronRight, Zap, X, RefreshCw,
  DollarSign, BookOpen, List, AlertTriangle, Target,
  ArrowUpDown, Crosshair, ShieldAlert, Activity, Search, Copy, Check,
  BarChart3, Info, Edit3, Minus, Plus, ChevronLeft, ChevronsLeft,
  ChevronsRight, Eye, EyeOff, AlertCircle, Wifi, WifiOff,
  ArrowDownAZ, Ban, Download, Percent,
} from 'lucide-react';
import { Position, SymbolCode, BreezeSession } from '../types/index';
import { MOCK_POSITIONS } from '../data/mock';
import { SYMBOL_CONFIG } from '../config/market';
import { fmtPnL } from '../utils/math';
import {
  fetchFunds, fetchOrderBook, fetchTradeBook,
  cancelOrder, squareOffPosition, placeOrder,
  isKaggleBackend,
  type FundsData, type OrderBookRow, type TradeBookRow,
} from '../utils/kaggleClient';

// ═══════════════════════════════════════════════════════════════════════════
// §1  TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

interface Props {
  onLoadToBuilder: (pos: Position) => void;
  livePositions?: Position[] | null;
  isLive?: boolean;
  session?: BreezeSession | null;
  onRefreshPositions?: () => void;
}

type PositionFilter = 'ALL' | 'ACTIVE' | 'DRAFT' | 'CLOSED';
type SubTab = 'positions' | 'trade' | 'sell' | 'orders' | 'trades' | 'funds';
type OrderType = 'market' | 'limit';
type SortDir = 'asc' | 'desc';
type ToastType = 'success' | 'error' | 'warning' | 'info';
type PosSortField = 'pnl' | 'date' | 'symbol';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface SqOffLeg {
  legIndex: number;
  type: 'CE' | 'PE';
  strike: number;
  origAction: 'BUY' | 'SELL';
  exitAction: 'BUY' | 'SELL';
  maxLots: number;
  lots: number;
  lotSize: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  selected: boolean;
  limitPrice: string;
  orderType: OrderType;
  status: 'idle' | 'placing' | 'done' | 'error';
  resultMsg: string;
}

interface TabError {
  [key: string]: string | null | undefined;
}

const PAGE_SIZE = 15;
const DEBOUNCE_MS = 300;
const AUTO_REFRESH_SEC = 30;
const STALE_THRESHOLD_MS = 120_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1500;

const SKEL_WIDTHS: readonly number[] = [65, 80, 55, 72, 90, 60, 75, 85, 50];

const SUB_TAB_ORDER: SubTab[] = [
  'positions',
  'trade',
  'sell',
  'orders',
  'trades',
  'funds',
];

// ═══════════════════════════════════════════════════════════════════════════
// §2  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

const asNumber = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const clamp = (val: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, val));

const extractTimestamp = (row: Record<string, unknown>): string => {
  for (const k of [
    'exchange_time',
    'trade_time',
    'order_time',
    'created_at',
    'updated_at',
    'datetime',
    'timestamp',
  ]) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '—';
};

const parseTimestamp = (ts: string): number => {
  if (ts === '—') return 0;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const resolvePositions = (
  live: boolean,
  data: Position[] | null | undefined,
): Position[] => (live && Array.isArray(data) ? data : MOCK_POSITIONS);

const validateStrike = (value: string, step: number): string | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Strike must be a positive number';
  if (Math.abs(Math.round(n / step) * step - n) > 0.001)
    return `Strike must be a multiple of ${step}`;
  return null;
};

const validateLimitPrice = (value: string): string | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Price must be > 0';
  if (n > 999999) return 'Price seems unreasonable';
  return null;
};

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

const genId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const orderStatusCategory = (
  s: string,
): 'pending' | 'completed' | 'rejected' | 'cancelled' | 'other' => {
  const l = s.toLowerCase();
  if (l.includes('complet')) return 'completed';
  if (l.includes('cancel')) return 'cancelled';
  if (l.includes('reject')) return 'rejected';
  if (l.includes('open') || l.includes('pend')) return 'pending';
  return 'other';
};

const statusColor = (s: string): string => {
  const cat = orderStatusCategory(s);
  if (cat === 'completed') return 'text-emerald-400';
  if (cat === 'cancelled') return 'text-gray-500';
  if (cat === 'rejected') return 'text-red-400';
  if (cat === 'pending') return 'text-amber-400';
  return 'text-gray-400';
};

/** Retry wrapper with exponential backoff */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseMs: number = RETRY_BASE_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise(resolve =>
          setTimeout(resolve, baseMs * Math.pow(2, attempt)),
        );
      }
    }
  }
  throw lastError;
}

/** Export data as CSV download */
function exportCsv(
  filename: string,
  headers: string[],
  rows: string[][],
): void {
  const escape = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const csv = [
    headers.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// §3  CUSTOM HOOKS
// ═══════════════════════════════════════════════════════════════════════════

function useDebounce<T>(value: T, delay: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setD(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return d;
}

function useAutoRefresh(
  callback: () => void,
  intervalSec: number,
  enabled: boolean,
): { secondsLeft: number } {
  const [tick, setTick] = useState(intervalSec);
  const cbRef = useRef(callback);
  const visRef = useRef(true);
  // FIX (React 19 StrictMode): Use a ref for the actual countdown so the
  // callback is never invoked inside a state-updater function (which React may
  // call twice in development to detect side-effects, causing double API calls).
  const tickRef = useRef(intervalSec);

  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const onVis = () => {
      visRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!enabled) {
      tickRef.current = intervalSec;
      setTick(intervalSec);
      return;
    }
    // Reset counter when (re-)enabled so we always wait a full interval.
    tickRef.current = intervalSec;
    setTick(intervalSec);
    const id = window.setInterval(() => {
      if (!visRef.current) return;
      tickRef.current -= 1;
      if (tickRef.current <= 0) {
        // Safe: callback invoked in the interval handler, not inside a
        // React state-updater, so it runs exactly once per interval.
        cbRef.current();
        tickRef.current = intervalSec;
      }
      // Push the display value to React state — purely for UI.
      setTick(tickRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [enabled, intervalSec]);

  return { secondsLeft: tick };
}

function usePagination<T>(
  data: T[],
  pageSize: number,
  resetKey?: unknown,
) {
  const [page, setPageRaw] = useState(0);
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));

  const prevKey = useRef(resetKey);
  useEffect(() => {
    if (prevKey.current !== resetKey) {
      prevKey.current = resetKey;
      setPageRaw(0);
    }
  }, [resetKey]);

  // Always clamp inline — no effect loop
  const safePage = clamp(page, 0, totalPages - 1);

  const setPage = useCallback(
    (p: number | ((prev: number) => number)) => {
      setPageRaw(prev => {
        const next = typeof p === 'function' ? p(prev) : p;
        const maxPage = Math.max(
          0,
          Math.ceil(data.length / pageSize) - 1,
        );
        return clamp(next, 0, maxPage);
      });
    },
    [data.length, pageSize],
  );

  const slice = useMemo(
    () => data.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [data, safePage, pageSize],
  );

  return {
    page: safePage,
    totalPages,
    slice,
    setPage,
    canPrev: safePage > 0,
    canNext: safePage < totalPages - 1,
    prev: () => setPage(p => p - 1),
    next: () => setPage(p => p + 1),
    first: () => setPage(0),
    last: () => setPage(totalPages - 1),
    showing: {
      from: data.length > 0 ? safePage * pageSize + 1 : 0,
      to: Math.min(data.length, (safePage + 1) * pageSize),
      total: data.length,
    },
  };
}

function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const q = () =>
      el.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );

    const initial = q();
    if (initial.length > 0) initial[0].focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = q();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [active]);

  return ref;
}

function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const orig = document.body.style.overflow;
    const origPR = document.body.style.paddingRight;
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (sbw > 0) document.body.style.paddingRight = `${sbw}px`;
    return () => {
      document.body.style.overflow = orig;
      document.body.style.paddingRight = origPR;
    };
  }, [active]);
}

/** Keyboard shortcut registration */
function useKeyboardShortcuts(
  shortcuts: Record<string, () => void>,
  enabled: boolean = true,
) {
  const ref = useRef(shortcuts);
  useEffect(() => {
    ref.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      const key = [
        e.ctrlKey || e.metaKey ? 'Ctrl' : '',
        e.shiftKey ? 'Shift' : '',
        e.altKey ? 'Alt' : '',
        e.key,
      ]
        .filter(Boolean)
        .join('+');

      if (ref.current[key]) {
        e.preventDefault();
        ref.current[key]();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}

// ═══════════════════════════════════════════════════════════════════════════
// §4  SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

class PositionsPanelErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex-1 flex items-center justify-center bg-[#13161f] p-8"
          role="alert"
        >
          <div className="text-center max-w-md">
            <AlertCircle
              size={48}
              className="mx-auto mb-4 text-red-400 opacity-60"
            />
            <h2 className="text-white font-bold text-lg mb-2">
              Panel Error
            </h2>
            <pre className="text-red-400/60 text-[10px] bg-red-500/5 rounded-xl p-3 mb-4 overflow-auto max-h-24 text-left">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() =>
                this.setState({ hasError: false, error: null })
              }
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const SkeletonRow: FC<{ cols: number }> = React.memo(({ cols }) => (
  <tr className="animate-pulse">
    {Array.from({ length: cols }, (_, i) => (
      <td key={i} className="px-3 py-3">
        <div
          className="h-3 bg-gray-800/60 rounded-lg"
          style={{
            width: `${SKEL_WIDTHS[i % SKEL_WIDTHS.length]}%`,
          }}
        />
      </td>
    ))}
  </tr>
));
SkeletonRow.displayName = 'SkeletonRow';

const SkeletonCard: FC = React.memo(() => (
  <div className="rounded-2xl border border-gray-800/30 bg-[#1a1d2e]/50 p-4 animate-pulse">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 bg-gray-800/60 rounded-xl flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-gray-800/60 rounded w-1/3" />
        <div className="h-2 bg-gray-800/40 rounded w-1/2" />
      </div>
      <div className="w-20 h-6 bg-gray-800/60 rounded-lg flex-shrink-0" />
    </div>
  </div>
));
SkeletonCard.displayName = 'SkeletonCard';

const SearchInput: FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}> = React.memo(
  ({ value, onChange, placeholder = 'Search…', className = '' }) => (
    <div className={`relative ${className}`}>
      <Search
        size={11}
        className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"
      />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-6 pr-6 py-1 bg-[#0e1018] border border-gray-700/40 rounded-lg text-[10px] text-white outline-none focus:border-blue-500/50 transition-colors w-full"
        aria-label={placeholder}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-white"
          aria-label="Clear search"
        >
          <X size={10} />
        </button>
      )}
    </div>
  ),
);
SearchInput.displayName = 'SearchInput';

const ConfirmDialog: FC<{
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = React.memo(
  ({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    loading,
    onConfirm,
    onCancel,
  }) => {
    const trapRef = useFocusTrap<HTMLDivElement>(open);
    useBodyScrollLock(open);

    if (!open) return null;

    const colors = {
      danger: {
        bg: 'bg-red-600 hover:bg-red-500',
        border: 'border-red-500/30',
        icon: 'text-red-400',
      },
      warning: {
        bg: 'bg-amber-600 hover:bg-amber-500',
        border: 'border-amber-500/30',
        icon: 'text-amber-400',
      },
      info: {
        bg: 'bg-blue-600 hover:bg-blue-500',
        border: 'border-blue-500/30',
        icon: 'text-blue-400',
      },
    }[variant];

    return createPortal(
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={e => {
          if (e.key === 'Escape' && !loading) {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div
          ref={trapRef}
          className={`bg-[#13161f] border ${colors.border} rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4`}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className={colors.icon} />
            <h3 className="text-white font-bold text-sm">{title}</h3>
          </div>
          <div className="text-gray-400 text-[12px] leading-relaxed">
            {message}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 py-2.5 bg-gray-700/50 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded-xl text-sm font-medium transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className={`flex-1 py-2.5 ${colors.bg} disabled:opacity-40 text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2`}
            >
              {loading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : null}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  },
);
ConfirmDialog.displayName = 'ConfirmDialog';

const EmptyState: FC<{
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}> = React.memo(({ icon, title, subtitle, action }) => (
  <div className="text-center py-16 px-4" role="status">
    <div className="opacity-15 mb-3 flex justify-center">{icon}</div>
    <p className="text-gray-600 text-sm font-medium">{title}</p>
    {subtitle && (
      <p className="text-gray-700 text-[11px] mt-1">{subtitle}</p>
    )}
    {action && (
      <button
        onClick={action.onClick}
        className="mt-3 text-blue-400 text-xs underline hover:text-blue-300 transition-colors"
      >
        {action.label}
      </button>
    )}
  </div>
));
EmptyState.displayName = 'EmptyState';

const ToastContainer: FC<{
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}> = React.memo(({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  const cfg: Record<
    ToastType,
    { icon: ReactNode; bg: string; text: string }
  > = {
    success: {
      icon: <CheckCircle size={14} className="text-emerald-400" />,
      bg: 'bg-emerald-500/8 border-emerald-500/20',
      text: 'text-emerald-300',
    },
    error: {
      icon: <AlertCircle size={14} className="text-red-400" />,
      bg: 'bg-red-500/8 border-red-500/20',
      text: 'text-red-300',
    },
    warning: {
      icon: <AlertTriangle size={14} className="text-amber-400" />,
      bg: 'bg-amber-500/8 border-amber-500/20',
      text: 'text-amber-300',
    },
    info: {
      icon: <Info size={14} className="text-blue-400" />,
      bg: 'bg-blue-500/8 border-blue-500/20',
      text: 'text-blue-300',
    },
  };

  return (
    <div className="space-y-2 mb-3" role="alert" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2 p-2.5 border rounded-xl text-[11px] animate-in slide-in-from-top-2 ${cfg[t.type].bg}`}
        >
          {cfg[t.type].icon}
          <span className={cfg[t.type].text}>{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="ml-auto text-gray-600 hover:text-gray-300 p-0.5"
            aria-label="Dismiss"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
});
ToastContainer.displayName = 'ToastContainer';

const PaginationControls: FC<{
  page: number;
  totalPages: number;
  showing: { from: number; to: number; total: number };
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}> = React.memo(
  ({
    page,
    totalPages,
    showing,
    canPrev,
    canNext,
    onPrev,
    onNext,
    onFirst,
    onLast,
  }) => {
    if (totalPages <= 1) return null;
    return (
      <div
        className="flex items-center justify-between px-4 py-2.5 border-t border-gray-800/40 text-[10px]"
        role="navigation"
        aria-label="Pagination"
      >
        <span className="text-gray-600">
          Showing {showing.from}–{showing.to} of {showing.total}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onFirst}
            disabled={!canPrev}
            className="p-1.5 text-gray-600 hover:text-white disabled:opacity-20 rounded-lg"
            aria-label="First page"
          >
            <ChevronsLeft size={12} />
          </button>
          <button
            onClick={onPrev}
            disabled={!canPrev}
            className="p-1.5 text-gray-600 hover:text-white disabled:opacity-20 rounded-lg"
            aria-label="Previous page"
          >
            <ChevronLeft size={12} />
          </button>
          <span className="px-2 text-gray-400 font-mono tabular-nums">
            {page + 1}/{totalPages}
          </span>
          <button
            onClick={onNext}
            disabled={!canNext}
            className="p-1.5 text-gray-600 hover:text-white disabled:opacity-20 rounded-lg"
            aria-label="Next page"
          >
            <ChevronRight size={12} />
          </button>
          <button
            onClick={onLast}
            disabled={!canNext}
            className="p-1.5 text-gray-600 hover:text-white disabled:opacity-20 rounded-lg"
            aria-label="Last page"
          >
            <ChevronsRight size={12} />
          </button>
        </div>
      </div>
    );
  },
);
PaginationControls.displayName = 'PaginationControls';

const StaleBadge: FC<{ lastRefresh: number | null }> = React.memo(
  ({ lastRefresh }) => {
    const [_forceRender, setForceRender] = useState(0);

    useEffect(() => {
      const id = window.setInterval(
        () => setForceRender(v => v + 1),
        10_000,
      );
      return () => window.clearInterval(id);
    }, []);

    if (!lastRefresh) return null;
    const age = Date.now() - lastRefresh;
    if (age < STALE_THRESHOLD_MS) return null;

    return (
      <span
        className="inline-flex items-center gap-1 text-[9px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 px-2 py-0.5 rounded-full"
        role="status"
      >
        <AlertTriangle size={8} />
        Data {Math.floor(age / 60_000)}m old
      </span>
    );
  },
);
StaleBadge.displayName = 'StaleBadge';

const ConnectionBadge: FC<{
  canFetch: boolean;
  isLive: boolean;
}> = React.memo(({ canFetch, isLive }) => {
  if (canFetch) {
    return (
      <span className="flex items-center gap-1.5 text-emerald-400 text-[9px]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        LIVE · Breeze API
      </span>
    );
  }
  if (isLive) {
    return (
      <span className="flex items-center gap-1 text-amber-500/70 text-[9px]">
        <Wifi size={10} />
        Awaiting validation
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-gray-700 text-[9px]">
      <WifiOff size={10} />
      Demo mode
    </span>
  );
});
ConnectionBadge.displayName = 'ConnectionBadge';

const SortableHeader: FC<{
  label: string;
  field: string;
  sortBy: string;
  sortDir: SortDir;
  onToggle: (field: string) => void;
  className?: string;
}> = React.memo(
  ({ label, field, sortBy, sortDir, onToggle, className = '' }) => (
    <th
      className={`px-3 py-2 font-semibold cursor-pointer select-none hover:text-gray-400 transition-colors ${className}`}
      onClick={() => onToggle(field)}
      role="columnheader"
      aria-sort={
        sortBy === field
          ? sortDir === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(field);
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === field && (
          <span className="text-blue-400">
            {sortDir === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </span>
    </th>
  ),
);
SortableHeader.displayName = 'SortableHeader';

/** Animated value display for summary cards */
const AnimatedValue: FC<{
  value: string;
  className?: string;
}> = React.memo(({ value, className = '' }) => (
  <div
    className={`transition-all duration-300 ease-out ${className}`}
    key={value}
  >
    {value}
  </div>
));
AnimatedValue.displayName = 'AnimatedValue';

// ═══════════════════════════════════════════════════════════════════════════
// §5  LOT STEPPER
// ═══════════════════════════════════════════════════════════════════════════

const LotStepper: FC<{
  lots: number;
  maxLots: number;
  lotSize: number;
  onChange: (l: number) => void;
}> = React.memo(({ lots, maxLots, lotSize, onChange }) => {
  const qty = lots * lotSize;
  const pct = maxLots > 0 ? Math.round((lots / maxLots) * 100) : 100;

  return (
    <div
      className="space-y-1.5"
      role="group"
      aria-label="Lot quantity selector"
    >
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(1, lots - 1))}
          disabled={lots <= 1}
          className="w-8 h-8 bg-gray-700/60 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg flex items-center justify-center transition-colors"
          aria-label="Decrease lots"
        >
          <Minus size={12} />
        </button>

        <div className="flex-1 relative">
          <input
            type="number"
            value={lots}
            min={1}
            max={maxLots}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v)) onChange(clamp(v, 1, maxLots));
            }}
            className="w-full text-center bg-[#0a0c15] border border-gray-700/40 focus:border-blue-500/60 text-white text-sm font-bold rounded-xl py-1.5 mono outline-none transition-colors"
            aria-label={`Lots: ${lots} of ${maxLots}`}
          />
          <div className="absolute -top-2.5 left-0 right-0 flex justify-between text-[8px] text-gray-700 px-1">
            <span>1</span>
            <span>max {maxLots}</span>
          </div>
        </div>

        <button
          onClick={() => onChange(Math.min(maxLots, lots + 1))}
          disabled={lots >= maxLots}
          className="w-8 h-8 bg-gray-700/60 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg flex items-center justify-center transition-colors"
          aria-label="Increase lots"
        >
          <Plus size={12} />
        </button>

        <Edit3
          size={9}
          className="text-gray-700 flex-shrink-0"
          aria-hidden
        />
      </div>

      <div className="bg-[#0e1018] rounded-xl px-3 py-2 border border-gray-800/40 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-gray-600">
            {lots} lot{lots !== 1 ? 's' : ''} ×{' '}
            <span className="text-amber-400 font-bold">{lotSize}</span>{' '}
            =
          </div>
          <div className="text-white font-black text-base mono">
            {qty}{' '}
            <span className="text-gray-600 text-[10px] font-normal">
              qty
            </span>
          </div>
          {lots < maxLots && (
            <div className="text-[9px] text-blue-400/60">
              ({maxLots - lots} remaining)
            </div>
          )}
        </div>
        <div className="h-1 bg-gray-800/60 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-[8px] text-gray-700 text-right">
          {pct}% of position
        </div>
      </div>
    </div>
  );
});
LotStepper.displayName = 'LotStepper';

// ═══════════════════════════════════════════════════════════════════════════
// §6  SQUARE OFF MODAL
// ═══════════════════════════════════════════════════════════════════════════

const SquareOffModal: FC<{
  pos: Position;
  backendUrl: string;
  onClose: () => void;
  onOrdersPlaced: () => void;
}> = ({ pos, backendUrl, onClose, onOrdersPlaced }) => {
  const cfg =
    SYMBOL_CONFIG[pos.symbol as SymbolCode] ?? SYMBOL_CONFIG['NIFTY'];

  const [step, setStep] = useState<'configure' | 'confirm' | 'done'>(
    'configure',
  );
  const [legs, setLegs] = useState<SqOffLeg[]>(() =>
    pos.legs.map((l, i) => ({
      legIndex: i,
      type: l.type,
      strike: l.strike,
      origAction: l.action,
      exitAction: l.action === 'BUY' ? 'SELL' : 'BUY',
      maxLots: Math.max(l.lots, 1),
      lots: Math.max(l.lots, 1),
      lotSize: cfg.lotSize,
      entryPrice: l.entryPrice,
      currentPrice: l.currentPrice,
      pnl: l.pnl,
      selected: true,
      limitPrice: l.currentPrice.toFixed(2),
      orderType: 'market' as OrderType,
      status: 'idle' as const,
      resultMsg: '',
    })),
  );
  const [placing, setPlacing] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);

  const { selected, totalPnlEst } = useMemo(() => {
    const sel = legs.filter(l => l.selected);
    const pnl = sel.reduce(
      (s, l) =>
        s + (l.pnl / Math.max(l.maxLots, 1)) * l.lots,
      0,
    );
    return { selected: sel, totalPnlEst: pnl };
  }, [legs]);

  const upd = useCallback(
    (idx: number, patch: Partial<SqOffLeg>) =>
      setLegs(prev =>
        prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
      ),
    [],
  );

  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    for (const leg of selected) {
      if (leg.orderType === 'limit') {
        const err = validateLimitPrice(leg.limitPrice);
        if (err) errs.push(`${leg.type} ${leg.strike}: ${err}`);
      }
    }
    return errs;
  }, [selected]);

  const handleExecute = async () => {
    if (selected.length === 0) return;
    setPlacing(true);
    const msgs: string[] = [];

    for (const leg of selected) {
      upd(leg.legIndex, { status: 'placing' });
      const qty = leg.lots * leg.lotSize;
      try {
        const r = await withRetry(() =>
          squareOffPosition(backendUrl, {
            stockCode: cfg.breezeStockCode,
            exchangeCode: cfg.breezeExchangeCode,
            action: leg.origAction,
            quantity: String(qty),
            expiryDate: pos.expiry,
            right: leg.type === 'CE' ? 'call' : 'put',
            strikePrice: String(leg.strike),
            orderType: leg.orderType,
            price:
              leg.orderType === 'limit' ? leg.limitPrice : '0',
          }),
        );
        if (r.ok) {
          upd(leg.legIndex, {
            status: 'done',
            resultMsg: `✓ OrderID: ${r.orderId ?? 'placed'}`,
          });
          msgs.push(
            `✓ ${leg.type} ${leg.strike.toLocaleString('en-IN')} EXIT ${leg.exitAction} ${leg.lots}L (${qty}qty) → ${r.orderId ?? 'OK'}`,
          );
        } else {
          upd(leg.legIndex, {
            status: 'error',
            resultMsg: r.error ?? 'Failed',
          });
          msgs.push(
            `✗ ${leg.type} ${leg.strike.toLocaleString('en-IN')}: ${r.error ?? 'error'}`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        upd(leg.legIndex, { status: 'error', resultMsg: msg });
        msgs.push(
          `✗ ${leg.type} ${leg.strike.toLocaleString('en-IN')}: ${msg}`,
        );
      }
    }

    setResults(msgs);
    setStep('done');
    setPlacing(false);
    onOrdersPlaced();
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Square Off Position"
    >
      {/* FIX: stopPropagation on inner container prevents escape from leaking to backdrop */}
      <div
        ref={trapRef}
        className="bg-[#13161f] border border-gray-700/60 rounded-2xl shadow-2xl w-full max-w-[700px] max-h-[92vh] flex flex-col overflow-hidden"
        onKeyDown={e => {
          if (e.key === 'Escape' && !placing) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800/60 flex-shrink-0">
          <div className="w-10 h-10 bg-red-500/15 border border-red-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <ShieldAlert size={18} className="text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-sm">
              Square Off — Partial or Full Exit
            </h2>
            <p className="text-gray-600 text-[10px]">
              {cfg.displayName} · {pos.strategy} · 1 lot ={' '}
              <span className="text-amber-400 font-bold">
                {cfg.lotSize}
              </span>{' '}
              qty
            </p>
          </div>

          <nav
            className="flex items-center gap-1 text-[9px] font-semibold flex-shrink-0"
            aria-label="Progress"
          >
            {(() => {
              // FIX: compute step index once, outside .map(), so we don't
              // allocate a new array + do a linear search on every iteration.
              const STEP_ORDER = ['configure', 'confirm', 'done'] as const;
              const si = STEP_ORDER.indexOf(step);
              return STEP_ORDER.map((s, i) => (
                  <React.Fragment key={s}>
                    <span
                      className={`px-2 py-0.5 rounded-full border ${
                        step === s
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : si > i
                            ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400'
                            : 'bg-gray-800/40 border-gray-700/20 text-gray-600'
                      }`}
                      aria-current={
                        step === s ? 'step' : undefined
                      }
                    >
                      {i + 1}.{' '}
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </span>
                    {i < 2 && (
                      <span
                        className="text-gray-700"
                        aria-hidden
                      >
                        →
                      </span>
                    )}
                  </React.Fragment>
              ));
            })()}
          </nav>

          <button
            onClick={onClose}
            disabled={placing}
            className="ml-2 p-1.5 text-gray-600 hover:text-white hover:bg-gray-700/50 rounded-lg flex-shrink-0 disabled:opacity-30"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* DONE */}
          {step === 'done' && (
            <div className="space-y-3">
              <div className="text-center py-4">
                <CheckCircle
                  size={44}
                  className="text-emerald-400 mx-auto mb-3"
                />
                <h3 className="text-white font-bold text-base">
                  Exit Orders Placed
                </h3>
              </div>

              <div
                className="bg-[#0e1018] rounded-xl border border-gray-800/40 p-4 space-y-2"
                role="log"
              >
                {results.map((r, i) => (
                  <p
                    key={i}
                    className={`text-xs font-mono ${r.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {r}
                  </p>
                ))}
              </div>

              <div className="space-y-2">
                {legs.map((leg, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-3 rounded-xl border text-[11px] ${
                      leg.status === 'done'
                        ? 'bg-emerald-500/5 border-emerald-500/20'
                        : leg.status === 'error'
                          ? 'bg-red-500/5 border-red-500/20'
                          : 'bg-gray-800/20 border-gray-700/20 opacity-40'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`font-bold text-sm ${leg.type === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}
                      >
                        {leg.type}
                      </span>
                      <span className="text-white font-bold mono">
                        {leg.strike.toLocaleString('en-IN')}
                      </span>
                      <span className="text-gray-600 text-[9px] font-mono">
                        {leg.lots}L×{leg.lotSize}=
                        <span className="text-white font-bold">
                          {leg.lots * leg.lotSize}
                        </span>
                      </span>
                    </div>
                    <span
                      className={
                        leg.status === 'done'
                          ? 'text-emerald-400'
                          : leg.status === 'error'
                            ? 'text-red-400'
                            : 'text-gray-600'
                      }
                    >
                      {leg.resultMsg ||
                        (leg.selected ? '—' : 'not selected')}
                    </span>
                  </div>
                ))}
              </div>

              <button
                onClick={onClose}
                className="w-full py-2.5 bg-gray-700/60 hover:bg-gray-700 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {/* CONFIGURE */}
          {step === 'configure' && (
            <>
              <div
                className={`flex items-center justify-between p-4 rounded-2xl border ${
                  totalPnlEst >= 0
                    ? 'bg-emerald-500/8 border-emerald-500/25'
                    : 'bg-red-500/8 border-red-500/25'
                }`}
              >
                <div>
                  <div className="text-gray-500 text-[10px] mb-0.5">
                    Estimated Exit P&L ({selected.length}/
                    {legs.length} legs)
                  </div>
                  <div
                    className={`text-3xl font-black mono ${totalPnlEst >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {totalPnlEst >= 0 ? '+' : ''}₹
                    {Math.round(totalPnlEst).toLocaleString(
                      'en-IN',
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-gray-600 text-[10px]">
                    {pos.strategy}
                  </div>
                  <div className="text-white text-xs font-semibold">
                    {pos.expiry}
                  </div>
                  <div className="text-amber-400 text-[10px] font-bold mt-1">
                    1 lot = {cfg.lotSize} qty
                  </div>
                </div>
              </div>

              <div
                className="flex items-center gap-2 flex-wrap"
                role="toolbar"
                aria-label="Leg controls"
              >
                <span className="text-gray-600 text-[10px] font-semibold">
                  All legs:
                </span>
                <button
                  onClick={() =>
                    setLegs(p =>
                      p.map(l => ({
                        ...l,
                        orderType: 'market' as OrderType,
                      })),
                    )
                  }
                  className="px-3 py-1 bg-amber-600/15 hover:bg-amber-600/25 border border-amber-500/30 text-amber-300 text-[10px] rounded-lg transition-colors font-semibold"
                >
                  Market
                </button>
                <button
                  onClick={() =>
                    setLegs(p =>
                      p.map(l => ({
                        ...l,
                        orderType: 'limit' as OrderType,
                      })),
                    )
                  }
                  className="px-3 py-1 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-blue-300 text-[10px] rounded-lg transition-colors font-semibold"
                >
                  Limit
                </button>
                <button
                  onClick={() =>
                    setLegs(p =>
                      p.map(l => ({ ...l, lots: l.maxLots })),
                    )
                  }
                  className="px-3 py-1 bg-gray-700/40 hover:bg-gray-700/60 border border-gray-600/30 text-gray-400 text-[10px] rounded-lg transition-colors"
                >
                  Full Exit
                </button>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() =>
                      setLegs(p =>
                        p.map(l => ({ ...l, selected: true })),
                      )
                    }
                    className="text-blue-400 text-[10px] hover:underline"
                  >
                    All
                  </button>
                  <button
                    onClick={() =>
                      setLegs(p =>
                        p.map(l => ({ ...l, selected: false })),
                      )
                    }
                    className="text-gray-600 text-[10px] hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {legs.map((leg, i) => (
                  <div
                    key={i}
                    className={`rounded-2xl border transition-all ${
                      leg.selected
                        ? leg.type === 'CE'
                          ? 'bg-blue-950/15 border-blue-700/40'
                          : 'bg-orange-950/15 border-orange-700/40'
                        : 'bg-gray-900/30 border-gray-800/20 opacity-40'
                    }`}
                  >
                    <div className="p-4 space-y-4">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() =>
                            upd(i, {
                              selected: !leg.selected,
                            })
                          }
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                            leg.selected
                              ? 'bg-blue-600 border-blue-500'
                              : 'border-gray-600'
                          }`}
                          aria-pressed={leg.selected}
                          aria-label={`${leg.selected ? 'Deselect' : 'Select'} ${leg.type} ${leg.strike}`}
                        >
                          {leg.selected && (
                            <CheckCircle
                              size={11}
                              className="text-white"
                            />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-sm font-black ${leg.type === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}
                            >
                              {leg.type}
                            </span>
                            <span className="text-white font-bold text-sm mono">
                              {leg.strike.toLocaleString(
                                'en-IN',
                              )}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                                leg.origAction === 'BUY'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-red-500/15 text-red-400'
                              }`}
                            >
                              ENTRY: {leg.origAction}
                            </span>
                            <ArrowUpDown
                              size={10}
                              className="text-gray-600"
                              aria-hidden
                            />
                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-md border ${
                                leg.exitAction === 'BUY'
                                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                  : 'bg-red-500/20 border-red-500/40 text-red-300'
                              }`}
                            >
                              EXIT: {leg.exitAction}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-[10px] mt-1.5">
                            <span className="text-gray-600">
                              Entry:{' '}
                              <span className="text-gray-400 mono font-semibold">
                                ₹{leg.entryPrice.toFixed(2)}
                              </span>
                            </span>
                            <span className="text-gray-600">
                              LTP:{' '}
                              <span className="text-white font-bold mono">
                                ₹
                                {leg.currentPrice.toFixed(2)}
                              </span>
                            </span>
                            <span
                              className={`font-bold mono ${leg.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                            >
                              {leg.pnl >= 0 ? '+' : ''}₹
                              {leg.pnl.toFixed(0)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {leg.selected && (
                        <>
                          <div className="border-t border-gray-800/30 pt-3">
                            <div className="text-[10px] text-gray-500 font-semibold mb-2 flex items-center gap-1.5">
                              <Edit3
                                size={9}
                                className="text-blue-400"
                              />
                              Lots to exit{' '}
                              <span className="text-gray-700 font-normal">
                                (max {leg.maxLots})
                              </span>
                            </div>
                            <LotStepper
                              lots={leg.lots}
                              maxLots={leg.maxLots}
                              lotSize={leg.lotSize}
                              onChange={lots =>
                                upd(i, { lots })
                              }
                            />
                          </div>

                          <div className="border-t border-gray-800/30 pt-3">
                            <div className="text-[10px] text-gray-500 font-semibold mb-2">
                              Order Type
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <div
                                className="flex rounded-xl overflow-hidden border border-gray-700/50 text-[10px]"
                                role="radiogroup"
                                aria-label="Order type"
                              >
                                {(
                                  [
                                    'market',
                                    'limit',
                                  ] as const
                                ).map(ot => (
                                  <button
                                    key={ot}
                                    onClick={() =>
                                      upd(i, {
                                        orderType: ot,
                                      })
                                    }
                                    role="radio"
                                    aria-checked={
                                      leg.orderType === ot
                                    }
                                    className={`px-4 py-2 font-bold transition-colors ${
                                      leg.orderType === ot
                                        ? ot === 'market'
                                          ? 'bg-amber-600 text-white'
                                          : 'bg-blue-600 text-white'
                                        : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
                                    }`}
                                  >
                                    {ot.toUpperCase()}
                                  </button>
                                ))}
                              </div>

                              {leg.orderType === 'limit' && (() => {
                                // FIX: compute once, not 3-4× per render
                                const limitPriceErr = validateLimitPrice(leg.limitPrice);
                                return (
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-gray-500 text-[10px] flex-shrink-0">
                                    ₹
                                  </span>
                                  <input
                                    type="number"
                                    value={leg.limitPrice}
                                    onChange={e =>
                                      upd(i, {
                                        limitPrice:
                                          e.target.value,
                                      })
                                    }
                                    step="0.05"
                                    min="0.05"
                                    className={`w-28 bg-[#0a0c15] border focus:border-blue-400 text-white text-sm rounded-xl px-3 py-1.5 mono outline-none text-right transition-colors ${
                                      limitPriceErr
                                        ? 'border-red-500/50'
                                        : 'border-blue-500/50'
                                    }`}
                                    aria-label="Limit price"
                                    aria-invalid={!!limitPriceErr}
                                  />
                                  {limitPriceErr && (
                                    <span className="text-red-400 text-[9px]">
                                      {limitPriceErr}
                                    </span>
                                  )}
                                </div>
                                );
                              })()}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* CONFIRM */}
          {step === 'confirm' && (
            <>
              <div
                className={`p-4 rounded-2xl border ${
                  totalPnlEst >= 0
                    ? 'bg-emerald-500/8 border-emerald-500/25'
                    : 'bg-red-500/8 border-red-500/25'
                }`}
              >
                <div className="text-gray-500 text-[10px] mb-1">
                  Estimated Exit P&L — {selected.length} leg
                  {selected.length !== 1 ? 's' : ''}
                </div>
                <div
                  className={`text-2xl font-black mono ${totalPnlEst >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {totalPnlEst >= 0 ? '+' : ''}₹
                  {Math.round(totalPnlEst).toLocaleString(
                    'en-IN',
                  )}
                </div>
              </div>

              <div className="bg-[#0e1018] rounded-2xl border border-gray-800/40 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-800/40 text-[9px] text-gray-700 uppercase tracking-wider font-semibold">
                  Order Summary
                </div>
                <table
                  className="w-full text-[11px]"
                  role="table"
                >
                  <thead>
                    <tr className="text-gray-600 text-[9px] border-b border-gray-800/30">
                      <th className="px-4 py-2 text-left">
                        Instrument
                      </th>
                      <th className="px-4 py-2 text-center">
                        Exit
                      </th>
                      <th className="px-4 py-2 text-right">
                        Lots
                      </th>
                      <th className="px-4 py-2 text-right bg-amber-500/5">
                        Qty
                      </th>
                      <th className="px-4 py-2 text-center">
                        Type
                      </th>
                      <th className="px-4 py-2 text-right">
                        Price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((leg, i) => {
                      const q = leg.lots * leg.lotSize;
                      return (
                        <tr
                          key={i}
                          className="border-b border-gray-800/20 last:border-0"
                        >
                          <td className="px-4 py-3 mono">
                            <span
                              className={`font-bold ${leg.type === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}
                            >
                              {leg.type}
                            </span>{' '}
                            <span className="text-white font-semibold">
                              {leg.strike.toLocaleString(
                                'en-IN',
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`text-[9px] font-bold px-2 py-1 rounded-lg ${
                                leg.exitAction === 'BUY'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-red-500/20 text-red-300'
                              }`}
                            >
                              {leg.exitAction}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right mono text-amber-400 font-bold">
                            {leg.lots}
                          </td>
                          <td className="px-4 py-3 text-right bg-amber-500/5">
                            <div className="mono font-black text-white">
                              {q}
                            </div>
                            <div className="text-[8px] text-gray-700">
                              {leg.lots}×{leg.lotSize}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-lg ${
                                leg.orderType === 'market'
                                  ? 'bg-amber-500/15 text-amber-300'
                                  : 'bg-blue-500/15 text-blue-300'
                              }`}
                            >
                              {leg.orderType.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right mono">
                            {leg.orderType === 'market' ? (
                              <span className="text-gray-500">
                                at market
                              </span>
                            ) : (
                              <span className="text-blue-300 font-bold">
                                ₹{leg.limitPrice}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div
                className="flex gap-2.5 p-3.5 bg-red-500/8 border border-red-500/25 rounded-xl"
                role="alert"
              >
                <AlertTriangle
                  size={14}
                  className="text-red-400 flex-shrink-0 mt-0.5"
                />
                <div className="text-[11px] text-red-300 space-y-0.5">
                  <p className="font-bold text-red-200">
                    LIVE orders via ICICI Breeze API. Cannot be
                    undone.
                  </p>
                  <p>
                    {selected.length} exit order
                    {selected.length > 1 ? 's' : ''} will
                    execute immediately.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {step !== 'done' && (
          <div className="flex gap-3 px-5 py-4 border-t border-gray-800/60 flex-shrink-0">
            {step === 'configure' ? (
              <>
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  disabled={
                    selected.length === 0 ||
                    validationErrors.length > 0
                  }
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                  title={
                    validationErrors.length > 0
                      ? validationErrors.join('; ')
                      : undefined
                  }
                >
                  <Target size={14} />
                  Review ({selected.length})
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setStep('configure')}
                  className="flex-1 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleExecute}
                  disabled={placing}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-black transition-colors flex items-center justify-center gap-2"
                >
                  {placing ? (
                    <>
                      <RefreshCw
                        size={14}
                        className="animate-spin"
                      />
                      Placing…
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={14} />
                      Confirm Square Off
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {step === 'configure' && validationErrors.length > 0 && (
          <div className="px-5 pb-3">
            <div className="p-2.5 bg-red-500/8 border border-red-500/20 rounded-xl text-[10px] text-red-300 space-y-0.5">
              {validationErrors.map((e, i) => (
                <p key={i}>⚠ {e}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// §7  TRADE OPTIONS PANEL
// ═══════════════════════════════════════════════════════════════════════════

const TradeOptionsPanel: FC<{
  backendUrl: string;
  symbol: SymbolCode;
  expiry: string;
  onDone: () => void;
}> = React.memo(({ backendUrl, symbol, expiry, onDone }) => {
  const cfg = SYMBOL_CONFIG[symbol];

  const [optType, setOptType] = useState<'CE' | 'PE'>('CE');
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [strike, setStrike] = useState('');
  const [lots, setLots] = useState(1);
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const qty = lots * cfg.lotSize;
  const strikeError = strike
    ? validateStrike(strike, cfg.strikeStep)
    : null;
  const priceError =
    orderType === 'limit' && limitPrice
      ? validateLimitPrice(limitPrice)
      : null;
  const canSubmit =
    !!strike &&
    !strikeError &&
    !priceError &&
    (orderType !== 'limit' || !!limitPrice) &&
    !!expiry;

  useEffect(() => {
    setResult(null);
  }, [optType, action, strike, lots, orderType, limitPrice]);

  const resetForm = useCallback(() => {
    setStrike('');
    setLots(1);
    setLimitPrice('');
    setOrderType('market');
  }, []);

  const handlePlace = async () => {
    setShowConfirm(false);
    setPlacing(true);
    setResult(null);
    try {
      const r = await withRetry(() =>
        placeOrder(backendUrl, {
          stockCode: cfg.breezeStockCode,
          exchangeCode: cfg.breezeExchangeCode,
          action,
          quantity: String(qty),
          expiryDate: expiry,
          right: optType === 'CE' ? 'call' : 'put',
          strikePrice: strike,
          orderType,
          price: orderType === 'limit' ? limitPrice : '0',
        }),
      );
      setResult({
        ok: r.ok,
        msg: r.ok
          ? `✓ Order placed! ID: ${r.orderId ?? 'N/A'}`
          : `✗ ${r.error ?? 'Failed'}`,
      });
      if (r.ok) {
        resetForm();
        onDone();
      }
    } catch (e) {
      setResult({
        ok: false,
        msg: `✗ ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    setPlacing(false);
  };

  return (
    <div className="p-4 space-y-4 max-w-[520px] mx-auto">
      <div className="bg-[#1a1d2e] rounded-2xl border border-gray-700/30 p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={14} className="text-blue-400" />
          <span className="text-white font-bold text-sm">
            Place Option Order
          </span>
        </div>

        <div className="flex items-center gap-2 p-2.5 bg-blue-500/8 border border-blue-500/20 rounded-xl text-[11px]">
          <Info
            size={11}
            className="text-blue-400 flex-shrink-0"
          />
          <span className="text-blue-300">
            {cfg.displayName} · Expiry:{' '}
            <strong>
              {expiry || (
                <span className="text-red-400">not set</span>
              )}
            </strong>{' '}
            · Lot:{' '}
            <strong className="text-amber-400">
              {cfg.lotSize}
            </strong>
          </span>
        </div>

        {/* Option Type */}
        <fieldset>
          <legend className="text-gray-500 text-[10px] font-semibold mb-1.5">
            Option Type
          </legend>
          <div
            className="flex rounded-xl overflow-hidden border border-gray-700/40"
            role="radiogroup"
          >
            {(['CE', 'PE'] as const).map(t => (
              <button
                key={t}
                onClick={() => setOptType(t)}
                role="radio"
                aria-checked={optType === t}
                className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                  optType === t
                    ? t === 'CE'
                      ? 'bg-blue-600 text-white'
                      : 'bg-orange-600 text-white'
                    : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
                }`}
              >
                {t} — {t === 'CE' ? 'Call' : 'Put'}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Action */}
        <fieldset>
          <legend className="text-gray-500 text-[10px] font-semibold mb-1.5">
            Action
          </legend>
          <div
            className="flex rounded-xl overflow-hidden border border-gray-700/40"
            role="radiogroup"
          >
            {(['BUY', 'SELL'] as const).map(a => (
              <button
                key={a}
                onClick={() => setAction(a)}
                role="radio"
                aria-checked={action === a}
                className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                  action === a
                    ? a === 'BUY'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 text-white'
                    : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Strike */}
        <div>
          <label
            htmlFor="strike-input"
            className="text-gray-500 text-[10px] font-semibold mb-1.5 block"
          >
            Strike{' '}
            <span className="text-gray-700">
              (step ₹{cfg.strikeStep})
            </span>
          </label>
          <input
            id="strike-input"
            type="number"
            value={strike}
            onChange={e => setStrike(e.target.value)}
            placeholder={`e.g. ${symbol === 'NIFTY' ? '24500' : '80000'}`}
            step={cfg.strikeStep}
            min={cfg.strikeStep}
            className={`w-full bg-[#0a0c15] border text-white text-sm rounded-xl px-4 py-2.5 mono outline-none transition-colors ${
              strikeError
                ? 'border-red-500/60'
                : 'border-gray-700/40 focus:border-blue-500/60'
            }`}
            aria-invalid={!!strikeError}
          />
          {strikeError && (
            <p className="text-red-400 text-[10px] mt-1">
              ⚠ {strikeError}
            </p>
          )}
        </div>

        {/* Lots */}
        <div>
          <label className="text-gray-500 text-[10px] font-semibold mb-2 block">
            Lots
          </label>
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => setLots(l => Math.max(1, l - 1))}
              disabled={lots <= 1}
              className="w-10 h-10 bg-gray-700/60 hover:bg-gray-600 disabled:opacity-30 text-white rounded-xl flex items-center justify-center"
              aria-label="Decrease"
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              value={lots}
              min={1}
              max={100}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v))
                  setLots(clamp(v, 1, 100));
              }}
              className="flex-1 text-center bg-[#0a0c15] border border-gray-700/40 text-white text-lg rounded-xl py-2 mono outline-none font-bold"
              aria-label="Lots"
            />
            <button
              onClick={() =>
                setLots(l => Math.min(100, l + 1))
              }
              disabled={lots >= 100}
              className="w-10 h-10 bg-gray-700/60 hover:bg-gray-600 disabled:opacity-30 text-white rounded-xl flex items-center justify-center"
              aria-label="Increase"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="bg-[#0e1018] rounded-xl border border-gray-800/40 px-4 py-2.5 flex items-center justify-between">
            <span className="text-gray-600 text-[11px]">
              {lots}L ×{' '}
              <span className="text-amber-400 font-bold">
                {cfg.lotSize}
              </span>{' '}
              =
            </span>
            <span className="text-white font-black text-xl mono">
              {qty}{' '}
              <span className="text-gray-600 text-[10px] font-normal">
                qty
              </span>
            </span>
          </div>
        </div>

        {/* Order Type */}
        <fieldset>
          <legend className="text-gray-500 text-[10px] font-semibold mb-1.5">
            Order Type
          </legend>
          <div
            className="flex rounded-xl overflow-hidden border border-gray-700/40"
            role="radiogroup"
          >
            {(['market', 'limit'] as const).map(ot => (
              <button
                key={ot}
                onClick={() => setOrderType(ot)}
                role="radio"
                aria-checked={orderType === ot}
                className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                  orderType === ot
                    ? ot === 'market'
                      ? 'bg-amber-600 text-white'
                      : 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
                }`}
              >
                {ot.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>

        {orderType === 'limit' && (
          <div>
            <label
              htmlFor="limit-price"
              className="text-gray-500 text-[10px] font-semibold mb-1.5 block"
            >
              Limit Price (₹)
            </label>
            <input
              id="limit-price"
              type="number"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              placeholder="125.50"
              step="0.05"
              min="0.05"
              className={`w-full bg-[#0a0c15] border text-white text-sm rounded-xl px-4 py-2.5 mono outline-none transition-colors ${
                priceError
                  ? 'border-red-500/50'
                  : 'border-blue-500/50 focus:border-blue-400'
              }`}
              aria-invalid={!!priceError}
            />
            {priceError && (
              <p className="text-red-400 text-[10px] mt-1">
                ⚠ {priceError}
              </p>
            )}
          </div>
        )}

        {/* Preview */}
        {strike && !strikeError && (
          <div
            className={`p-3 rounded-xl border text-[11px] ${
              action === 'BUY'
                ? 'bg-emerald-500/6 border-emerald-500/20'
                : 'bg-red-500/6 border-red-500/20'
            }`}
          >
            <div className="text-gray-500 text-[9px] mb-1 uppercase tracking-wider">
              Preview
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span
                className={`font-black text-base ${action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {action}
              </span>
              <span
                className={`font-bold ${optType === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}
              >
                {optType}
              </span>
              <span className="text-white font-bold mono">
                {strike}
              </span>
              <span className="text-gray-500">·</span>
              <span className="text-amber-400 font-bold">
                {lots}L={qty}qty
              </span>
              <span className="text-gray-500">·</span>
              <span
                className={
                  orderType === 'market'
                    ? 'text-amber-400'
                    : 'text-blue-400'
                }
              >
                {orderType === 'market'
                  ? 'MARKET'
                  : `LIMIT ₹${limitPrice}`}
              </span>
            </div>
          </div>
        )}

        {result && (
          <div
            className={`p-3 rounded-xl border text-[11px] font-mono ${
              result.ok
                ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300'
                : 'bg-red-500/8 border-red-500/25 text-red-300'
            }`}
            role="alert"
          >
            {result.msg}
          </div>
        )}

        <button
          onClick={() => setShowConfirm(true)}
          disabled={placing || !canSubmit}
          className={`w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-black transition-colors flex items-center justify-center gap-2 ${
            action === 'BUY'
              ? 'bg-emerald-600 hover:bg-emerald-500'
              : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          {placing ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              Placing…
            </>
          ) : (
            <>
              <Crosshair size={14} />
              {action} {lots}L {optType}{' '}
              {strike ? `@ ${strike}` : ''}
            </>
          )}
        </button>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Live Order"
        variant={action === 'SELL' ? 'danger' : 'warning'}
        confirmLabel={`${action} Now`}
        loading={placing}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handlePlace}
        message={
          <div className="space-y-2">
            <p>
              Place a{' '}
              <strong className="text-white">{action}</strong>{' '}
              order:
            </p>
            <div className="bg-[#0a0c15] rounded-xl p-3 text-[11px] font-mono space-y-1 border border-gray-800/40">
              <p>
                <span className="text-gray-500">
                  Instrument:
                </span>{' '}
                <span className="text-white">
                  {cfg.displayName} {strike} {optType}
                </span>
              </p>
              <p>
                <span className="text-gray-500">Qty:</span>{' '}
                <span className="text-amber-400">
                  {lots}L×{cfg.lotSize}={qty}
                </span>
              </p>
              <p>
                <span className="text-gray-500">Type:</span>{' '}
                <span
                  className={
                    orderType === 'market'
                      ? 'text-amber-400'
                      : 'text-blue-400'
                  }
                >
                  {orderType.toUpperCase()}
                </span>{' '}
                {orderType === 'limit' && (
                  <span className="text-blue-300">
                    ₹{limitPrice}
                  </span>
                )}
              </p>
            </div>
            <p className="text-red-300 text-[10px] font-semibold">
              ⚠ LIVE order — verify carefully.
            </p>
          </div>
        }
      />
    </div>
  );
});
TradeOptionsPanel.displayName = 'TradeOptionsPanel';

// ═══════════════════════════════════════════════════════════════════════════
// §8  FUNDS DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

const FundsDashboard: FC<{
  funds: FundsData | null;
  loading: boolean;
  onRefresh: () => void;
  canFetch: boolean;
  lastRefresh: number | null;
}> = React.memo(
  ({ funds, loading, onRefresh, canFetch, lastRefresh }) => {
    if (!canFetch) {
      return (
        <EmptyState
          icon={<DollarSign size={36} />}
          title="Connect backend to view funds"
          subtitle="Connect Broker → Kaggle URL → Validate"
        />
      );
    }

    if (loading && !funds) {
      return (
        <div className="p-4 grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="rounded-2xl border border-gray-800/20 p-4 animate-pulse"
            >
              <div className="h-2 bg-gray-800/40 rounded w-1/2 mb-3" />
              <div className="h-6 bg-gray-800/60 rounded w-3/4" />
            </div>
          ))}
        </div>
      );
    }

    if (!funds) {
      return (
        <EmptyState
          icon={<DollarSign size={36} />}
          title="Funds unavailable"
          action={{ label: 'Retry', onClick: onRefresh }}
        />
      );
    }

    const fr = funds as Record<string, unknown>;
    const avail = asNumber(fr.available_margin);
    const used = asNumber(fr.utilized_margin);
    const total = Math.max(avail + used, 1);
    const pct = Math.min(100, (used / total) * 100);

    const items = [
      {
        label: 'Cash Balance',
        key: 'cash_balance',
        color: 'text-emerald-400',
        bg: 'border-emerald-500/20 bg-emerald-500/4',
      },
      {
        label: 'Net Amount',
        key: 'net_amount',
        color: 'text-blue-400',
        bg: 'border-blue-500/20 bg-blue-500/4',
      },
      {
        label: 'Available Margin',
        key: 'available_margin',
        color: 'text-purple-400',
        bg: 'border-purple-500/20 bg-purple-500/4',
      },
      {
        label: 'Utilized Margin',
        key: 'utilized_margin',
        color: 'text-amber-400',
        bg: 'border-amber-500/20 bg-amber-500/4',
      },
    ];

    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-sm">
            Funds & Margin
          </h3>
          <div className="flex items-center gap-2">
            <StaleBadge lastRefresh={lastRefresh} />
            <button
              onClick={onRefresh}
              className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg transition-colors"
              aria-label="Refresh"
            >
              <RefreshCw
                size={12}
                className={loading ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map(it => (
            <div
              key={it.key}
              className={`rounded-2xl border p-4 ${it.bg}`}
            >
              <div className="text-gray-600 text-[10px] mb-1">
                {it.label}
              </div>
              <div
                className={`font-black text-xl mono ${it.color}`}
              >
                ₹
                {asNumber(fr[it.key]).toLocaleString('en-IN', {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-gray-700/40 bg-[#0e1018] p-3">
          <div className="flex items-center justify-between text-[10px] mb-2">
            <span className="text-gray-500">
              Margin utilization
            </span>
            <span
              className={`mono font-bold ${pct > 80 ? 'text-red-400' : pct > 50 ? 'text-amber-300' : 'text-emerald-400'}`}
            >
              {pct.toFixed(1)}%
            </span>
          </div>
          <div
            className="h-2.5 bg-gray-800/80 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                pct > 80
                  ? 'bg-gradient-to-r from-amber-500 to-red-500'
                  : pct > 50
                    ? 'bg-gradient-to-r from-emerald-500 to-amber-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 text-[10px] text-gray-600 flex justify-between">
            <span>
              Used: ₹
              {used.toLocaleString('en-IN', {
                maximumFractionDigits: 2,
              })}
            </span>
            <span>
              Total: ₹
              {total.toLocaleString('en-IN', {
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
      </div>
    );
  },
);
FundsDashboard.displayName = 'FundsDashboard';

// ═══════════════════════════════════════════════════════════════════════════
// §9  ORDER BOOK TABLE
// ═══════════════════════════════════════════════════════════════════════════

const OrderBookTable: FC<{
  orders: OrderBookRow[];
  loading: boolean;
  canFetch: boolean;
  onRefresh: () => void;
  onCancel: (id: string, ex: string) => Promise<void>;
  lastRefresh: number | null;
  onBatchCancel?: () => void;
}> = React.memo(
  ({
    orders,
    loading,
    canFetch,
    onRefresh,
    onCancel,
    lastRefresh,
    onBatchCancel,
  }) => {
    const [cancelling, setCancelling] = useState<string | null>(
      null,
    );
    const [cancelTarget, setCancelTarget] =
      useState<OrderBookRow | null>(null);
    const [query, setQuery] = useState('');
    const dq = useDebounce(query, DEBOUNCE_MS);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState('timestamp');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const filtered = useMemo(() => {
      const q = dq.trim().toLowerCase();
      if (!q) return orders;
      return orders.filter(r =>
        [
          r.order_id,
          r.stock_code,
          r.status,
          r.action,
          r.right,
          r.strike_price,
        ].some(v =>
          String(v ?? '')
            .toLowerCase()
            .includes(q),
        ),
      );
    }, [orders, dq]);

    const sorted = useMemo(
      () =>
        [...filtered].sort((a, b) => {
          let c = 0;
          if (sortBy === 'timestamp')
            c =
              parseTimestamp(
                extractTimestamp(
                  a as Record<string, unknown>,
                ),
              ) -
              parseTimestamp(
                extractTimestamp(
                  b as Record<string, unknown>,
                ),
              );
          if (sortBy === 'quantity')
            c = asNumber(a.quantity) - asNumber(b.quantity);
          if (sortBy === 'price')
            c = asNumber(a.price) - asNumber(b.price);
          if (sortBy === 'status')
            c = String(a.status ?? '').localeCompare(
              String(b.status ?? ''),
            );
          return sortDir === 'asc' ? c : -c;
        }),
      [filtered, sortBy, sortDir],
    );

    const pag = usePagination(sorted, PAGE_SIZE, dq);

    const stats = useMemo(() => {
      const m = {
        pending: 0,
        completed: 0,
        rejected: 0,
        cancelled: 0,
      };
      for (const o of orders) {
        const cat = orderStatusCategory(
          String(o.status ?? ''),
        );
        if (cat in m) m[cat as keyof typeof m]++;
      }
      return m;
    }, [orders]);

    // FIX: Separated sort state updates to avoid stale closure
    const toggleSort = useCallback((field: string) => {
      setSortBy(prev => {
        if (prev === field) {
          setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
          return field;
        }
        setSortDir(field === 'timestamp' ? 'desc' : 'asc');
        return field;
      });
    }, []);

    const handleCopy = useCallback(async (id: string) => {
      const ok = await copyToClipboard(id);
      if (ok) {
        setCopiedId(id);
        window.setTimeout(() => setCopiedId(null), 1200);
      }
    }, []);

    const executeCancel = useCallback(
      async (row: OrderBookRow) => {
        const id = String(row.order_id);
        setCancelling(id);
        await onCancel(
          id,
          String(row.exchange_code || 'NFO'),
        );
        setCancelling(null);
        setCancelTarget(null);
        onRefresh();
      },
      [onCancel, onRefresh],
    );

    const handleExportCsv = useCallback(() => {
      const headers = [
        'Order ID',
        'Stock',
        'Strike',
        'Right',
        'Action',
        'Qty',
        'Price',
        'Type',
        'Status',
        'Time',
      ];
      const rows = orders.map(o => [
        String(o.order_id || ''),
        String(o.stock_code || ''),
        String(o.strike_price || ''),
        String(o.right || ''),
        String(o.action || ''),
        String(o.quantity || ''),
        String(o.price || ''),
        String(o.order_type || ''),
        String(o.status || ''),
        extractTimestamp(o as Record<string, unknown>),
      ]);
      exportCsv('order-book.csv', headers, rows);
    }, [orders]);

    if (!canFetch)
      return (
        <EmptyState
          icon={<BookOpen size={36} />}
          title="Connect backend to view orders"
        />
      );

    if (loading && orders.length === 0) {
      return (
        <table className="w-full text-[10px]">
          <thead className="bg-[#0e1018]">
            <tr className="border-b border-gray-800/50 text-gray-600 text-[9px]">
              {[
                'ID',
                'Instrument',
                'Time',
                'B/S',
                'Qty',
                'Price',
                'Type',
                'Status',
                'Action',
              ].map(h => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }, (_, i) => (
              <SkeletonRow key={i} cols={9} />
            ))}
          </tbody>
        </table>
      );
    }

    if (orders.length === 0) {
      return (
        <EmptyState
          icon={<BookOpen size={36} />}
          title="No orders today"
          action={{ label: 'Refresh', onClick: onRefresh }}
        />
      );
    }

    return (
      <div>
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-800/40 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-600 text-[10px]">
              {sorted.length}/{orders.length}
            </span>
            <StaleBadge lastRefresh={lastRefresh} />
            {stats.pending > 0 && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 tabular-nums">
                {stats.pending} pending
              </span>
            )}
            {stats.completed > 0 && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 tabular-nums">
                {stats.completed} filled
              </span>
            )}
            {stats.rejected > 0 && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 tabular-nums">
                {stats.rejected} rejected
              </span>
            )}
            {stats.cancelled > 0 && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-gray-500/10 border border-gray-500/20 text-gray-500 tabular-nums">
                {stats.cancelled} cancelled
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stats.pending > 1 && onBatchCancel && (
              <button
                onClick={onBatchCancel}
                className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg text-[9px] font-semibold transition-colors"
                aria-label={`Cancel all ${stats.pending} pending orders`}
              >
                <Ban size={9} />
                Cancel All ({stats.pending})
              </button>
            )}
            <button
              onClick={handleExportCsv}
              className="p-1 text-gray-600 hover:text-gray-300 rounded-lg"
              aria-label="Export CSV"
              title="Export as CSV"
            >
              <Download size={11} />
            </button>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search orders…"
              className="w-36"
            />
            <button
              onClick={onRefresh}
              className="p-1 text-gray-600 hover:text-gray-300 rounded-lg"
              aria-label="Refresh orders"
            >
              <RefreshCw
                size={11}
                className={loading ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto">
          <table
            className="w-full text-[10px]"
            role="table"
          >
            <thead className="bg-[#0e1018] sticky top-0 z-10">
              <tr className="border-b border-gray-800/50 text-gray-600 text-[9px]">
                <th className="px-3 py-2 text-left font-semibold">
                  Order ID
                </th>
                <th className="px-3 py-2 text-left font-semibold">
                  Instrument
                </th>
                <SortableHeader
                  label="Time"
                  field="timestamp"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  className="text-left"
                />
                <th className="px-3 py-2 text-center font-semibold">
                  B/S
                </th>
                <SortableHeader
                  label="Qty"
                  field="quantity"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  className="text-right"
                />
                <SortableHeader
                  label="Price"
                  field="price"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  className="text-right"
                />
                <th className="px-3 py-2 text-center font-semibold">
                  Type
                </th>
                <SortableHeader
                  label="Status"
                  field="status"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  className="text-center"
                />
                <th className="px-3 py-2 text-center font-semibold">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {pag.slice.map((row, i) => {
                const isBuy =
                  String(row.action || '').toLowerCase() ===
                  'buy';
                const statusStr = String(
                  row.status || '',
                ).toLowerCase();
                const isPending =
                  statusStr.includes('open') ||
                  statusStr.includes('pend');
                const rowId = String(row.order_id || '');
                return (
                  <tr
                    key={`${rowId}-${i}`}
                    className="border-b border-gray-800/20 hover:bg-gray-800/10 transition-colors"
                  >
                    <td className="px-3 py-2 mono text-gray-500 text-[9px]">
                      <button
                        onClick={() => handleCopy(rowId)}
                        className="inline-flex items-center gap-1 hover:text-white transition-colors"
                        title="Copy order ID"
                      >
                        {rowId.slice(0, 12)}…
                        {copiedId === rowId ? (
                          <Check
                            size={10}
                            className="text-emerald-400"
                          />
                        ) : (
                          <Copy size={10} />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 mono">
                      <span className="text-white font-semibold">
                        {String(row.stock_code || '')}
                      </span>
                      {row.strike_price && (
                        <span className="text-gray-600 ml-1">
                          {String(row.strike_price)}{' '}
                          {String(
                            row.right || '',
                          ).toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {extractTimestamp(
                        row as Record<string, unknown>,
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-[8px] font-bold px-1.5 py-0.5 rounded-md ${isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
                      >
                        {String(
                          row.action || '',
                        ).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right mono">
                      {String(row.quantity || '')}
                    </td>
                    <td className="px-3 py-2 text-right mono">
                      ₹{String(row.price || '')}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-500">
                      {String(
                        row.order_type || '',
                      ).toUpperCase()}
                    </td>
                    <td
                      className={`px-3 py-2 text-center font-semibold ${statusColor(String(row.status || ''))}`}
                    >
                      {String(row.status || '')}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isPending && (
                        <button
                          onClick={() =>
                            setCancelTarget(row)
                          }
                          disabled={cancelling === rowId}
                          className="px-2 py-0.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-lg text-[9px] font-semibold disabled:opacity-40 transition-colors"
                        >
                          {cancelling === rowId ? (
                            <RefreshCw
                              size={10}
                              className="animate-spin inline"
                            />
                          ) : (
                            'Cancel'
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <PaginationControls
          page={pag.page}
          totalPages={pag.totalPages}
          showing={pag.showing}
          canPrev={pag.canPrev}
          canNext={pag.canNext}
          onPrev={pag.prev}
          onNext={pag.next}
          onFirst={pag.first}
          onLast={pag.last}
        />

        {cancelTarget && (
          <div
            className="m-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[11px]"
            role="alertdialog"
          >
            <p className="text-red-200 mb-2">
              Cancel order{' '}
              <span className="mono font-bold">
                {String(cancelTarget.order_id).slice(0, 20)}
                …
              </span>
              ?
            </p>
            <p className="text-gray-500 text-[10px] mb-2">
              {String(cancelTarget.stock_code || '')}{' '}
              {String(cancelTarget.strike_price || '')}{' '}
              {String(cancelTarget.right || '').toUpperCase()}{' '}
              ·{' '}
              {String(
                cancelTarget.action || '',
              ).toUpperCase()}{' '}
              × {String(cancelTarget.quantity || '')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setCancelTarget(null)}
                className="px-3 py-1.5 bg-gray-700/50 rounded-lg text-gray-300 text-[10px] font-medium transition-colors hover:bg-gray-700"
              >
                Keep
              </button>
              <button
                onClick={() => executeCancel(cancelTarget)}
                disabled={cancelling !== null}
                className="px-3 py-1.5 bg-red-600 rounded-lg text-white text-[10px] font-bold transition-colors hover:bg-red-500 disabled:opacity-40 flex items-center gap-1"
              >
                {cancelling ? (
                  <RefreshCw
                    size={10}
                    className="animate-spin"
                  />
                ) : null}
                Confirm Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
OrderBookTable.displayName = 'OrderBookTable';

// ═══════════════════════════════════════════════════════════════════════════
// §10  TRADE BOOK TABLE
// ═══════════════════════════════════════════════════════════════════════════

const TradeBookTable: FC<{
  trades: TradeBookRow[];
  loading: boolean;
  canFetch: boolean;
  onRefresh: () => void;
  lastRefresh: number | null;
}> = React.memo(
  ({ trades, loading, canFetch, onRefresh, lastRefresh }) => {
    const [query, setQuery] = useState('');
    const dq = useDebounce(query, DEBOUNCE_MS);
    const [sortBy, setSortBy] = useState('timestamp');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const filtered = useMemo(() => {
      const q = dq.trim().toLowerCase();
      if (!q) return trades;
      return trades.filter(r =>
        [
          r.order_id,
          r.stock_code,
          r.action,
          r.right,
          r.strike_price,
        ].some(v =>
          String(v ?? '')
            .toLowerCase()
            .includes(q),
        ),
      );
    }, [trades, dq]);

    const sorted = useMemo(
      () =>
        [...filtered].sort((a, b) => {
          let c = 0;
          if (sortBy === 'timestamp')
            c =
              parseTimestamp(
                extractTimestamp(
                  a as Record<string, unknown>,
                ),
              ) -
              parseTimestamp(
                extractTimestamp(
                  b as Record<string, unknown>,
                ),
              );
          if (sortBy === 'quantity')
            c = asNumber(a.quantity) - asNumber(b.quantity);
          if (sortBy === 'price')
            c =
              asNumber(a.trade_price ?? a.price) -
              asNumber(b.trade_price ?? b.price);
          return sortDir === 'asc' ? c : -c;
        }),
      [filtered, sortBy, sortDir],
    );

    const pag = usePagination(sorted, PAGE_SIZE, dq);

    const toggleSort = useCallback((field: string) => {
      setSortBy(prev => {
        if (prev === field) {
          setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
          return field;
        }
        setSortDir(field === 'timestamp' ? 'desc' : 'asc');
        return field;
      });
    }, []);

    const tradeStats = useMemo(() => {
      let totalBuyQty = 0,
        totalSellQty = 0,
        totalTurnover = 0;
      for (const t of trades) {
        const qty = asNumber(t.quantity);
        const price = asNumber(t.trade_price ?? t.price);
        if (
          String(t.action || '').toLowerCase() === 'buy'
        )
          totalBuyQty += qty;
        else totalSellQty += qty;
        totalTurnover += qty * price;
      }
      return { totalBuyQty, totalSellQty, totalTurnover };
    }, [trades]);

    const handleExportCsv = useCallback(() => {
      const headers = [
        'Stock',
        'Strike',
        'Right',
        'Action',
        'Qty',
        'Trade Price',
        'Expiry',
        'Time',
      ];
      const rows = trades.map(t => [
        String(t.stock_code || ''),
        String(t.strike_price || ''),
        String(t.right || ''),
        String(t.action || ''),
        String(t.quantity || ''),
        String(t.trade_price || t.price || ''),
        String(t.expiry_date || ''),
        extractTimestamp(t as Record<string, unknown>),
      ]);
      exportCsv('trade-book.csv', headers, rows);
    }, [trades]);

    if (!canFetch)
      return (
        <EmptyState
          icon={<List size={36} />}
          title="Connect backend to view trades"
        />
      );

    if (loading && trades.length === 0) {
      return (
        <table className="w-full text-[10px]">
          <thead className="bg-[#0e1018]">
            <tr className="border-b border-gray-800/50 text-gray-600 text-[9px]">
              {[
                'Instrument',
                'Time',
                'B/S',
                'Qty',
                'Trade Price',
                'Expiry',
              ].map(h => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }, (_, i) => (
              <SkeletonRow key={i} cols={6} />
            ))}
          </tbody>
        </table>
      );
    }

    if (trades.length === 0) {
      return (
        <EmptyState
          icon={<List size={36} />}
          title="No executed trades today"
          action={{ label: 'Refresh', onClick: onRefresh }}
        />
      );
    }

    return (
      <div>
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-800/40 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-600 text-[10px]">
              {sorted.length}/{trades.length} trades
            </span>
            <StaleBadge lastRefresh={lastRefresh} />
            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500/8 border border-emerald-500/15 text-emerald-400 tabular-nums">
              Buy: {tradeStats.totalBuyQty}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-red-500/8 border border-red-500/15 text-red-400 tabular-nums">
              Sell: {tradeStats.totalSellQty}
            </span>
            {tradeStats.totalTurnover > 0 && (
              <span className="text-[8px] text-gray-600">
                Turnover: ₹
                {(
                  tradeStats.totalTurnover / 100000
                ).toFixed(1)}
                L
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="p-1 text-gray-600 hover:text-gray-300 rounded-lg"
              aria-label="Export CSV"
              title="Export as CSV"
            >
              <Download size={11} />
            </button>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search trades…"
              className="w-36"
            />
            <button
              onClick={onRefresh}
              className="p-1 text-gray-600 hover:text-gray-300 rounded-lg"
              aria-label="Refresh trades"
            >
              <RefreshCw
                size={11}
                className={loading ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          <table
            className="w-full text-[10px]"
            role="table"
          >
            <thead className="bg-[#0e1018] sticky top-0 z-10">
              <tr className="border-b border-gray-800/50 text-gray-600 text-[9px]">
                <th className="px-3 py-2 text-left font-semibold">
                  Instrument
                </th>
                <SortableHeader
                  label="Time"
                  field="timestamp"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  className="text-left"
                />
                <th className="px-3 py-2 text-center font-semibold">
                  B/S
                </th>
                <SortableHeader
                  label="Qty"
                  field="quantity"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  className="text-right"
                />
                <SortableHeader
                  label="Trade Price"
                  field="price"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  className="text-right"
                />
                <th className="px-3 py-2 text-right font-semibold">
                  Expiry
                </th>
              </tr>
            </thead>
            <tbody>
              {pag.slice.map((row, i) => {
                const isBuy =
                  String(row.action || '').toLowerCase() ===
                  'buy';
                return (
                  <tr
                    key={`${String(row.order_id)}-${i}`}
                    className="border-b border-gray-800/20 hover:bg-gray-800/10 transition-colors"
                  >
                    <td className="px-3 py-2 mono">
                      <span className="text-white font-semibold">
                        {String(row.stock_code || '')}
                      </span>
                      {row.strike_price && (
                        <span className="text-gray-600 ml-1">
                          {String(row.strike_price)}{' '}
                          {String(
                            row.right || '',
                          ).toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {extractTimestamp(
                        row as Record<string, unknown>,
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-[8px] font-bold px-1.5 py-0.5 rounded-md ${isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
                      >
                        {String(
                          row.action || '',
                        ).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right mono">
                      {String(row.quantity || '')}
                    </td>
                    <td className="px-3 py-2 text-right mono text-amber-300">
                      ₹
                      {String(
                        row.trade_price ||
                          row.price ||
                          '',
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {String(row.expiry_date || '')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <PaginationControls
          page={pag.page}
          totalPages={pag.totalPages}
          showing={pag.showing}
          canPrev={pag.canPrev}
          canNext={pag.canNext}
          onPrev={pag.prev}
          onNext={pag.next}
          onFirst={pag.first}
          onLast={pag.last}
        />
      </div>
    );
  },
);
TradeBookTable.displayName = 'TradeBookTable';

// ═══════════════════════════════════════════════════════════════════════════
// §11  POSITION CARD — with P&L percentage
// ═══════════════════════════════════════════════════════════════════════════

const PositionCard: FC<{
  pos: Position;
  onLoad: () => void;
  onSquareOff?: (pos: Position) => void;
  canFetch: boolean;
}> = React.memo(({ pos, onLoad, onSquareOff, canFetch }) => {
  const [exp, setExp] = useState(false);
  const cfg =
    SYMBOL_CONFIG[pos.symbol as SymbolCode] ??
    SYMBOL_CONFIG['NIFTY'];
  const ip = pos.mtmPnl >= 0;

  // Calculate P&L percentage based on total invested
  const totalInvested = useMemo(() => {
    return pos.legs.reduce((sum, leg) => {
      return sum + leg.entryPrice * leg.lots * cfg.lotSize;
    }, 0);
  }, [pos.legs, cfg.lotSize]);

  const pnlPct =
    totalInvested > 0
      ? ((pos.mtmPnl / totalInvested) * 100).toFixed(1)
      : '0.0';

  return (
    <article
      className={`rounded-2xl border transition-all ${
        pos.status === 'ACTIVE'
          ? 'bg-[#1a1d2e] border-gray-700/40 hover:border-gray-600/50'
          : pos.status === 'DRAFT'
            ? 'bg-amber-950/6 border-amber-800/20'
            : 'bg-[#14161f] border-gray-800/25 opacity-55'
      }`}
      aria-label={`${cfg.displayName} ${pos.strategy} position`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${ip ? 'bg-emerald-500/8' : 'bg-red-500/8'}`}
          aria-hidden
        >
          {ip ? (
            <TrendingUp
              size={16}
              className="text-emerald-400"
            />
          ) : (
            <TrendingDown
              size={16}
              className="text-red-400"
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-xs">
              {cfg.displayName}
            </span>
            <span className="text-[9px] text-blue-400 bg-blue-500/8 px-1.5 py-0.5 rounded-lg border border-blue-500/15">
              {pos.expiry}
            </span>
            <span className="text-gray-600 text-[10px]">
              {pos.strategy}
            </span>
            <span
              className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-lg border ${
                pos.status === 'ACTIVE'
                  ? 'text-emerald-400 bg-emerald-500/8 border-emerald-500/20'
                  : pos.status === 'DRAFT'
                    ? 'text-amber-400 bg-amber-500/8 border-amber-500/20'
                    : 'text-gray-500 bg-gray-700/20 border-gray-700/20'
              }`}
            >
              <CheckCircle size={9} />
              {pos.status.charAt(0) +
                pos.status.slice(1).toLowerCase()}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[9px] text-gray-700">
            <span className="flex items-center gap-1">
              <Clock size={8} />
              {pos.entryDate}
            </span>
            <span>
              {pos.legs.length} leg
              {pos.legs.length > 1 ? 's' : ''}
            </span>
            <span className="text-amber-500 font-semibold">
              1L={cfg.lotSize}
            </span>
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <div
            className={`text-base font-bold mono ${ip ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {ip ? '+' : ''}₹
            {pos.mtmPnl.toLocaleString('en-IN')}
          </div>
          {/* P&L Percentage */}
          <div className="flex items-center justify-end gap-1">
            <Percent
              size={8}
              className={
                ip ? 'text-emerald-500/60' : 'text-red-500/60'
              }
            />
            <span
              className={`text-[9px] mono font-semibold ${ip ? 'text-emerald-500/80' : 'text-red-500/80'}`}
            >
              {ip ? '+' : ''}
              {pnlPct}%
            </span>
          </div>
        </div>

        <div className="text-right flex-shrink-0 ml-3 border-l border-gray-800/40 pl-3 hidden sm:block">
          <div className="text-[9px] text-emerald-400 mono">
            {pos.maxProfit === Infinity
              ? '∞'
              : fmtPnL(pos.maxProfit)}
          </div>
          <div className="text-[9px] text-red-400 mono">
            {pos.maxLoss === -Infinity
              ? '-∞'
              : fmtPnL(pos.maxLoss)}
          </div>
          <div className="text-[8px] text-gray-700">
            Max P/L
          </div>
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          <button
            onClick={onLoad}
            className="flex items-center gap-1 px-2 py-1 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/15 rounded-lg text-[9px] font-semibold transition-colors"
            aria-label="Load to builder"
          >
            <Zap size={9} />
            Load
          </button>
          {pos.status === 'ACTIVE' && (
            <button
              onClick={() => {
                if (canFetch) onSquareOff?.(pos);
              }}
              disabled={!canFetch}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all border ${
                canFetch
                  ? 'bg-red-600/15 hover:bg-red-600/30 text-red-400 border-red-500/25 hover:border-red-500/50'
                  : 'bg-gray-700/20 text-gray-600 border-gray-700/20 cursor-not-allowed'
              }`}
              title={
                canFetch
                  ? 'Square Off'
                  : 'Connect backend first'
              }
              aria-label="Square off position"
            >
              <ShieldAlert size={9} />
              Sq Off
            </button>
          )}
          <button
            onClick={() => setExp(!exp)}
            className="p-1 text-gray-700 hover:text-gray-300 transition-colors"
            aria-expanded={exp}
            aria-label={exp ? 'Collapse' : 'Expand'}
          >
            {exp ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )}
          </button>
        </div>
      </div>

      {exp && (
        <div className="border-t border-gray-800/30 px-4 py-3">
          <div className="text-[9px] text-gray-700 mb-2 uppercase tracking-wider font-semibold">
            Legs · 1 lot = {cfg.lotSize} qty
          </div>
          <div className="overflow-auto">
            <table
              className="w-full text-[10px]"
              role="table"
            >
              <thead>
                <tr className="text-gray-700 border-b border-gray-800/40">
                  <th className="pb-1.5 text-left font-semibold">
                    Instrument
                  </th>
                  <th className="pb-1.5 text-center font-semibold">
                    B/S
                  </th>
                  <th className="pb-1.5 text-right font-semibold">
                    Lots
                  </th>
                  <th className="pb-1.5 text-right font-semibold bg-amber-500/5 px-2 rounded">
                    Qty
                  </th>
                  <th className="pb-1.5 text-right font-semibold">
                    Entry
                  </th>
                  <th className="pb-1.5 text-right font-semibold">
                    LTP
                  </th>
                  <th className="pb-1.5 text-right font-semibold">
                    P&L
                  </th>
                </tr>
              </thead>
              <tbody>
                {pos.legs.map((leg, i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-800/15 last:border-0"
                  >
                    <td className="py-1.5 mono">
                      <span
                        className={`font-bold ${leg.type === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}
                      >
                        {cfg.displayName}{' '}
                        {leg.strike.toLocaleString('en-IN')}{' '}
                        {leg.type}
                      </span>
                    </td>
                    <td className="py-1.5 text-center">
                      <span
                        className={`text-[8px] font-bold px-1 py-0.5 rounded-md ${leg.action === 'BUY' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
                      >
                        {leg.action}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-amber-400 font-bold mono">
                      {leg.lots}
                    </td>
                    <td className="py-1.5 text-right font-black mono bg-amber-500/5 px-2 rounded">
                      {leg.lots * cfg.lotSize}
                      <span className="text-gray-700 text-[8px] font-normal ml-1">
                        {leg.lots}×{cfg.lotSize}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-gray-600 mono">
                      ₹{leg.entryPrice.toFixed(2)}
                    </td>
                    <td className="py-1.5 text-right text-white font-semibold mono">
                      ₹{leg.currentPrice.toFixed(2)}
                    </td>
                    <td
                      className={`py-1.5 text-right font-bold mono ${leg.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {leg.pnl >= 0 ? '+' : ''}₹
                      {leg.pnl.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </article>
  );
});
PositionCard.displayName = 'PositionCard';

// ═══════════════════════════════════════════════════════════════════════════
// §12  MAIN POSITIONS PANEL
// ═══════════════════════════════════════════════════════════════════════════

const PositionsInner: FC<Props> = ({
  onLoadToBuilder,
  livePositions,
  isLive: isLiveRaw,
  session,
  onRefreshPositions,
}) => {
  const liveFlag = !!isLiveRaw;
  const backendUrl = session?.proxyBase ?? '';
  const canFetch = liveFlag && isKaggleBackend(backendUrl);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Core state ──
  const [filter, setFilter] = useState<PositionFilter>('ALL');
  const [subTab, setSubTab] = useState<SubTab>('positions');
  const [funds, setFunds] = useState<FundsData | null>(null);
  const [orders, setOrders] = useState<OrderBookRow[]>([]);
  const [trades, setTrades] = useState<TradeBookRow[]>([]);
  const [fundsLoading, setFundsLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [positionsRefreshing, setPositionsRefreshing] =
    useState(false);
  const [sqOffPos, setSqOffPos] = useState<Position | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showBatchCancelConfirm, setShowBatchCancelConfirm] =
    useState(false);
  const [batchCancelling, setBatchCancelling] = useState(false);

  // Positions search/sort
  const [posQuery, setPosQuery] = useState('');
  const debouncedPosQuery = useDebounce(posQuery, DEBOUNCE_MS);
  const [posSortField, setPosSortField] =
    useState<PosSortField>('pnl');
  const [posSortDir, setPosSortDir] =
    useState<SortDir>('desc');

  // Per-tab errors
  const [tabErrors, setTabErrors] = useState<TabError>({});
  const setTabError = useCallback(
    (tab: SubTab, msg: string | null) => {
      setTabErrors(prev => ({ ...prev, [tab]: msg }));
    },
    [],
  );

  // Toast system
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const addToast = useCallback(
    (message: string, type: ToastType = 'success') => {
      const id = genId();
      setToasts(prev => [
        ...prev.slice(-4),
        { id, message, type },
      ]);
      window.setTimeout(
        () =>
          setToasts(prev => prev.filter(t => t.id !== id)),
        3500,
      );
    },
    [],
  );
  const dismissToast = useCallback(
    (id: string) =>
      setToasts(prev => prev.filter(t => t.id !== id)),
    [],
  );

  // Refresh timestamps
  const [lastRefresh, setLastRefresh] = useState<
    Record<string, number>
  >({});
  const markRefresh = useCallback(
    (tab: string) =>
      setLastRefresh(prev => ({
        ...prev,
        [tab]: Date.now(),
      })),
    [],
  );

  // In-flight guards
  const inFlight = useRef<Record<string, boolean>>({});

  // Scroll to top on tab change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [subTab]);

  // ── Keyboard shortcuts ──
  const shortcuts = useMemo(
    () => {
      const map: Record<string, () => void> = {};
      SUB_TAB_ORDER.forEach((tab, i) => {
        map[`Ctrl+${i + 1}`] = () => setSubTab(tab);
      });
      return map;
    },
    [],
  );
  useKeyboardShortcuts(shortcuts, !sqOffPos);

  // ── Derived data ──
  const positions = useMemo(
    () => resolvePositions(liveFlag, livePositions),
    [liveFlag, livePositions],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: positions.length,
      ACTIVE: 0,
      DRAFT: 0,
      CLOSED: 0,
    };
    for (const p of positions)
      counts[p.status] = (counts[p.status] || 0) + 1;
    return counts;
  }, [positions]);

  const processedPositions = useMemo(() => {
    let result =
      filter === 'ALL'
        ? positions
        : positions.filter(p => p.status === filter);

    const q = debouncedPosQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(p => {
        const c = SYMBOL_CONFIG[p.symbol as SymbolCode];
        const searchable = [
          c?.displayName ?? p.symbol,
          p.strategy,
          p.expiry,
          p.status,
          p.entryDate,
          ...p.legs.map(l => `${l.type} ${l.strike}`),
        ]
          .join(' ')
          .toLowerCase();
        return searchable.includes(q);
      });
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (posSortField === 'pnl')
        cmp = a.mtmPnl - b.mtmPnl;
      else if (posSortField === 'date')
        cmp = (a.entryDate || '').localeCompare(
          b.entryDate || '',
        );
      else if (posSortField === 'symbol')
        cmp = a.symbol.localeCompare(b.symbol);
      return posSortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [
    positions,
    filter,
    debouncedPosQuery,
    posSortField,
    posSortDir,
  ]);

  const totalMtm = useMemo(
    () =>
      positions
        .filter(p => p.status === 'ACTIVE')
        .reduce((s, p) => s + p.mtmPnl, 0),
    [positions],
  );
  const activeCount = useMemo(
    () => positions.filter(p => p.status === 'ACTIVE').length,
    [positions],
  );
  const totalLegs = useMemo(
    () => positions.reduce((s, p) => s + p.legs.length, 0),
    [positions],
  );

  // Symbol/expiry for trade panel
  const symbolChoices = useMemo(() => {
    const set = new Set(
      positions.map(p => p.symbol as SymbolCode),
    );
    return set.size > 0
      ? Array.from(set)
      : (['NIFTY'] as SymbolCode[]);
  }, [positions]);
  const expiryChoices = useMemo(
    () =>
      Array.from(
        new Set(positions.map(p => p.expiry)),
      ).filter(Boolean),
    [positions],
  );

  const [tradeSym, setTradeSym] = useState<SymbolCode>(
    symbolChoices[0],
  );
  const [tradeExpiry, setTradeExpiry] = useState(
    expiryChoices[0] ?? '',
  );

  useEffect(() => {
    if (!symbolChoices.includes(tradeSym))
      setTradeSym(symbolChoices[0]);
  }, [symbolChoices, tradeSym]);

  useEffect(() => {
    if (tradeExpiry && !expiryChoices.includes(tradeExpiry))
      setTradeExpiry(expiryChoices[0] ?? '');
  }, [expiryChoices, tradeExpiry]);

  // ── Data loaders with deduplication + retry ──
  const loadFunds = useCallback(async () => {
    if (!canFetch || inFlight.current.funds) return;
    inFlight.current.funds = true;
    setFundsLoading(true);
    setTabError('funds', null);
    try {
      const r = await withRetry(() =>
        fetchFunds(backendUrl),
      );
      if (r.ok) {
        setFunds(r.data ?? null);
        markRefresh('funds');
      } else setTabError('funds', r.error ?? 'Failed');
    } catch (e) {
      setTabError(
        'funds',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setFundsLoading(false);
      inFlight.current.funds = false;
    }
  }, [canFetch, backendUrl, setTabError, markRefresh]);

  const loadOrders = useCallback(async () => {
    if (!canFetch || inFlight.current.orders) return;
    inFlight.current.orders = true;
    setOrdersLoading(true);
    setTabError('orders', null);
    setTabError('sell', null);
    try {
      const r = await withRetry(() =>
        fetchOrderBook(backendUrl),
      );
      if (r.ok) {
        setOrders(r.data);
        markRefresh('orders');
        markRefresh('sell');
      } else {
        setTabError('orders', r.error ?? 'Failed');
        setTabError('sell', r.error ?? 'Failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTabError('orders', msg);
      setTabError('sell', msg);
    } finally {
      setOrdersLoading(false);
      inFlight.current.orders = false;
    }
  }, [canFetch, backendUrl, setTabError, markRefresh]);

  const loadTrades = useCallback(async () => {
    if (!canFetch || inFlight.current.trades) return;
    inFlight.current.trades = true;
    setTradesLoading(true);
    setTabError('trades', null);
    try {
      const r = await withRetry(() =>
        fetchTradeBook(backendUrl),
      );
      if (r.ok) {
        setTrades(r.data);
        markRefresh('trades');
      } else setTabError('trades', r.error ?? 'Failed');
    } catch (e) {
      setTabError(
        'trades',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setTradesLoading(false);
      inFlight.current.trades = false;
    }
  }, [canFetch, backendUrl, setTabError, markRefresh]);

  // Load on tab switch
  useEffect(() => {
    if (subTab === 'funds') loadFunds();
    if (subTab === 'orders' || subTab === 'sell') loadOrders();
    if (subTab === 'trades') loadTrades();
  }, [subTab, loadFunds, loadOrders, loadTrades]);

  // Auto-refresh
  const autoRefreshCb = useCallback(() => {
    if (subTab === 'orders' || subTab === 'sell') loadOrders();
    if (subTab === 'trades') loadTrades();
    if (subTab === 'funds') loadFunds();
  }, [subTab, loadOrders, loadTrades, loadFunds]);

  const isAutoTab = [
    'orders',
    'trades',
    'funds',
    'sell',
  ].includes(subTab);
  const { secondsLeft } = useAutoRefresh(
    autoRefreshCb,
    AUTO_REFRESH_SEC,
    canFetch && autoRefresh && isAutoTab,
  );

  // ── Handlers ──
  const handleRefreshPositions = useCallback(async () => {
    setPositionsRefreshing(true);
    onRefreshPositions?.();
    // Give time for parent to update livePositions
    window.setTimeout(() => setPositionsRefreshing(false), 1500);
  }, [onRefreshPositions]);

  const handleCancel = useCallback(
    async (orderId: string, exchange: string) => {
      if (!canFetch) {
        addToast('Connect backend first.', 'error');
        return;
      }
      try {
        const r = await cancelOrder(
          backendUrl,
          orderId,
          exchange,
        );
        if (!r.ok)
          addToast(
            `Cancel failed: ${r.error ?? 'Unknown'}`,
            'error',
          );
        else
          addToast(
            `Order ${orderId.slice(0, 10)}… cancelled`,
            'success',
          );
      } catch (e) {
        addToast(
          `Error: ${e instanceof Error ? e.message : String(e)}`,
          'error',
        );
      }
    },
    [canFetch, backendUrl, addToast],
  );

  const handleBatchCancel = useCallback(async () => {
    if (!canFetch) return;
    setBatchCancelling(true);
    // FIX: Snapshot orders at call time to avoid stale closure
    const currentOrders = [...orders];
    const pending = currentOrders.filter(o => {
      const s = String(o.status || '').toLowerCase();
      return s.includes('open') || s.includes('pend');
    });
    let ok = 0,
      fail = 0;
    for (const o of pending) {
      try {
        const r = await cancelOrder(
          backendUrl,
          String(o.order_id),
          String(o.exchange_code || 'NFO'),
        );
        if (r.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setBatchCancelling(false);
    setShowBatchCancelConfirm(false);
    if (ok > 0)
      addToast(
        `${ok} order${ok > 1 ? 's' : ''} cancelled`,
        'success',
      );
    if (fail > 0)
      addToast(
        `${fail} cancel${fail > 1 ? 's' : ''} failed`,
        'error',
      );
    loadOrders();
  }, [canFetch, orders, backendUrl, addToast, loadOrders]);

  const togglePosSort = useCallback(
    (field: PosSortField) => {
      setPosSortField(prev => {
        if (prev === field) {
          setPosSortDir(d =>
            d === 'asc' ? 'desc' : 'asc',
          );
          return field;
        }
        setPosSortDir('desc');
        return field;
      });
    },
    [],
  );

  // ── Sell orders ──
  const sellOrders = useMemo(
    () =>
      orders.filter(
        o =>
          String(o.action || '').toLowerCase() === 'sell',
      ),
    [orders],
  );
  const sellOrderCount = sellOrders.length;

  // ── Sub-tab config ──
  const SUB_TABS = useMemo(
    (): {
      id: SubTab;
      label: string;
      icon: ReactNode;
      badge?: number;
      shortcut?: string;
    }[] => [
      {
        id: 'positions',
        label: 'Positions',
        icon: <BarChart3 size={10} />,
        badge: processedPositions.length,
        shortcut: '⌘1',
      },
      {
        id: 'trade',
        label: 'Trade Options',
        icon: <Activity size={10} />,
        shortcut: '⌘2',
      },
      {
        id: 'sell',
        label: 'Sell Orders',
        icon: <TrendingDown size={10} />,
        badge: sellOrderCount,
        shortcut: '⌘3',
      },
      {
        id: 'orders',
        label: 'Order Book',
        icon: <BookOpen size={10} />,
        badge: orders.length,
        shortcut: '⌘4',
      },
      {
        id: 'trades',
        label: 'Trade Book',
        icon: <List size={10} />,
        badge: trades.length,
        shortcut: '⌘5',
      },
      {
        id: 'funds',
        label: 'Funds',
        icon: <DollarSign size={10} />,
        shortcut: '⌘6',
      },
    ],
    [
      processedPositions.length,
      sellOrderCount,
      orders.length,
      trades.length,
    ],
  );

  const currentError = tabErrors[subTab] ?? null;

  return (
    <div
      className="flex-1 overflow-auto bg-[#13161f]"
      ref={scrollRef}
    >
      {/* Skip to content (accessibility) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:m-2"
      >
        Skip to content
      </a>

      {/* ── Summary Cards ── */}
      <div className="p-4 pb-2" id="main-content">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {[
            {
              label: 'Total MTM P&L',
              value: `${totalMtm >= 0 ? '+' : ''}₹${totalMtm.toLocaleString('en-IN')}`,
              color:
                totalMtm >= 0
                  ? 'text-emerald-400'
                  : 'text-red-400',
              bg:
                totalMtm >= 0
                  ? 'border-emerald-500/20 bg-emerald-500/4'
                  : 'border-red-500/20 bg-red-500/4',
            },
            {
              label: 'Active',
              value: String(activeCount),
              color: 'text-blue-400',
              bg: 'border-blue-500/20 bg-blue-500/4',
            },
            {
              label: 'Total Legs',
              value: String(totalLegs),
              color: 'text-purple-400',
              bg: 'border-purple-500/20 bg-purple-500/4',
            },
            {
              label: 'Strategies',
              value: String(positions.length),
              color: 'text-amber-400',
              bg: 'border-amber-500/20 bg-amber-500/4',
            },
          ].map(c => (
            <div
              key={c.label}
              className={`rounded-2xl border p-3.5 ${c.bg}`}
            >
              <div className="text-gray-600 text-[10px] mb-1">
                {c.label}
              </div>
              <AnimatedValue
                value={c.value}
                className={`text-xl sm:text-2xl font-black mono ${c.color}`}
              />
            </div>
          ))}
        </div>

        {/* ── Tab navigation ── */}
        <nav
          className="flex items-center gap-1 mb-3 border-b border-gray-800/40 pb-2 flex-wrap"
          role="tablist"
          aria-label="Position tabs"
        >
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              role="tab"
              aria-selected={subTab === t.id}
              aria-controls={`tabpanel-${t.id}`}
              title={
                t.shortcut
                  ? `${t.label} (${t.shortcut})`
                  : t.label
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg font-medium transition-colors ${
                subTab === t.id
                  ? t.id === 'trade'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-white hover:bg-gray-700/40'
              }`}
            >
              {t.icon}
              {t.label}
              {typeof t.badge === 'number' && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-800/80 text-[9px] text-gray-300 tabular-nums">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-[9px]">
            {isAutoTab && canFetch && (
              <button
                onClick={() => setAutoRefresh(v => !v)}
                className={`px-2 py-1 rounded-lg border transition-colors flex items-center gap-1 ${
                  autoRefresh
                    ? 'border-blue-500/30 text-blue-400 bg-blue-500/5'
                    : 'border-gray-700/40 text-gray-500'
                }`}
                aria-label={
                  autoRefresh
                    ? `Refresh in ${secondsLeft}s`
                    : 'Auto-refresh off'
                }
              >
                {autoRefresh ? (
                  <>
                    <Eye size={9} />
                    {secondsLeft}s
                  </>
                ) : (
                  <>
                    <EyeOff size={9} />
                    Off
                  </>
                )}
              </button>
            )}
            <ConnectionBadge
              canFetch={canFetch}
              isLive={liveFlag}
            />
          </div>
        </nav>

        <ToastContainer
          toasts={toasts}
          onDismiss={dismissToast}
        />

        {currentError && (
          <div
            className="flex items-center gap-2 p-2.5 mb-3 bg-red-500/8 border border-red-500/20 rounded-xl text-[11px] text-red-300"
            role="alert"
          >
            <AlertTriangle
              size={12}
              className="flex-shrink-0"
            />
            <span className="flex-1">{currentError}</span>
            <button
              onClick={() => setTabError(subTab, null)}
              className="text-gray-600 hover:text-gray-300 p-0.5"
              aria-label="Dismiss"
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      {/* ═══ POSITIONS TAB ═══ */}
      {subTab === 'positions' && (
        <div
          className="px-4 space-y-2"
          role="tabpanel"
          id="tabpanel-positions"
        >
          <div
            className="flex items-center gap-1 mb-2 flex-wrap"
            role="toolbar"
            aria-label="Position controls"
          >
            {(
              [
                'ALL',
                'ACTIVE',
                'DRAFT',
                'CLOSED',
              ] as PositionFilter[]
            ).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`px-3 py-1 text-[11px] rounded-lg font-semibold transition-colors ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-white hover:bg-gray-700/40'
                }`}
              >
                {f}
                <span className="ml-1 opacity-50">
                  ({statusCounts[f] ?? 0})
                </span>
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <SearchInput
                value={posQuery}
                onChange={setPosQuery}
                placeholder="Search positions…"
                className="w-40"
              />

              <div className="flex items-center gap-1">
                <ArrowDownAZ
                  size={10}
                  className="text-gray-600"
                />
                {(
                  ['pnl', 'date', 'symbol'] as PosSortField[]
                ).map(f => (
                  <button
                    key={f}
                    onClick={() => togglePosSort(f)}
                    className={`px-2 py-0.5 text-[9px] rounded-md transition-colors ${
                      posSortField === f
                        ? 'bg-blue-600/20 text-blue-400 font-bold'
                        : 'text-gray-600 hover:text-gray-300'
                    }`}
                  >
                    {f === 'pnl'
                      ? 'P&L'
                      : f.charAt(0).toUpperCase() +
                        f.slice(1)}
                    {posSortField === f && (
                      <span className="ml-0.5">
                        {posSortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {canFetch && onRefreshPositions && (
                <button
                  onClick={handleRefreshPositions}
                  disabled={positionsRefreshing}
                  className="flex items-center gap-1 px-2 py-1 text-gray-600 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg text-[10px] transition-colors disabled:opacity-40"
                  aria-label="Refresh positions"
                >
                  <RefreshCw
                    size={10}
                    className={
                      positionsRefreshing
                        ? 'animate-spin'
                        : ''
                    }
                  />
                  Refresh
                </button>
              )}
            </div>
          </div>

          {/* Loading skeleton during refresh */}
          {positionsRefreshing && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {/* Position list */}
          {!positionsRefreshing && (
            <>
              {liveFlag &&
              Array.isArray(livePositions) &&
              livePositions.length === 0 ? (
                <EmptyState
                  icon={
                    <CheckCircle
                      size={36}
                      className="text-emerald-500"
                    />
                  }
                  title="No open positions"
                  subtitle="Your account has no FNO positions today."
                />
              ) : processedPositions.length > 0 ? (
                processedPositions.map(pos => (
                  <PositionCard
                    key={pos.id}
                    pos={pos}
                    onLoad={() => onLoadToBuilder(pos)}
                    onSquareOff={p => setSqOffPos(p)}
                    canFetch={canFetch}
                  />
                ))
              ) : debouncedPosQuery ? (
                <EmptyState
                  icon={<Search size={36} />}
                  title={`No positions matching "${debouncedPosQuery}"`}
                  action={{
                    label: 'Clear search',
                    onClick: () => setPosQuery(''),
                  }}
                />
              ) : (
                <EmptyState
                  icon={<FileText size={36} />}
                  title={`No ${filter.toLowerCase()} positions`}
                  subtitle={
                    filter !== 'ALL'
                      ? 'Try a different filter'
                      : undefined
                  }
                />
              )}
            </>
          )}

          {!liveFlag && (
            <div className="text-center py-3">
              <p className="text-[10px] text-gray-800 flex items-center justify-center gap-1">
                <Info
                  size={10}
                  className="text-gray-700"
                />
                Demo data · Connect Kaggle for live
              </p>
            </div>
          )}
        </div>
      )}

      {/* ═══ TRADE OPTIONS TAB ═══ */}
      {subTab === 'trade' && (
        <div role="tabpanel" id="tabpanel-trade">
          {canFetch ? (
            <div className="space-y-3">
              <div className="mx-4 rounded-2xl border border-gray-700/30 bg-[#1a1d2e] p-3 flex items-center gap-3 flex-wrap">
                <label
                  htmlFor="trade-sym"
                  className="text-[10px] text-gray-500"
                >
                  Symbol
                </label>
                <select
                  id="trade-sym"
                  value={tradeSym}
                  onChange={e =>
                    setTradeSym(
                      e.target.value as SymbolCode,
                    )
                  }
                  className="bg-[#0e1018] border border-gray-700/50 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500/50"
                >
                  {symbolChoices.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <label
                  htmlFor="trade-exp"
                  className="text-[10px] text-gray-500"
                >
                  Expiry
                </label>
                <select
                  id="trade-exp"
                  value={tradeExpiry}
                  onChange={e =>
                    setTradeExpiry(e.target.value)
                  }
                  className="bg-[#0e1018] border border-gray-700/50 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500/50"
                >
                  {expiryChoices.length > 0 ? (
                    expiryChoices.map(ex => (
                      <option key={ex} value={ex}>
                        {ex}
                      </option>
                    ))
                  ) : (
                    <option value="">Select expiry</option>
                  )}
                </select>
              </div>
              <TradeOptionsPanel
                backendUrl={backendUrl}
                symbol={tradeSym}
                expiry={tradeExpiry}
                onDone={() => {
                  onRefreshPositions?.();
                  // FIX: also reload order book so new order appears
                  // in Orders/Sell tabs without requiring manual navigation.
                  loadOrders();
                  addToast(
                    'Order placed successfully',
                    'success',
                  );
                }}
              />
            </div>
          ) : (
            <EmptyState
              icon={<Activity size={36} />}
              title="Connect backend to place orders"
              subtitle="Connect Broker → Kaggle URL → Validate"
            />
          )}
        </div>
      )}

      {/* ═══ SELL ORDERS TAB ═══
            FIX: Use style display toggle (not conditional render) so
            OrderBookTable's internal search/sort/pagination state survives
            tab switches — as promised in the v9 changelog. */}
      <div
        className="bg-[#1a1d2e] mx-4 rounded-2xl border border-gray-700/30 overflow-hidden"
        role="tabpanel"
        id="tabpanel-sell"
        style={{ display: subTab === 'sell' ? '' : 'none' }}
      >
        <div className="px-4 py-2 border-b border-gray-800/40 flex items-center gap-2">
          <TrendingDown
            size={12}
            className="text-red-400"
          />
          <span className="text-white text-[11px] font-semibold">
            Sell Orders Only
          </span>
          <span className="text-gray-600 text-[10px]">
            — filtered view
          </span>
        </div>
        <OrderBookTable
          orders={sellOrders}
          loading={ordersLoading}
          canFetch={canFetch}
          onRefresh={loadOrders}
          onCancel={handleCancel}
          lastRefresh={lastRefresh['sell'] ?? null}
        />
      </div>

      {/* ═══ ORDER BOOK TAB ═══ */}
      <div
        className="bg-[#1a1d2e] mx-4 rounded-2xl border border-gray-700/30 overflow-hidden"
        role="tabpanel"
        id="tabpanel-orders"
        style={{ display: subTab === 'orders' ? '' : 'none' }}
      >
        <OrderBookTable
          orders={orders}
          loading={ordersLoading}
          canFetch={canFetch}
          onRefresh={loadOrders}
          onCancel={handleCancel}
          lastRefresh={lastRefresh['orders'] ?? null}
          onBatchCancel={() =>
            setShowBatchCancelConfirm(true)
          }
        />
      </div>

      {/* ═══ TRADE BOOK TAB ═══ */}
      <div
        className="bg-[#1a1d2e] mx-4 rounded-2xl border border-gray-700/30 overflow-hidden"
        role="tabpanel"
        id="tabpanel-trades"
        style={{ display: subTab === 'trades' ? '' : 'none' }}
      >
        <TradeBookTable
          trades={trades}
          loading={tradesLoading}
          canFetch={canFetch}
          onRefresh={loadTrades}
          lastRefresh={lastRefresh['trades'] ?? null}
        />
      </div>

      {/* ═══ FUNDS TAB ═══ */}
      <div
        className="bg-[#1a1d2e] mx-4 rounded-2xl border border-gray-700/30 overflow-hidden"
        role="tabpanel"
        id="tabpanel-funds"
        style={{ display: subTab === 'funds' ? '' : 'none' }}
      >
        <FundsDashboard
          funds={funds}
          loading={fundsLoading}
          canFetch={canFetch}
          onRefresh={loadFunds}
          lastRefresh={lastRefresh['funds'] ?? null}
        />
      </div>

      <div className="h-6" />

      {/* ── Square Off Modal ── */}
      {sqOffPos && (
        <SquareOffModal
          pos={sqOffPos}
          backendUrl={backendUrl}
          onClose={() => setSqOffPos(null)}
          onOrdersPlaced={() => {
            onRefreshPositions?.();
            addToast(
              'Exit orders placed — check Order Book',
              'info',
            );
          }}
        />
      )}

      {/* ── Batch Cancel Confirmation ── */}
      <ConfirmDialog
        open={showBatchCancelConfirm}
        title="Cancel All Pending Orders"
        variant="danger"
        confirmLabel={
          batchCancelling ? 'Cancelling…' : 'Cancel All'
        }
        loading={batchCancelling}
        onCancel={() => setShowBatchCancelConfirm(false)}
        onConfirm={handleBatchCancel}
        message={
          <div className="space-y-2">
            <p>
              This will attempt to cancel{' '}
              <strong className="text-white">
                {
                  orders.filter(o => {
                    const s = String(
                      o.status || '',
                    ).toLowerCase();
                    return (
                      s.includes('open') ||
                      s.includes('pend')
                    );
                  }).length
                }
              </strong>{' '}
              pending order(s).
            </p>
            <p className="text-red-300 text-[10px] font-semibold">
              ⚠ Cannot be undone. Orders already executing may
              not cancel.
            </p>
          </div>
        }
      />
    </div>
  );
};

// ── Export with Error Boundary ──
export const Positions: FC<Props> = props => (
  <PositionsPanelErrorBoundary>
    <PositionsInner {...props} />
  </PositionsPanelErrorBoundary>
);
