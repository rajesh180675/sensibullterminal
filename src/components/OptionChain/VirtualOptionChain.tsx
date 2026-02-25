import React, {
  useRef,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
} from 'react';
import { AlertCircle } from 'lucide-react';
import type { OptionChainProps } from './types';
import { SYMBOL_CONFIG, getExpiries } from '../../config/market';
import {
  CE_BASIC,
  CE_GREEKS,
  PE_BASIC,
  PE_GREEKS,
  STALE_THRESHOLD_SEC,
} from './constants';

import { useFlashCells } from './hooks/useFlashCells';
import { useChainStats } from './hooks/useChainStats';
import { useFilteredData } from './hooks/useFilteredData';
import { useScrollToATM } from './hooks/useScrollToATM';
import { useRefreshThrottle } from './hooks/useRefreshThrottle';
import { useColumnSort } from './hooks/useColumnSort';
import { useStalenessTimer } from './hooks/useStalenessTimer';
import { useChainPreferences } from './hooks/useChainPreferences';

import { exportToCSV } from './utils/exportToCSV';

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

const ROW_HEIGHT_PX = 32;
const OVERSCAN_ROWS = 12;

const VirtualOptionChainInner: React.FC<OptionChainProps> = ({
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
  availableExpiries: _availableExpiries,  // FIX-5 accepted but unused in virtual renderer
}) => {
  const [prefs, updatePrefs] = useChainPreferences();
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const cfg = SYMBOL_CONFIG[symbol];
  const expiries = useMemo(() => (cfg ? getExpiries(symbol) : []), [symbol, cfg]);

  const filteredData = useFilteredData(data, prefs.strikeRange, spotPrice, symbol);
  const stats = useChainStats(data, spotPrice, symbol);
  const flashed = useFlashCells(data);
  const [canRefresh, startCooldown] = useRefreshThrottle(isLoading);
  const baseScrollToATM = useScrollToATM(symbol, filteredData.length, tableContainerRef);
  const staleSec = useStalenessTimer(lastUpdate);
  const isStale = staleSec > STALE_THRESHOLD_SEC;

  const { sortedData, sortState, toggleSort } = useColumnSort(
    filteredData,
    symbol,
    selectedExpiry.breezeValue,
  );

  const ceCols = useMemo(
    () => [...(prefs.showGreeks ? CE_GREEKS : CE_BASIC)].reverse(),
    [prefs.showGreeks],
  );
  const peCols = useMemo(
    () => [...(prefs.showGreeks ? PE_GREEKS : PE_BASIC)],
    [prefs.showGreeks],
  );

  const atmIndex = useMemo(
    () => sortedData.findIndex((row) => Boolean(row.isATM)),
    [sortedData],
  );

  const scrollToATM = useCallback(() => {
    const container = tableContainerRef.current;
    if (!container) {
      baseScrollToATM();
      return;
    }

    if (atmIndex >= 0) {
      const targetTop = Math.max(
        0,
        atmIndex * ROW_HEIGHT_PX - (container.clientHeight / 2 - ROW_HEIGHT_PX / 2),
      );
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
      requestAnimationFrame(() => baseScrollToATM());
      return;
    }

    baseScrollToATM();
  }, [atmIndex, baseScrollToATM]);

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
      if (!row) return;
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

  const [focusedStrike, setFocusedStrike] = useState<number | null>(null);
  const handleFocusStrike = useCallback((s: number | null) => setFocusedStrike(s), []);

  const handleTableKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const container = tableContainerRef.current;
    if (!container) return;
    e.preventDefault();

    const rows = Array.from(
      container.querySelectorAll<HTMLTableRowElement>('tbody tr[data-strike]'),
    );
    if (rows.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const idx = active ? rows.findIndex((r) => r === active || r.contains(active)) : -1;
    const nextIdx = e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
    const nextRow = rows[nextIdx];
    if (!nextRow) return;

    nextRow.focus({ preventScroll: false });
    const strike = Number(nextRow.dataset.strike);
    if (Number.isFinite(strike)) setFocusedStrike(strike);
  }, []);

  useLayoutEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const sync = () => {
      setViewportHeight(container.clientHeight || 480);
      setScrollTop(container.scrollTop || 0);
    };

    sync();

    const ro = new ResizeObserver(sync);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const maxScroll = Math.max(0, sortedData.length * ROW_HEIGHT_PX - container.clientHeight);
    if (container.scrollTop > maxScroll) {
      container.scrollTop = maxScroll;
      setScrollTop(maxScroll);
    }
  }, [sortedData.length]);

  const visible = useMemo(() => {
    const total = sortedData.length;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2;
    const end = Math.min(total, start + visibleCount);

    return {
      start,
      end,
      rows: sortedData.slice(start, end),
      topSpacer: start * ROW_HEIGHT_PX,
      bottomSpacer: Math.max(0, (total - end) * ROW_HEIGHT_PX),
    };
  }, [sortedData, scrollTop, viewportHeight]);

  if (!cfg) {
    return (
      <div
        className="flex items-center justify-center h-full bg-[#13161f] text-red-400 text-sm"
        role="alert"
        data-testid="chain-unknown-symbol"
      >
        <AlertCircle size={16} className="mr-2" />
        Unknown symbol: <code className="ml-1 font-mono text-red-300">{symbol}</code>
      </div>
    );
  }

  const showTable = sortedData.length > 0 && !error;
  const showEmpty = sortedData.length === 0 && !isLoading && !error;
  const showSkeleton = isLoading && data.length === 0;
  const colCount = ceCols.length + peCols.length + 3;

  return (
    <div
      className="flex flex-col h-full bg-[#13161f] overflow-hidden"
      role="region"
      aria-label={`${cfg.displayName} option chain`}
      data-testid="option-chain-virtual"
    >
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
        <div
          ref={tableContainerRef}
          className="flex-1 overflow-auto"
          onKeyDown={handleTableKeyDown}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <table
            className="w-full border-collapse text-[10px]"
            style={{ minWidth: 800 }}
            role="grid"
            aria-label={`${cfg.displayName} option chain virtualized grid`}
            aria-rowcount={sortedData.length}
            aria-colcount={colCount}
          >
            <ChainHeader ceCols={ceCols} peCols={peCols} sortState={sortState} onToggleSort={toggleSort} />
            <tbody>
              {visible.topSpacer > 0 && (
                <tr aria-hidden="true" style={{ height: visible.topSpacer }}>
                  <td colSpan={colCount} className="p-0 border-0" />
                </tr>
              )}

              {visible.rows.map((row, localIndex) => {
                const absoluteIndex = visible.start + localIndex;
                return (
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
                    rowIndex={absoluteIndex}
                    focusedStrike={focusedStrike}
                    onFocusStrike={handleFocusStrike}
                  />
                );
              })}

              {visible.bottomSpacer > 0 && (
                <tr aria-hidden="true" style={{ height: visible.bottomSpacer }}>
                  <td colSpan={colCount} className="p-0 border-0" />
                </tr>
              )}
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

export const VirtualOptionChain: React.FC<OptionChainProps> = (props) => {
  return (
    <OptionChainErrorBoundary onReset={props.onRefresh}>
      <VirtualOptionChainInner {...props} />
    </OptionChainErrorBoundary>
  );
};
