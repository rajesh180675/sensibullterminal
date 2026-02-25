// components/OptionChain/components/Toolbar.tsx

import React, { memo, useState, useCallback } from 'react';
import { RefreshCw, Download, Eye, EyeOff, Target } from 'lucide-react';
import type { ExpiryDate, SymbolCode } from '../../../types/index';
import { SYMBOL_CONFIG } from '../../../config/market';
import { STRIKE_RANGE_OPTIONS } from '../constants';

const Sep = memo(function Sep() {
  return <div className="h-3 w-px bg-gray-800 mx-0.5 shrink-0" aria-hidden="true" />;
});

interface ToolbarProps {
  cfg: (typeof SYMBOL_CONFIG)[SymbolCode];
  expiries: ExpiryDate[];
  selectedExpiry: ExpiryDate;
  onExpiryChange: (e: ExpiryDate) => void;
  showGreeks: boolean;
  onToggleGreeks: () => void;
  showOIBars: boolean;
  onToggleOIBars: () => void;
  showOISignals: boolean;
  onToggleOISignals: () => void;
  strikeRange: number;
  onStrikeRangeChange: (n: number) => void;
  isLoading: boolean;
  isLive?: boolean;
  loadingMsg?: string;
  lastUpdate: Date;
  canRefresh: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onExportFiltered: () => void;
  onScrollATM: () => void;
  // SPEC-F5: Strike search
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
}

export const Toolbar = memo<ToolbarProps>(function Toolbar({
  cfg, expiries, selectedExpiry, onExpiryChange,
  showGreeks, onToggleGreeks, showOIBars, onToggleOIBars,
  showOISignals, onToggleOISignals,
  strikeRange, onStrikeRangeChange,
  isLoading, isLive, loadingMsg, lastUpdate,
  canRefresh, onRefresh, onExport, onExportFiltered, onScrollATM,
  tableContainerRef,
}) {
  // SPEC-F5: Strike search state
  const [strikeSearch, setStrikeSearch] = useState('');

  const handleStrikeSearch = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return;
      const target = Number(strikeSearch);
      if (!Number.isFinite(target)) return;
      const el = tableContainerRef.current?.querySelector<HTMLElement>(
        `tr[data-strike="${target}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
    },
    [strikeSearch, tableContainerRef],
  );

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50
                 bg-[#1a1d2e] flex-shrink-0 flex-wrap gap-y-1"
      role="toolbar"
      aria-label="Option chain controls"
    >
      {/* Symbol badge */}
      <span className="text-gray-600 text-[10px] font-medium shrink-0">
        {cfg.displayName} ·{' '}
        <span className="text-gray-500">{cfg.breezeStockCode}/{cfg.breezeExchangeCode}</span>
        {' '}· Lot <span className="text-amber-400 font-bold">{cfg.lotSize}</span>
        {' '}· Step ₹{cfg.strikeStep}
      </span>

      <Sep />

      {/* Expiry selector — SPEC-A4: scrollable overflow */}
      <span className="text-gray-700 text-[10px] shrink-0" id="expiry-label">Expiry:</span>
      <div
        className="flex items-center gap-1 overflow-x-auto no-scroll max-w-[300px]"
        role="radiogroup"
        aria-labelledby="expiry-label"
      >
        {expiries.map((exp) => {
          const isSelected = selectedExpiry.breezeValue === exp.breezeValue;
          return (
            <button
              key={exp.breezeValue}
              onClick={() => onExpiryChange(exp)}
              role="radio"
              aria-checked={isSelected}
              className={`px-2.5 py-0.5 text-[10px] rounded-lg font-medium transition-all shrink-0
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400
                ${isSelected
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                  : 'bg-[#20233a] text-gray-500 hover:text-white border border-gray-700/30'
                }`}
            >
              {exp.label}
              <span className="ml-1 opacity-50 text-[8px]">{exp.daysToExpiry}d</span>
            </button>
          );
        })}
      </div>

      <Sep />

      {/* Greeks toggle */}
      <button onClick={onToggleGreeks} aria-pressed={showGreeks}
        className={`px-2 py-0.5 text-[10px] rounded-lg font-medium transition-colors shrink-0 border
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400
          ${showGreeks
            ? 'bg-purple-600/15 text-purple-300 border-purple-500/25'
            : 'bg-[#20233a] text-gray-600 hover:text-white border-gray-700/30'}`}>
        Δ Greeks
      </button>

      {/* OI bar toggle */}
      <button onClick={onToggleOIBars} aria-pressed={showOIBars}
        aria-label={showOIBars ? 'Hide OI bars' : 'Show OI bars'}
        className={`flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded-lg font-medium
          transition-colors shrink-0 border focus-visible:outline focus-visible:outline-2
          focus-visible:outline-blue-400
          ${showOIBars
            ? 'bg-blue-600/10 text-blue-400 border-blue-500/20'
            : 'bg-[#20233a] text-gray-600 hover:text-white border-gray-700/30'}`}>
        {showOIBars ? <Eye size={9} /> : <EyeOff size={9} />} OI
      </button>

      {/* SPEC-F2: OI signals toggle */}
      <button onClick={onToggleOISignals} aria-pressed={showOISignals}
        title="Show OI interpretation (Long Buildup / Short Buildup / etc.)"
        className={`px-2 py-0.5 text-[10px] rounded-lg font-medium transition-colors shrink-0 border
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400
          ${showOISignals
            ? 'bg-emerald-600/10 text-emerald-400 border-emerald-500/20'
            : 'bg-[#20233a] text-gray-600 hover:text-white border-gray-700/30'}`}>
        OI Sig
      </button>

      {/* Strike range */}
      <div className="flex items-center gap-1 shrink-0">
        <label htmlFor="strike-range-sel" className="text-gray-700 text-[10px]">Range:</label>
        <select
          id="strike-range-sel"
          value={strikeRange}
          onChange={(e) => onStrikeRangeChange(Number(e.target.value))}
          className="bg-[#20233a] text-gray-400 text-[10px] px-1.5 py-0.5 rounded-lg border
            border-gray-700/30 focus-visible:outline focus-visible:outline-2
            focus-visible:outline-blue-400 appearance-none cursor-pointer"
        >
          {STRIKE_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* SPEC-F5: Strike search */}
      <div className="flex items-center gap-1 shrink-0">
        <label htmlFor="strike-search" className="text-gray-700 text-[10px]">Strike:</label>
        <input
          id="strike-search"
          type="number"
          placeholder="e.g. 22500"
          value={strikeSearch}
          onChange={(e) => setStrikeSearch(e.target.value)}
          onKeyDown={handleStrikeSearch}
          className="bg-[#20233a] text-gray-300 text-[10px] px-1.5 py-0.5 w-20 rounded-lg
            border border-gray-700/30 placeholder:text-gray-700
            focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
        />
      </div>

      {/* Scroll-to-ATM */}
      <button onClick={onScrollATM} title="Scroll to ATM" aria-label="Scroll to ATM strike"
        className="p-1 text-gray-700 hover:text-yellow-400 hover:bg-gray-700/40 rounded-lg
          transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400">
        <Target size={11} />
      </button>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {isLoading && <RefreshCw size={10} className="text-blue-400 animate-spin" aria-label="Refreshing" />}
        {isLive ? (
          <span className="flex items-center gap-1 text-emerald-400 text-[9px] font-semibold" role="status">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full pulse-dot" aria-hidden="true" />
            LIVE
          </span>
        ) : (
          <span className="text-amber-500 text-[9px] font-semibold">DEMO</span>
        )}
        {loadingMsg && (
          <span className="text-gray-600 text-[9px] max-w-[200px] truncate" title={loadingMsg} role="status">
            {loadingMsg}
          </span>
        )}
        <time className="text-gray-700 text-[10px] mono" dateTime={lastUpdate.toISOString()}>
          {lastUpdate.toLocaleTimeString()}
        </time>
        <button onClick={onRefresh} disabled={!canRefresh}
          title={canRefresh ? 'Refresh chain' : 'Cooling down…'} aria-label="Refresh option chain"
          className="p-1 text-gray-700 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg
            transition-colors disabled:opacity-30 disabled:cursor-not-allowed
            focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
          <RefreshCw size={11} />
        </button>
        {/* SPEC-F9: Export full + filtered */}
        <div className="relative group">
          <button title="Download CSV" aria-label="Export chain as CSV"
            className="p-1 text-gray-700 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg
              transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
            <Download size={11} />
          </button>
          <div className="absolute right-0 top-full mt-1 bg-[#1a1d2e] border border-gray-700/40
            rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none
            group-hover:pointer-events-auto transition-opacity z-50 py-1 min-w-[120px]">
            <button onClick={onExport}
              className="w-full text-left px-3 py-1 text-[10px] text-gray-400 hover:text-white
                hover:bg-gray-700/30 transition-colors">
              Export All
            </button>
            <button onClick={onExportFiltered}
              className="w-full text-left px-3 py-1 text-[10px] text-gray-400 hover:text-white
                hover:bg-gray-700/30 transition-colors">
              Export Filtered
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
