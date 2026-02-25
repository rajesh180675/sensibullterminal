// ================================================================
// TOP BAR — Ticker strip + symbol selector + tabs + broker status
//
// BUG 7 FIX: TopBar now receives spotPrice and liveIndices as props
// instead of reading module-level SPOT_PRICES / MARKET_INDICES constants.
// React cannot track mutations to module-level objects, so the ticker
// strip and spot display never re-rendered when live prices arrived.
// ================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  TrendingUp, TrendingDown, Activity, Wifi, WifiOff,
  ChevronDown, Bell, Settings, Zap,
} from 'lucide-react';
import { SYMBOL_CONFIG, ALL_SYMBOLS, SPOT_PRICES } from '../config/market';
import { BreezeSession, SymbolCode, MarketIndex } from '../types/index';

interface Props {
  selectedSymbol:   SymbolCode;
  onSymbolChange:   (s: SymbolCode) => void;
  activeTab:        string;
  onTabChange:      (t: string) => void;
  session:          BreezeSession | null;
  onOpenBroker:     () => void;
  strategyLegCount: number;
  lastUpdate:       Date;
  isLive?:          boolean;
  loadingMsg?:      string;
  // BUG 7 FIX: Live spot + indices passed as props so React re-renders on update
  spotPrice?:       number;
  liveIndices?:     MarketIndex[];
}

const TABS = [
  { id: 'optionchain', label: 'Option Chain' },
  { id: 'strategy',    label: 'Strategy Builder' },
  { id: 'positions',   label: 'Positions' },
];

export const TopBar: React.FC<Props> = ({
  selectedSymbol, onSymbolChange, activeTab, onTabChange,
  session, onOpenBroker, strategyLegCount, lastUpdate,
  isLive, loadingMsg, spotPrice, liveIndices,
}) => {
  const [showDD, setShowDD] = useState(false);
  const hideDropdownTimeoutRef = useRef<number | null>(null);
  const cfg         = SYMBOL_CONFIG[selectedSymbol];

  // BUG 7 FIX: prefer prop over stale module-level constant
  const spot        = spotPrice ?? SPOT_PRICES[selectedSymbol];
  const isConnected = session?.isConnected ?? false;

  // BUG 7 FIX: use liveIndices prop (React state) not MARKET_INDICES constant
  // Duplicate array for infinite scroll ticker
  const doubled = liveIndices
    ? [...liveIndices, ...liveIndices]
    : [];   // empty until first live update — cleaner than showing stale values

  useEffect(() => {
    return () => {
      if (hideDropdownTimeoutRef.current !== null) {
        window.clearTimeout(hideDropdownTimeoutRef.current);
      }
    };
  }, []);

  return (
    <header className="bg-[#13161f] border-b border-gray-800/60 flex-shrink-0 select-none">

      {/* ── Animated ticker ───────────────────────────────── */}
      <div className="bg-[#0a0c15] border-b border-gray-800/70 overflow-hidden h-[22px] flex items-center">
        <div className="ticker-track">
          {doubled.map((idx, i) => (
            <span key={i} className="flex items-center gap-1.5 px-4 text-[10px] whitespace-nowrap">
              <span className="text-gray-600 font-medium">{idx.label}</span>
              <span className="text-gray-300 font-bold mono">
                {idx.value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              <span className={`flex items-center gap-0.5 font-semibold ${idx.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {idx.change >= 0 ? <TrendingUp size={8}/> : <TrendingDown size={8}/>}
                {idx.change >= 0 ? '+' : ''}{idx.change.toFixed(2)}
                <span className="opacity-60 text-[9px]">({idx.pct >= 0 ? '+' : ''}{idx.pct.toFixed(2)}%)</span>
              </span>
              <span className="text-gray-800 mx-1">│</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Nav row ───────────────────────────────────────── */}
      <div className="flex items-center h-11 px-4 gap-2">

        {/* Logo */}
        <div className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="w-7 h-7 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md shadow-indigo-500/30">
            <Activity size={14} className="text-white"/>
          </div>
          <div className="leading-none">
            <span className="text-white font-black text-[13px] tracking-widest">sensibull</span>
            <span className="ml-1.5 text-[8px] text-indigo-400 border border-indigo-500/30 px-1 py-0.5 rounded">clone</span>
          </div>
        </div>

        <div className="h-4 w-px bg-gray-800 mx-1"/>

        {/* Symbol dropdown */}
        <div className="relative flex-shrink-0">
            <button
            onClick={() => setShowDD(v => !v)}
            onBlur={() => {
              if (hideDropdownTimeoutRef.current !== null) {
                window.clearTimeout(hideDropdownTimeoutRef.current);
              }
              hideDropdownTimeoutRef.current = window.setTimeout(() => setShowDD(false), 200);
            }}
            className="flex items-center gap-2.5 bg-[#1e2135] hover:bg-[#252840] border border-gray-700/40 rounded-xl px-3 py-1.5 transition-colors"
          >
            <div className="text-left">
              <div className="text-white text-[11px] font-bold leading-tight">{cfg.displayName}</div>
              <div className="text-gray-600 text-[9px] leading-tight">{cfg.exchange} · Lot {cfg.lotSize} · {cfg.expiryDay}s</div>
            </div>
            <div className="text-right">
              {/* BUG 7 FIX: uses prop-derived `spot`, re-renders on every live update */}
              <div className="text-emerald-400 text-[12px] font-bold mono">
                ₹{spot.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              {isLive && <div className="text-[8px] text-emerald-600">● live</div>}
            </div>
            <ChevronDown size={11} className={`text-gray-600 transition-transform ${showDD ? 'rotate-180' : ''}`}/>
          </button>

          {showDD && (
            <div className="absolute top-full left-0 mt-1.5 bg-[#1a1d2e] border border-gray-700/40 rounded-2xl shadow-2xl shadow-black/60 z-50 py-1.5 min-w-[320px]">
              {ALL_SYMBOLS.map(sym => {
                const c   = SYMBOL_CONFIG[sym];
                // BUG 7 FIX: show live spot for selected symbol, cached for others
                const s   = sym === selectedSymbol ? spot : SPOT_PRICES[sym];
                const sel = sym === selectedSymbol;
                return (
                  <button key={sym} onMouseDown={() => { onSymbolChange(sym); setShowDD(false); }}
                    className={`w-full flex items-center justify-between px-4 py-3 text-xs transition-colors hover:bg-[#252840] ${sel ? 'bg-blue-500/5' : ''}`}>
                    <div className="text-left">
                      <div className={`font-bold text-sm ${sel ? 'text-blue-400' : 'text-white'}`}>{c.displayName}</div>
                      <div className="text-gray-600 text-[10px] mt-0.5 mono">
                        {c.exchange} · Breeze: <span className="text-gray-500">{c.breezeStockCode}</span> · Lot <span className="text-amber-500">{c.lotSize}</span> · Step ₹{c.strikeStep} · {c.expiryDay}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="mono font-bold text-emerald-400 text-sm">₹{s.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                      {sel && <div className="text-[9px] text-blue-400">● active</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Tabs */}
        <nav className="flex items-center gap-0.5 ml-3">
          {TABS.map(t => (
            <button key={t.id} onClick={() => onTabChange(t.id)}
              className={`relative px-3 py-1.5 text-[11px] rounded-lg font-medium transition-all ${
                activeTab === t.id
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                  : 'text-gray-500 hover:text-white hover:bg-gray-700/40'
              }`}>
              {t.label}
              {t.id === 'strategy' && strategyLegCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-black text-[8px] font-black rounded-full flex items-center justify-center leading-none">
                  {strategyLegCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-1.5">
          {isLive && (
            <span className="flex items-center gap-1 text-emerald-400 text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full pulse-dot"/>LIVE DATA
            </span>
          )}
          {loadingMsg && isLive && (
            <span className="text-gray-600 text-[9px] max-w-[140px] truncate hidden md:block" title={loadingMsg}>
              {loadingMsg}
            </span>
          )}
          <span className="text-gray-700 text-[10px] mono hidden sm:block">
            {lastUpdate.toLocaleTimeString('en-IN')}
          </span>

          <button onClick={onOpenBroker}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors ${
              isConnected
                ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15'
                : 'bg-amber-500/8 border-amber-500/20 text-amber-400 hover:bg-amber-500/15 animate-pulse'
            }`}>
            {isConnected ? <Wifi size={10}/> : <WifiOff size={10}/>}
            {isConnected ? (
              <>Live <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block pulse-dot ml-0.5"/></>
            ) : 'Connect Broker'}
          </button>

          <button onClick={onOpenBroker}
            className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600/10 border border-indigo-500/15 text-indigo-400 rounded-lg text-[10px] font-medium hover:bg-indigo-600/20 transition-colors">
            <Zap size={9}/> Breeze API
          </button>

          <button className="p-1.5 text-gray-700 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg transition-colors">
            <Bell size={13}/>
          </button>
          <button className="p-1.5 text-gray-700 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg transition-colors">
            <Settings size={13}/>
          </button>

          <div className="flex items-center gap-1.5 bg-[#1e2135] border border-gray-700/30 rounded-lg px-2 py-1">
            <div className="w-5 h-5 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center text-[9px] font-black text-white">T</div>
            <span className="text-gray-500 text-[10px]">Trader</span>
          </div>
        </div>

      </div>
    </header>
  );
};
