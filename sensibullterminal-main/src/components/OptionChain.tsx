// ================================================================
// OPTION CHAIN — Dense CE/PE grid, OI bars, live flash ticks
// Data: generateChain() (demo) or fetchOptionChain() (live Breeze)
// ================================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, Download, Eye, EyeOff, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { OptionRow, OptionLeg, ExpiryDate, SymbolCode } from '../types/index';
import { getExpiries, SYMBOL_CONFIG }                   from '../config/market';
import { fmtOI }                                         from '../utils/math';

interface Props {
  symbol:             SymbolCode;
  data:               OptionRow[];
  spotPrice:          number;
  selectedExpiry:     ExpiryDate;
  onExpiryChange:     (e: ExpiryDate) => void;
  onAddLeg:           (leg: Omit<OptionLeg, 'id'>) => void;
  highlightedStrikes: Set<number>;
  lastUpdate:         Date;
  isLoading:          boolean;
  onRefresh:          () => void;
  isLive?:            boolean;
  loadingMsg?:        string;
}

type FlashDir = 'up' | 'dn';

function fmtCell(key: string, v: number): string {
  if (key.endsWith('_oi') && !key.includes('iv'))  return fmtOI(Math.abs(v));
  if (key.includes('oiChg'))  return (v >= 0 ? '+' : '') + fmtOI(v);
  if (key.includes('_ltp') || key.includes('bid') || key.includes('ask')) return v.toFixed(2);
  if (key.includes('_iv'))    return v.toFixed(1) + '%';
  if (key.includes('delta'))  return v.toFixed(3);
  if (key.includes('volume')) return fmtOI(v);
  return String(v);
}

const OIBar: React.FC<{ val: number; max: number; side: 'ce' | 'pe' }> = ({ val, max, side }) => {
  const pct = Math.min(100, (Math.abs(val) / Math.max(max, 1)) * 100);
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className={`absolute inset-y-0 opacity-[0.12] ${side === 'ce' ? 'right-0 bg-blue-400' : 'left-0 bg-orange-400'}`}
        style={{ width: `${pct}%` }}/>
    </div>
  );
};

const CE_BASIC  = ['ce_oi','ce_oiChg','ce_volume','ce_iv','ce_ltp'] as const;
const CE_GREEKS = ['ce_oi','ce_oiChg','ce_volume','ce_iv','ce_delta','ce_theta','ce_ltp'] as const;
const PE_BASIC  = ['pe_ltp','pe_iv','pe_volume','pe_oiChg','pe_oi'] as const;
const PE_GREEKS = ['pe_ltp','pe_iv','pe_delta','pe_theta','pe_volume','pe_oiChg','pe_oi'] as const;

const LABELS: Record<string, string> = {
  ce_oi:'OI', ce_oiChg:'OI Chg', ce_volume:'Vol', ce_iv:'IV',
  ce_delta:'Δ', ce_theta:'Θ', ce_ltp:'LTP',
  pe_ltp:'LTP', pe_iv:'IV', pe_delta:'Δ', pe_theta:'Θ',
  pe_volume:'Vol', pe_oiChg:'OI Chg', pe_oi:'OI',
};

export const OptionChain: React.FC<Props> = ({
  symbol, data, spotPrice, selectedExpiry, onExpiryChange,
  onAddLeg, highlightedStrikes, lastUpdate, isLoading, onRefresh,
  isLive, loadingMsg,
}) => {
  const [showGreeks, setShowGreeks] = useState(false);
  const [showOIBars, setShowOIBars] = useState(true);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [flashed,    setFlashed]    = useState<Map<string, FlashDir>>(new Map());

  const atmRef  = useRef<HTMLTableRowElement>(null);
  const prevRef = useRef<Map<number, OptionRow>>(new Map());
  const expiries = getExpiries(symbol);
  const cfg      = SYMBOL_CONFIG[symbol];

  // Scroll ATM into view on symbol change
  useEffect(() => {
    const t = setTimeout(() => atmRef.current?.scrollIntoView({ behavior:'smooth', block:'center' }), 350);
    return () => clearTimeout(t);
  }, [symbol]);

  // Flash cells on tick change
  useEffect(() => {
    const nf = new Map<string, FlashDir>();
    data.forEach(row => {
      const p = prevRef.current.get(row.strike);
      if (!p) return;
      if (p.ce_ltp !== row.ce_ltp) nf.set(`ce_ltp_${row.strike}`, row.ce_ltp > p.ce_ltp ? 'up' : 'dn');
      if (p.pe_ltp !== row.pe_ltp) nf.set(`pe_ltp_${row.strike}`, row.pe_ltp > p.pe_ltp ? 'up' : 'dn');
      if (p.ce_oi  !== row.ce_oi)  nf.set(`ce_oi_${row.strike}`,  row.ce_oi  > p.ce_oi  ? 'up' : 'dn');
      if (p.pe_oi  !== row.pe_oi)  nf.set(`pe_oi_${row.strike}`,  row.pe_oi  > p.pe_oi  ? 'up' : 'dn');
    });
    if (nf.size) {
      setFlashed(nf);
      const t = setTimeout(() => setFlashed(new Map()), 700);
      prevRef.current = new Map(data.map(r => [r.strike, r]));
      return () => clearTimeout(t);
    }
    prevRef.current = new Map(data.map(r => [r.strike, r]));
  }, [data]);

  const addLeg = useCallback((row: OptionRow, type: 'CE'|'PE', action: 'BUY'|'SELL') => {
    onAddLeg({
      symbol, type, strike: row.strike, action, lots: 1,
      ltp:   type === 'CE' ? row.ce_ltp   : row.pe_ltp,
      iv:    type === 'CE' ? row.ce_iv    : row.pe_iv,
      delta: type === 'CE' ? row.ce_delta : row.pe_delta,
      theta: type === 'CE' ? row.ce_theta : row.pe_theta,
      gamma: type === 'CE' ? row.ce_gamma : row.pe_gamma,
      vega:  type === 'CE' ? row.ce_vega  : row.pe_vega,
      expiry: selectedExpiry.breezeValue,
    });
  }, [onAddLeg, symbol, selectedExpiry.breezeValue]);

  const ceCols = [...(showGreeks ? CE_GREEKS : CE_BASIC)].reverse();
  const peCols = showGreeks ? PE_GREEKS : PE_BASIC;

  const maxOI   = Math.max(...data.map(r => Math.max(r.ce_oi, r.pe_oi)), 1);
  const totCeOI = data.reduce((s,r) => s+r.ce_oi, 0);
  const totPeOI = data.reduce((s,r) => s+r.pe_oi, 0);
  const pcr     = totCeOI > 0 ? (totPeOI/totCeOI).toFixed(2) : 'N/A';
  const atmRow  = data.find(r => r.isATM);
  const maxPain = Math.round(spotPrice / cfg.strikeStep) * cfg.strikeStep;

  return (
    <div className="flex flex-col h-full bg-[#13161f] overflow-hidden">

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/50 bg-[#1a1d2e] flex-shrink-0 flex-wrap gap-y-1">
        <span className="text-gray-600 text-[10px] font-medium shrink-0">
          {cfg.displayName} · <span className="text-gray-500">{cfg.breezeStockCode}/{cfg.breezeExchangeCode}</span> · Lot <span className="text-amber-400 font-bold">{cfg.lotSize}</span> · Step ₹{cfg.strikeStep}
        </span>
        <div className="h-3 w-px bg-gray-800 mx-0.5 shrink-0"/>

        <span className="text-gray-700 text-[10px] shrink-0">Expiry:</span>
        <div className="flex items-center gap-1 flex-wrap">
          {expiries.map(exp => (
            <button key={exp.breezeValue} onClick={() => onExpiryChange(exp)}
              className={`px-2.5 py-0.5 text-[10px] rounded-lg font-medium transition-all shrink-0 ${
                selectedExpiry.breezeValue === exp.breezeValue
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                  : 'bg-[#20233a] text-gray-500 hover:text-white border border-gray-700/30'
              }`}>
              {exp.label}
              <span className="ml-1 opacity-50 text-[8px]">{exp.daysToExpiry}d</span>
            </button>
          ))}
        </div>

        <div className="h-3 w-px bg-gray-800 mx-0.5 shrink-0"/>
        <button onClick={() => setShowGreeks(!showGreeks)}
          className={`px-2 py-0.5 text-[10px] rounded-lg font-medium transition-colors shrink-0 border ${
            showGreeks ? 'bg-purple-600/15 text-purple-300 border-purple-500/25' : 'bg-[#20233a] text-gray-600 hover:text-white border-gray-700/30'
          }`}>
          Δ Greeks
        </button>
        <button onClick={() => setShowOIBars(!showOIBars)}
          className={`flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded-lg font-medium transition-colors shrink-0 border ${
            showOIBars ? 'bg-blue-600/10 text-blue-400 border-blue-500/20' : 'bg-[#20233a] text-gray-600 hover:text-white border-gray-700/30'
          }`}>
          {showOIBars ? <Eye size={9}/> : <EyeOff size={9}/>} OI
        </button>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {isLoading && <RefreshCw size={10} className="text-blue-400 animate-spin"/>}
          {isLive
            ? <span className="flex items-center gap-1 text-emerald-400 text-[9px] font-semibold">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full pulse-dot"/>LIVE
              </span>
            : <span className="text-amber-500 text-[9px] font-semibold">DEMO</span>
          }
          {loadingMsg && (
            <span className="text-gray-600 text-[9px] max-w-[200px] truncate" title={loadingMsg}>
              {loadingMsg}
            </span>
          )}
          <span className="text-gray-700 text-[10px] mono">{lastUpdate.toLocaleTimeString()}</span>
          <button onClick={onRefresh} title="Refresh chain" className="p-1 text-gray-700 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg transition-colors">
            <RefreshCw size={11}/>
          </button>
          <button className="p-1 text-gray-700 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg transition-colors">
            <Download size={11}/>
          </button>
        </div>
      </div>

      {/* ── Stats strip ─────────────────────────────────── */}
      <div className="flex items-center gap-4 px-3 py-1 bg-[#0e1018] border-b border-gray-800/50 text-[10px] flex-shrink-0 overflow-x-auto no-scroll">
        {[
          { lbl:'SPOT',     val:`₹${spotPrice.toLocaleString('en-IN')}`,       cls:'text-white font-bold mono' },
          { lbl:'PCR',      val:pcr,                                             cls:`font-bold mono ${Number(pcr)>1?'text-emerald-400':'text-red-400'}` },
          { lbl:'ATM IV',   val:`${atmRow?.ce_iv.toFixed(1) ?? '--'}%`,          cls:'text-purple-400 font-bold mono' },
          { lbl:'Max Pain', val:`₹${maxPain.toLocaleString('en-IN')}`,           cls:'text-amber-400 font-bold mono' },
          { lbl:'DTE',      val:`${selectedExpiry.daysToExpiry}d`,               cls:'text-blue-400 font-bold' },
          { lbl:'CE OI',    val:fmtOI(totCeOI),                                  cls:'text-blue-400' },
          { lbl:'PE OI',    val:fmtOI(totPeOI),                                  cls:'text-orange-400' },
        ].map(s => (
          <span key={s.lbl} className="flex items-center gap-1 shrink-0">
            <span className="text-gray-700">{s.lbl}</span>
            <span className={s.cls}>{s.val}</span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2 shrink-0 text-[9px]">
          <span className="text-blue-500">■ CE</span>
          <span className="text-orange-500">■ PE</span>
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[10px]" style={{ minWidth: 800 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th colSpan={ceCols.length + 1}
                className="py-1 text-center bg-blue-950/60 border-b border-blue-900/30 text-blue-400 font-semibold text-[9px] tracking-widest">
                ← CALLS (CE)
              </th>
              <th className="py-1 text-center bg-[#0e1018] border-b border-gray-800/40 text-gray-600 font-semibold text-[9px] tracking-wide" style={{ minWidth: 90 }}>
                STRIKE
              </th>
              <th colSpan={peCols.length + 1}
                className="py-1 text-center bg-orange-950/60 border-b border-orange-900/30 text-orange-400 font-semibold text-[9px] tracking-widest">
                PUTS (PE) →
              </th>
            </tr>
            <tr className="bg-[#0e1018] border-b border-gray-800/50">
              <th className="py-1 px-1.5 w-[52px] text-gray-700 text-[9px] font-medium">Act</th>
              {ceCols.map(c => (
                <th key={c} className="py-1 px-2 text-gray-600 font-medium text-[9px] text-right whitespace-nowrap">{LABELS[c]}</th>
              ))}
              <th className="py-1 px-2 text-gray-500 font-bold text-[9px] text-center bg-[#080b12]/50">Price</th>
              {peCols.map(c => (
                <th key={c} className="py-1 px-2 text-gray-600 font-medium text-[9px] text-left whitespace-nowrap">{LABELS[c]}</th>
              ))}
              <th className="py-1 px-1.5 w-[52px] text-gray-700 text-[9px] font-medium">Act</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => {
              const isATM = !!row.isATM;
              const isHL  = highlightedStrikes.has(row.strike);
              const isHov = hoveredRow === row.strike;

              return (
                <tr key={row.strike}
                  ref={isATM ? atmRef : undefined}
                  onMouseEnter={() => setHoveredRow(row.strike)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className={`border-b transition-colors duration-75 ${
                    isATM ? 'bg-yellow-400/[0.035] border-yellow-700/20' :
                    isHL  ? 'bg-blue-500/[0.055] border-blue-700/20' :
                    isHov ? 'bg-gray-700/[0.12] border-gray-700/20' :
                    'border-gray-800/20'
                  }`}>

                  {/* CE action buttons */}
                  <td className="px-1 py-[2px] text-center">
                    <div className={`flex gap-0.5 justify-center transition-opacity duration-150 ${isHov ? 'opacity-100' : 'opacity-0'}`}>
                      <button onClick={() => addLeg(row,'CE','BUY')}
                        className="px-1.5 py-0.5 bg-emerald-600/20 hover:bg-emerald-500/40 text-emerald-400 text-[8px] rounded font-bold border border-emerald-600/25 leading-none">B</button>
                      <button onClick={() => addLeg(row,'CE','SELL')}
                        className="px-1.5 py-0.5 bg-red-600/20 hover:bg-red-500/40 text-red-400 text-[8px] rounded font-bold border border-red-600/25 leading-none">S</button>
                    </div>
                  </td>

                  {/* CE data */}
                  {ceCols.map(col => {
                    const val   = row[col as keyof OptionRow] as number;
                    const fkey  = `${col}_${row.strike}`;
                    const flash = flashed.get(fkey);
                    const isLTP = col === 'ce_ltp';
                    const isChg = col === 'ce_oiChg';
                    const isOI  = col === 'ce_oi';
                    return (
                      <td key={col} className={`py-[3px] px-2 text-right relative ${flash ? (flash==='up' ? 'flash-up' : 'flash-dn') : ''}`}>
                        {isOI && showOIBars && <OIBar val={val} max={maxOI} side="ce"/>}
                        <span className={`relative z-10 mono ${
                          isLTP ? 'font-bold text-blue-300 text-[11px]' :
                          isChg ? (val >= 0 ? 'text-emerald-400' : 'text-red-400') :
                          'text-gray-500'
                        }`}>
                          {isLTP && flash && (
                            flash === 'up'
                              ? <TrendingUp size={7} className="inline mr-0.5 text-emerald-400"/>
                              : <TrendingDown size={7} className="inline mr-0.5 text-red-400"/>
                          )}
                          {fmtCell(col, val)}
                        </span>
                      </td>
                    );
                  })}

                  {/* Strike */}
                  <td className={`py-[3px] px-2 text-center font-bold text-[11px] bg-[#080b12]/30 border-x border-gray-800/20 ${isATM ? 'text-yellow-400' : 'text-gray-300'}`}>
                    <div className="flex flex-col items-center leading-tight">
                      {isATM && <span className="text-[7px] bg-yellow-500/12 text-yellow-500 px-1 rounded border border-yellow-500/20 mb-0.5">ATM</span>}
                      <span className="mono">{row.strike.toLocaleString('en-IN')}</span>
                      {isHL && <Zap size={7} className="text-blue-400 mt-0.5"/>}
                    </div>
                  </td>

                  {/* PE data */}
                  {peCols.map(col => {
                    const val   = row[col as keyof OptionRow] as number;
                    const fkey  = `${col}_${row.strike}`;
                    const flash = flashed.get(fkey);
                    const isLTP = col === 'pe_ltp';
                    const isChg = col === 'pe_oiChg';
                    const isOI  = col === 'pe_oi';
                    return (
                      <td key={col} className={`py-[3px] px-2 text-left relative ${flash ? (flash==='up' ? 'flash-up' : 'flash-dn') : ''}`}>
                        {isOI && showOIBars && <OIBar val={val} max={maxOI} side="pe"/>}
                        <span className={`relative z-10 mono ${
                          isLTP ? 'font-bold text-orange-300 text-[11px]' :
                          isChg ? (val >= 0 ? 'text-emerald-400' : 'text-red-400') :
                          'text-gray-500'
                        }`}>
                          {fmtCell(col, val)}
                        </span>
                      </td>
                    );
                  })}

                  {/* PE action buttons */}
                  <td className="px-1 py-[2px] text-center">
                    <div className={`flex gap-0.5 justify-center transition-opacity duration-150 ${isHov ? 'opacity-100' : 'opacity-0'}`}>
                      <button onClick={() => addLeg(row,'PE','BUY')}
                        className="px-1.5 py-0.5 bg-emerald-600/20 hover:bg-emerald-500/40 text-emerald-400 text-[8px] rounded font-bold border border-emerald-600/25 leading-none">B</button>
                      <button onClick={() => addLeg(row,'PE','SELL')}
                        className="px-1.5 py-0.5 bg-red-600/20 hover:bg-red-500/40 text-red-400 text-[8px] rounded font-bold border border-red-600/25 leading-none">S</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-gray-800/50 bg-[#0e1018] text-[9px] text-gray-700 flex-shrink-0">
        <span>Hover row → <span className="text-emerald-500 font-bold">B</span>=Buy <span className="text-red-500 font-bold">S</span>=Sell → adds to Strategy Builder</span>
        <span className="ml-auto">{data.length} strikes · {cfg.breezeStockCode}/{cfg.breezeExchangeCode} · {selectedExpiry.breezeValue}</span>
      </div>
    </div>
  );
};
