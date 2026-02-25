// components/OptionChain/OptionChain.tsx

import React, { useRef, useCallback, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import type { OptionChainProps } from './types';
import { SYMBOL_CONFIG, getExpiries } from '../../config/market';
import {
  CE_BASIC, CE_GREEKS, PE_BASIC, PE_GREEKS,
  STALE_THRESHOLD_SEC,
} from './constants';

// Hooks
import { useFlashCells } from './hooks/useFlashCells';
import { useChainStats } from './hooks/useChainStats';
import { useFilteredData } from './hooks/useFilteredData';
import { useScrollToATM } from './hooks/useScrollToATM';
import { useRefreshThrottle } from './hooks/useRefreshThrottle';
import { useColumnSort } from './hooks/useColumnSort';
import { useStalenessTimer } from './hooks/useStalenessTimer';
import { useChainPreferences } from './hooks/useChainPreferences';

// Utils
import { exportToCSV } from './utils/exportToCSV';

// Components
import { Toolbar } from './components/Toolbar';
import { StatsStrip } from './components/StatsStrip';
import { ChainHeader } from './components/ChainHeader';
import { ChainRow } from './components/ChainRow';
import { ChainFooter } from './components/ChainFooter';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { EmptyState } from './components/EmptyState';
import { ErrorBanner } from './components/ErrorBanner';
import { StalenessWarning } from './components/StalenessWarning';
import { OptionChainErrorBoundary } from './OptionChainErrorBoundary';

// ════════════════════════════════════════════════════════════════

const OptionChainInner: React.FC<OptionChainProps> = ({
  symbol, data, spotPrice, selectedExpiry, onExpiryChange,
  onAddLeg, highlightedStrikes, lastUpdate, isLoading, onRefresh,
  isLive, loadingMsg, error, strikeRange: strikeRangeProp,
}) => {
  // ── Preferences (SPEC-F4) ───────────────────────────────
  const [prefs, updatePrefs] = useChainPreferences();

  // ── Refs ─────────────────────────────────────────────────
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  // ── Config ───────────────────────────────────────────────
  const cfg = SYMBOL_CONFIG[symbol];
  const expiries = useMemo(() => (cfg ? getExpiries(symbol) : []), [symbol, cfg]);

  // ── Hooks ────────────────────────────────────────────────
  const filteredData = useFilteredData(data, prefs.strikeRange, spotPrice, symbol);
  const stats = useChainStats(data, spotPrice, symbol);
  const flashed = useFlashCells(data);
  const [canRefresh, startCooldown] = useRefreshThrottle(isLoading);
  const scrollToATM = useScrollToATM(symbol, filteredData.length, tableContainerRef);
  const staleSec = useStalenessTimer(lastUpdate);
  const isStale = staleSec > STALE_THRESHOLD_SEC;

  // ── Sorting (SPEC-F1) ───────────────────────────────────
  const { sortedData, sortState, toggleSort } = useColumnSort(
    filteredData,
    symbol,
    selectedExpiry.breezeValue,
  );

  // ── Column arrays ────────────────────────────────────────
  const ceCols = useMemo(
    () => [...(prefs.showGreeks ? CE_GREEKS : CE_BASIC)].reverse(),
    [prefs.showGreeks],
  );
  const peCols = useMemo(
    () => [...(prefs.showGreeks ? PE_GREEKS : PE_BASIC)],
    [prefs.showGreeks],
  );

  // ── Callbacks ────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    if (!canRefresh) return;
    startCooldown();
    onRefresh();
  }, [canRefresh, startCooldown, onRefresh]);

  const handleExportAll = useCallback(() => {
    exportToCSV(data, symbol, selectedExpiry.breezeValue, spotPrice, false);
  }, [data, symbol, selectedExpiry.breezeValue, spotPrice]);

  const handleExportFiltered = useCallback(() => {
    exportToCSV(filteredData, symbol, selectedExpiry.breezeValue, spotPrice, true);
  }, [filteredData, symbol, selectedExpiry.breezeValue, spotPrice]);

  const handleAddLeg = useCallback(
    (strike: number, type: 'CE' | 'PE', action: 'BUY' | 'SELL') => {
      const row = data.find((r) => r.strike === strike);
      if (!row) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[OptionChain] strike ${strike} not found`);
        }
        return;
      }
      const isCE = type === 'CE';
      onAddLeg({
        symbol, type, strike: row.strike, action, lots: 1,
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

  const [focusedStrike, setFocusedStrike] = React.useState<number | null>(null);
  const handleFocusStrike = useCallback((s: number | null) => setFocusedStrike(s), []);

  // Arrow key navigation
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const container = tableContainerRef.current;
      if (!container) return;
      e.preventDefault();
      const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr[data-strike]'));
      if (rows.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      let idx = -1;
      if (active) idx = rows.findIndex((r) => r === active || r.contains(active));
      const nextIdx = e.key === 'ArrowDown'
        ? Math.min(idx + 1, rows.length - 1)
        : Math.max(idx - 1, 0);
      const nextRow = rows[nextIdx];
      if (nextRow) {
        nextRow.focus({ preventScroll: false });
        const strike = Number(nextRow.dataset.strike);
        if (Number.isFinite(strike)) setFocusedStrike(strike);
      }
    },
    [],
  );

  // ── Guard ────────────────────────────────────────────────
  if (!cfg) {
    return (
      <div className="flex items-center justify-center h-full bg-[#13161f] text-red-400 text-sm"
           role="alert" data-testid="chain-unknown-symbol">
        <AlertCircle size={16} className="mr-2" />
        Unknown symbol: <code className="ml-1 font-mono text-red-300">{symbol}</code>
      </div>
    );
  }

  // ── Render flags ─────────────────────────────────────────
  const showTable = sortedData.length > 0 && !error;
  const showEmpty = sortedData.length === 0 && !isLoading && !error;
  const showSkeleton = isLoading && data.length === 0;

  return (
    <div className="flex flex-col h-full bg-[#13161f] overflow-hidden"
         role="region" aria-label={`${cfg.displayName} option chain`} data-testid="option-chain">

      <Toolbar
        cfg={cfg}
        expiries={expiries}
        selectedExpiry={selectedExpiry}
        onExpiryChange={onExpiryChange}
        showGreeks={prefs.showGreeks}
        onToggleGreeks={() => updatePrefs({ showGreeks: !prefs.showGreeks })}
        showOIBars={prefs.showOIBars}
        onToggleOIBars={() => updatePrefs({ showOIBars: !prefs.showOIBars })}
        showOISignals={prefs.showOISignals}
        onToggleOISignals={() => updatePrefs({ showOISignals: !prefs.showOISignals })}
        strikeRange={prefs.strikeRange}
        onStrikeRangeChange={(n) => updatePrefs({ strikeRange: n })}
        isLoading={isLoading}
        isLive={isLive}
        loadingMsg={loadingMsg}
        lastUpdate={lastUpdate}
        canRefresh={canRefresh}
        onRefresh={handleRefresh}
        onExport={handleExportAll}
        onExportFiltered={handleExportFiltered}
        onScrollATM={scrollToATM}
        tableContainerRef={tableContainerRef}
      />

      {isStale && !isLoading && (
        <StalenessWarning staleSec={staleSec} canRefresh={canRefresh} onRefresh={handleRefresh} />
      )}

      {data.length > 0 && (
        <StatsStrip spotPrice={spotPrice} stats={stats} selectedExpiry={selectedExpiry} />
      )}

      {error && <ErrorBanner message={error} onRetry={handleRefresh} />}
      {showSkeleton && <LoadingSkeleton />}
      {showEmpty && <EmptyState symbol={cfg.displayName} expiry={selectedExpiry.label} />}

      {showTable && (
        <div ref={tableContainerRef} className="flex-1 overflow-auto" onKeyDown={handleTableKeyDown}>
          <table className="w-full border-collapse text-[10px]" style={{ minWidth: 800 }}
                 role="grid" aria-label={`${cfg.displayName} option chain grid`}
                 aria-rowcount={sortedData.length} aria-colcount={ceCols.length + peCols.length + 3}>
            <ChainHeader
              ceCols={ceCols}
              peCols={peCols}
              sortState={sortState}
              onToggleSort={toggleSort}
            />
            <tbody>
              {sortedData.map((row, idx) => (
                <ChainRow
                  key={row.strike}
                  row={row}
                  ceCols={ceCols}
                  peCols={peCols}
                  isATM={!!row.isATM}
                  isHighlighted={highlightedStrikes.has(row.strike)}
                  isMaxCeOI={row.strike === stats.maxCeOIStrike && stats.totalCeOI > 0}
                  isMaxPeOI={row.strike === stats.maxPeOIStrike && stats.totalPeOI > 0}
                  showOIBars={prefs.showOIBars}
                  showOISignals={prefs.showOISignals}
                  maxOI={stats.maxOI}
                  flashed={flashed}
                  onAddLeg={handleAddLeg}
                  rowIndex={idx}
                  focusedStrike={focusedStrike}
                  onFocusStrike={handleFocusStrike}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ChainFooter
        rowCount={sortedData.length}
        totalCount={data.length}
        stockCode={cfg.breezeStockCode}
        exchangeCode={cfg.breezeExchangeCode}
        expiryVal={selectedExpiry.breezeValue}
      />
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// PUBLIC EXPORT
// ════════════════════════════════════════════════════════════════

export const OptionChain: React.FC<OptionChainProps> = (props) => {
  return (
    <OptionChainErrorBoundary onReset={props.onRefresh}>
      <OptionChainInner {...props} />
    </OptionChainErrorBoundary>
  );
};
