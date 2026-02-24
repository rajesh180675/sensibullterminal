// ════════════════════════════════════════════════════════════════════════════
// POSITIONS PANEL v6 — Complete rewrite with:
//   • Editable lot quantity in Square Off (partial exit support)
//   • Live qty recomputation (lots × lotSize, never stale)
//   • Market + Limit order type per leg with clear UX
//   • Trade Options tab for new Buy/Sell orders
//   • Order Book, Trade Book, Funds via Kaggle backend
//   • Cancel Order functionality
// ════════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Clock, CheckCircle, FileText,
  ChevronDown, ChevronRight, Zap, X, RefreshCw,
  DollarSign, BookOpen, List, AlertTriangle, Target,
  ArrowUpDown, Crosshair, ShieldAlert, Activity, Search, Copy, Check,
  BarChart3, Info, Edit3, Minus, Plus,
} from 'lucide-react';
import { Position, SymbolCode, BreezeSession } from '../types/index';
import { MOCK_POSITIONS }  from '../data/mock';
import { SYMBOL_CONFIG }   from '../config/market';
import { fmtPnL }          from '../utils/math';
import {
  fetchFunds, fetchOrderBook, fetchTradeBook,
  cancelOrder, squareOffPosition, placeOrder,
  isKaggleBackend,
  type FundsData, type OrderBookRow, type TradeBookRow,
} from '../utils/kaggleClient';

interface Props {
  onLoadToBuilder:     (pos: Position) => void;
  livePositions?:      Position[] | null;
  isLive?:             boolean;
  session?:            BreezeSession | null;
  onRefreshPositions?: () => void;
}

type Filter    = 'ALL' | 'ACTIVE' | 'DRAFT' | 'CLOSED';
type SubTab    = 'positions' | 'trade' | 'sell' | 'orders' | 'trades' | 'funds';
type OrderType = 'market' | 'limit';
type SortDir = 'asc' | 'desc';

function resolvePositions(
  liveFlag: boolean,
  livePositions: Position[] | null | undefined,
): Position[] {
  if (liveFlag && livePositions !== null && livePositions !== undefined)
    return livePositions;
  return MOCK_POSITIONS;
}

const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const extractTimestamp = (row: Record<string, unknown>): string => {
  const candidates = ['exchange_time', 'trade_time', 'order_time', 'created_at', 'updated_at', 'datetime', 'timestamp'];
  const raw = candidates.find(k => typeof row[k] === 'string' && String(row[k]).trim().length > 0);
  return raw ? String(row[raw]) : '—';
};

// ─────────────────────────────────────────────────────────────────────────────
// LOT STEPPER — editable lot count with live qty display
// ─────────────────────────────────────────────────────────────────────────────
const LotStepper: React.FC<{
  lots:      number;
  maxLots:   number;
  lotSize:   number;
  onChange:  (lots: number) => void;
}> = ({ lots, maxLots, lotSize, onChange }) => {
  const qty = lots * lotSize;
  return (
    <div className="space-y-1.5">
      {/* Stepper row */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(1, lots - 1))}
          disabled={lots <= 1}
          className="w-8 h-8 bg-gray-700/60 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed
                     text-white rounded-lg flex items-center justify-center transition-colors"
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
              const v = parseInt(e.target.value) || 1;
              onChange(Math.min(maxLots, Math.max(1, v)));
            }}
            className="w-full text-center bg-[#0a0c15] border border-gray-700/40 focus:border-blue-500/60
                       text-white text-sm font-bold rounded-xl py-1.5 mono outline-none"
          />
          <div className="absolute -top-2.5 left-0 right-0 flex justify-between text-[8px] text-gray-700 px-1">
            <span>1</span>
            <span>max {maxLots}</span>
          </div>
        </div>

        <button
          onClick={() => onChange(Math.min(maxLots, lots + 1))}
          disabled={lots >= maxLots}
          className="w-8 h-8 bg-gray-700/60 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed
                     text-white rounded-lg flex items-center justify-center transition-colors"
        >
          <Plus size={12} />
        </button>

        <Edit3 size={9} className="text-gray-700" />
      </div>

      {/* Explicit qty display — always visible */}
      <div className="flex items-center justify-between bg-[#0e1018] rounded-xl px-3 py-2 border border-gray-800/40">
        <div className="text-[10px] text-gray-600">
          {lots} lot{lots !== 1 ? 's' : ''} × <span className="text-amber-400 font-bold">{lotSize}</span> =
        </div>
        <div className="text-white font-black text-base mono">{qty} <span className="text-gray-600 text-[10px] font-normal">qty</span></div>
        {lots < maxLots && (
          <div className="text-[9px] text-blue-400/60">
            ({maxLots - lots} remaining)
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SQUARE OFF MODAL — elegant, with editable lots (partial exit)
// ─────────────────────────────────────────────────────────────────────────────

interface SqOffLeg {
  legIndex:     number;
  type:         'CE' | 'PE';
  strike:       number;
  origAction:   'BUY' | 'SELL';
  exitAction:   'BUY' | 'SELL';
  maxLots:      number;   // original position lots
  lots:         number;   // editable — how many to exit
  lotSize:      number;
  entryPrice:   number;
  currentPrice: number;
  pnl:          number;
  selected:     boolean;
  limitPrice:   string;
  orderType:    OrderType;
  status:       'idle' | 'placing' | 'done' | 'error';
  resultMsg:    string;
}

const SquareOffModal: React.FC<{
  pos:        Position;
  backendUrl: string;
  onClose:    () => void;
  onDone:     () => void;
}> = ({ pos, backendUrl, onClose, onDone }) => {
  const cfg    = SYMBOL_CONFIG[pos.symbol as SymbolCode] ?? SYMBOL_CONFIG['NIFTY'];
  const [step, setStep]  = useState<'configure' | 'confirm' | 'done'>('configure');
  const [legs, setLegs]  = useState<SqOffLeg[]>(() =>
    pos.legs.map((l, i) => ({
      legIndex:     i,
      type:         l.type,
      strike:       l.strike,
      origAction:   l.action,
      exitAction:   l.action === 'BUY' ? 'SELL' : 'BUY',
      maxLots:      l.lots,
      lots:         l.lots,       // starts at full lots, user can reduce
      lotSize:      cfg.lotSize,
      entryPrice:   l.entryPrice,
      currentPrice: l.currentPrice,
      pnl:          l.pnl,
      selected:     true,
      limitPrice:   l.currentPrice.toFixed(2),
      orderType:    'market' as OrderType,
      status:       'idle' as const,
      resultMsg:    '',
    }))
  );
  const [placing, setPlacing] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !placing) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, placing]);

  // Derived — always recomputed from current lots (never stale)
  const selected    = legs.filter(l => l.selected);
  const totalPnlEst = useMemo(() =>
    selected.reduce((s, l) => {
      const perLot = l.pnl / Math.max(l.maxLots, 1);
      return s + perLot * l.lots;
    }, 0), [selected]);

  const upd = (idx: number, patch: Partial<SqOffLeg>) =>
    setLegs(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));

  const handleExecute = async () => {
    if (selected.length === 0) return;
    setPlacing(true);
    const msgs: string[] = [];

    for (const leg of selected) {
      upd(leg.legIndex, { status: 'placing' });
      // qty is ALWAYS derived here — not from stale state
      const qty = leg.lots * leg.lotSize;
      try {
        const r = await squareOffPosition(backendUrl, {
          stockCode:    cfg.breezeStockCode,
          exchangeCode: cfg.breezeExchangeCode,
          action:       leg.origAction,      // backend flips to exitAction
          quantity:     String(qty),
          expiryDate:   pos.expiry,
          right:        leg.type === 'CE' ? 'call' : 'put',
          strikePrice:  String(leg.strike),
          orderType:    leg.orderType,
          price:        leg.orderType === 'limit' ? leg.limitPrice : '0',
        });
        if (r.ok) {
          upd(leg.legIndex, { status: 'done', resultMsg: `✓ OrderID: ${r.orderId ?? 'placed'}` });
          msgs.push(`✓ ${leg.type} ${leg.strike.toLocaleString('en-IN')} EXIT ${leg.exitAction} ${leg.lots}L (${qty}qty) → ${r.orderId ?? 'OK'}`);
        } else {
          upd(leg.legIndex, { status: 'error', resultMsg: r.error ?? 'Failed' });
          msgs.push(`✗ ${leg.type} ${leg.strike.toLocaleString('en-IN')}: ${r.error ?? 'error'}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        upd(leg.legIndex, { status: 'error', resultMsg: msg });
        msgs.push(`✗ ${leg.type} ${leg.strike.toLocaleString('en-IN')}: ${msg}`);
      }
    }

    setResults(msgs);
    setStep('done');
    setPlacing(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-[#13161f] border border-gray-700/60 rounded-2xl shadow-2xl w-full max-w-[700px] max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800/60 flex-shrink-0">
          <div className="w-10 h-10 bg-red-500/15 border border-red-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <ShieldAlert size={18} className="text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-sm">Square Off — Partial or Full Exit</h2>
            <p className="text-gray-600 text-[10px]">
              {cfg.displayName} · {pos.strategy} · 1 lot = <span className="text-amber-400 font-bold">{cfg.lotSize}</span> qty · edit lots per leg to partially exit
            </p>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-1 text-[9px] font-semibold flex-shrink-0">
            {(['configure', 'confirm', 'done'] as const).map((s, i) => (
              <React.Fragment key={s}>
                <span className={`px-2 py-0.5 rounded-full border ${
                  step === s
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : ['configure', 'confirm', 'done'].indexOf(step) > i
                      ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400'
                      : 'bg-gray-800/40 border-gray-700/20 text-gray-600'
                }`}>
                  {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
                {i < 2 && <span className="text-gray-700">→</span>}
              </React.Fragment>
            ))}
          </div>
          <button onClick={onClose} className="ml-2 p-1.5 text-gray-600 hover:text-white hover:bg-gray-700/50 rounded-lg flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── DONE ── */}
          {step === 'done' && (
            <div className="space-y-3">
              <div className="text-center py-4">
                <CheckCircle size={44} className="text-emerald-400 mx-auto mb-3" />
                <h3 className="text-white font-bold text-base">Exit Orders Placed</h3>
                <p className="text-gray-600 text-xs mt-1">Review results below</p>
              </div>
              <div className="bg-[#0e1018] rounded-xl border border-gray-800/40 p-4 space-y-2">
                {results.map((r, i) => (
                  <p key={i} className={`text-xs font-mono ${r.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{r}</p>
                ))}
              </div>
              <div className="space-y-2">
                {legs.map((leg, i) => (
                  <div key={i} className={`flex items-center justify-between p-3 rounded-xl border text-[11px] ${
                    leg.status === 'done'  ? 'bg-emerald-500/5 border-emerald-500/20' :
                    leg.status === 'error' ? 'bg-red-500/5 border-red-500/20' :
                    'bg-gray-800/20 border-gray-700/20 opacity-40'
                  }`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-bold text-sm ${leg.type === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}>{leg.type}</span>
                      <span className="text-white font-bold mono">{leg.strike.toLocaleString('en-IN')}</span>
                      <span className="text-gray-600 text-[9px] font-mono">
                        {leg.lots}L × {leg.lotSize} = <span className="text-white font-bold">{leg.lots * leg.lotSize}</span> qty
                      </span>
                    </div>
                    <span className={leg.status === 'done' ? 'text-emerald-400' : leg.status === 'error' ? 'text-red-400' : 'text-gray-600'}>
                      {leg.resultMsg || (leg.selected ? '—' : 'not selected')}
                    </span>
                  </div>
                ))}
              </div>
              <button onClick={onClose} className="w-full py-2.5 bg-gray-700/60 hover:bg-gray-700 text-white rounded-xl text-sm font-medium transition-colors">
                Close
              </button>
            </div>
          )}

          {/* ── CONFIGURE ── */}
          {step === 'configure' && (
            <>
              {/* P&L banner */}
              <div className={`flex items-center justify-between p-4 rounded-2xl border ${
                totalPnlEst >= 0 ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-red-500/8 border-red-500/25'
              }`}>
                <div>
                  <div className="text-gray-500 text-[10px] mb-0.5">Estimated Exit P&L ({selected.length} of {legs.length} legs)</div>
                  <div className={`text-3xl font-black mono ${totalPnlEst >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalPnlEst >= 0 ? '+' : ''}₹{Math.round(totalPnlEst).toLocaleString('en-IN')}
                  </div>
                  <div className="text-gray-700 text-[9px] mt-0.5">* Based on current LTP, proportional to lots selected</div>
                </div>
                <div className="text-right">
                  <div className="text-gray-600 text-[10px]">{pos.strategy}</div>
                  <div className="text-white text-xs font-semibold">{pos.expiry}</div>
                  <div className="text-amber-400 text-[10px] font-bold mt-1">
                    1 lot = {cfg.lotSize} qty · {cfg.displayName}
                  </div>
                </div>
              </div>

              {/* Global controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-600 text-[10px] font-semibold">All legs:</span>
                <button onClick={() => setLegs(prev => prev.map(l => ({ ...l, orderType: 'market' })))}
                  className="px-3 py-1 bg-amber-600/15 hover:bg-amber-600/25 border border-amber-500/30 text-amber-300 text-[10px] rounded-lg transition-colors font-semibold">
                  Set Market
                </button>
                <button onClick={() => setLegs(prev => prev.map(l => ({ ...l, orderType: 'limit' })))}
                  className="px-3 py-1 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-blue-300 text-[10px] rounded-lg transition-colors font-semibold">
                  Set Limit
                </button>
                <button onClick={() => setLegs(prev => prev.map(l => ({ ...l, lots: l.maxLots })))}
                  className="px-3 py-1 bg-gray-700/40 hover:bg-gray-700/60 border border-gray-600/30 text-gray-400 text-[10px] rounded-lg transition-colors">
                  Full Exit (all lots)
                </button>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setLegs(prev => prev.map(l => ({ ...l, selected: true })))}
                    className="text-blue-400 text-[10px] hover:underline">Select all</button>
                  <button onClick={() => setLegs(prev => prev.map(l => ({ ...l, selected: false })))}
                    className="text-gray-600 text-[10px] hover:underline">Deselect all</button>
                </div>
              </div>

              {/* Leg cards */}
              <div className="space-y-4">
                {legs.map((leg, i) => (
                  <div key={i} className={`rounded-2xl border transition-all ${
                    leg.selected
                      ? leg.type === 'CE'
                        ? 'bg-blue-950/15 border-blue-700/40'
                        : 'bg-orange-950/15 border-orange-700/40'
                      : 'bg-gray-900/30 border-gray-800/20 opacity-40'
                  }`}>
                    <div className="p-4 space-y-4">
                      {/* Row 1: select + instrument + entry/exit badges */}
                      <div className="flex items-start gap-3">
                        <button onClick={() => upd(i, { selected: !leg.selected })}
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                            leg.selected ? 'bg-blue-600 border-blue-500' : 'border-gray-600'
                          }`}>
                          {leg.selected && <CheckCircle size={11} className="text-white" />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-black ${leg.type === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}>
                              {leg.type}
                            </span>
                            <span className="text-white font-bold text-sm mono">
                              {leg.strike.toLocaleString('en-IN')}
                            </span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                              leg.origAction === 'BUY' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                            }`}>
                              ENTRY: {leg.origAction}
                            </span>
                            <ArrowUpDown size={10} className="text-gray-600" />
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md border ${
                              leg.exitAction === 'BUY'
                                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                : 'bg-red-500/20 border-red-500/40 text-red-300'
                            }`}>
                              EXIT: {leg.exitAction}
                            </span>
                          </div>

                          {/* Price info */}
                          <div className="flex items-center gap-4 text-[10px] mt-1.5">
                            <span className="text-gray-600">Entry: <span className="text-gray-400 mono font-semibold">₹{leg.entryPrice.toFixed(2)}</span></span>
                            <span className="text-gray-600">LTP: <span className="text-white font-bold mono">₹{leg.currentPrice.toFixed(2)}</span></span>
                            <span className={`font-bold mono ${leg.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {leg.pnl >= 0 ? '+' : ''}₹{leg.pnl.toFixed(0)} P&L
                            </span>
                          </div>
                        </div>
                      </div>

                      {leg.selected && (
                        <>
                          {/* Row 2: Lot stepper — editable, live qty display */}
                          <div className="border-t border-gray-800/30 pt-3">
                            <div className="text-[10px] text-gray-500 font-semibold mb-2 flex items-center gap-1.5">
                              <Edit3 size={9} className="text-blue-400" />
                              How many lots to exit?
                              <span className="text-gray-700 font-normal">(max: {leg.maxLots})</span>
                            </div>
                            <LotStepper
                              lots={leg.lots}
                              maxLots={leg.maxLots}
                              lotSize={leg.lotSize}
                              onChange={lots => upd(i, { lots })}
                            />
                          </div>

                          {/* Row 3: Order type */}
                          <div className="border-t border-gray-800/30 pt-3">
                            <div className="text-[10px] text-gray-500 font-semibold mb-2">Order Type</div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="flex rounded-xl overflow-hidden border border-gray-700/50 text-[10px]">
                                <button
                                  onClick={() => upd(i, { orderType: 'market' })}
                                  className={`px-4 py-2 font-bold transition-colors ${
                                    leg.orderType === 'market'
                                      ? 'bg-amber-600 text-white'
                                      : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
                                  }`}
                                >
                                  MARKET
                                </button>
                                <button
                                  onClick={() => upd(i, { orderType: 'limit' })}
                                  className={`px-4 py-2 font-bold transition-colors ${
                                    leg.orderType === 'limit'
                                      ? 'bg-blue-600 text-white'
                                      : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
                                  }`}
                                >
                                  LIMIT
                                </button>
                              </div>

                              {leg.orderType === 'market' && (
                                <span className="text-[10px] text-gray-600">
                                  Executes immediately at best available price
                                </span>
                              )}

                              {leg.orderType === 'limit' && (
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-gray-500 text-[10px] flex-shrink-0">Limit price ₹</span>
                                  <input
                                    type="number"
                                    value={leg.limitPrice}
                                    onChange={e => upd(i, { limitPrice: e.target.value })}
                                    step="0.05"
                                    min="0.05"
                                    className="w-28 bg-[#0a0c15] border border-blue-500/50 focus:border-blue-400 text-white text-sm rounded-xl px-3 py-1.5 mono outline-none text-right"
                                  />
                                  <span className="text-gray-700 text-[10px]">or better</span>
                                </div>
                              )}
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

          {/* ── CONFIRM ── */}
          {step === 'confirm' && (
            <>
              <div className={`p-4 rounded-2xl border ${
                totalPnlEst >= 0 ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-red-500/8 border-red-500/25'
              }`}>
                <div className="text-gray-500 text-[10px] mb-1">Estimated Exit P&L — {selected.length} leg{selected.length !== 1 ? 's' : ''}</div>
                <div className={`text-2xl font-black mono mb-1 ${totalPnlEst >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {totalPnlEst >= 0 ? '+' : ''}₹{Math.round(totalPnlEst).toLocaleString('en-IN')}
                </div>
              </div>

              {/* Order summary table */}
              <div className="bg-[#0e1018] rounded-2xl border border-gray-800/40 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-800/40 text-[9px] text-gray-700 uppercase tracking-wider font-semibold">
                  Order Summary — review before placing
                </div>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-gray-600 text-[9px] border-b border-gray-800/30">
                      <th className="px-4 py-2 text-left">Instrument</th>
                      <th className="px-4 py-2 text-center">Exit</th>
                      <th className="px-4 py-2 text-right">Lots</th>
                      <th className="px-4 py-2 text-right bg-amber-500/5">Qty</th>
                      <th className="px-4 py-2 text-center">Order</th>
                      <th className="px-4 py-2 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((leg, i) => {
                      const qty = leg.lots * leg.lotSize;
                      return (
                        <tr key={i} className="border-b border-gray-800/20 last:border-0">
                          <td className="px-4 py-3 mono">
                            <span className={`font-bold ${leg.type === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}>{leg.type}</span>
                            {' '}
                            <span className="text-white font-semibold">{leg.strike.toLocaleString('en-IN')}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-[9px] font-bold px-2 py-1 rounded-lg ${
                              leg.exitAction === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                            }`}>{leg.exitAction}</span>
                          </td>
                          <td className="px-4 py-3 text-right mono text-amber-400 font-bold">{leg.lots}</td>
                          <td className="px-4 py-3 text-right bg-amber-500/5">
                            <div className="mono font-black text-white">{qty}</div>
                            <div className="text-[8px] text-gray-700">{leg.lots}×{leg.lotSize}</div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-lg ${
                              leg.orderType === 'market'
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-blue-500/15 text-blue-300'
                            }`}>{leg.orderType.toUpperCase()}</span>
                          </td>
                          <td className="px-4 py-3 text-right mono">
                            {leg.orderType === 'market'
                              ? <span className="text-gray-500">at market</span>
                              : <span className="text-blue-300 font-bold">₹{leg.limitPrice}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2.5 p-3.5 bg-red-500/8 border border-red-500/25 rounded-xl">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-[11px] text-red-300 space-y-0.5">
                  <p className="font-bold text-red-200">This places LIVE orders via ICICI Breeze API.</p>
                  <p>{selected.length} exit order{selected.length > 1 ? 's' : ''} will execute. Cannot be undone.</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer buttons */}
        {step !== 'done' && (
          <div className="flex gap-3 px-5 py-4 border-t border-gray-800/60 flex-shrink-0">
            {step === 'configure' ? (
              <>
                <button onClick={onClose} className="flex-1 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  disabled={selected.length === 0}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  <Target size={14} /> Review Exit ({selected.length} leg{selected.length !== 1 ? 's' : ''})
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setStep('configure')} className="flex-1 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors">
                  ← Back
                </button>
                <button
                  onClick={handleExecute}
                  disabled={placing}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-black transition-colors flex items-center justify-center gap-2"
                >
                  {placing
                    ? <><RefreshCw size={14} className="animate-spin" /> Placing orders...</>
                    : <><ShieldAlert size={14} /> Confirm Square Off</>}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TRADE OPTIONS PANEL — dedicated sub-tab for new orders
// ─────────────────────────────────────────────────────────────────────────────

const TradeOptionsPanel: React.FC<{
  backendUrl: string;
  symbol:     SymbolCode;
  expiry:     string;
  onDone:     () => void;
}> = ({ backendUrl, symbol, expiry, onDone }) => {
  const cfg = SYMBOL_CONFIG[symbol];
  const [optType,    setOptType]    = useState<'CE' | 'PE'>('CE');
  const [action,     setAction]     = useState<'BUY' | 'SELL'>('BUY');
  const [strike,     setStrike]     = useState('');
  const [lots,       setLots]       = useState(1);
  const [orderType,  setOrderType]  = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [placing,    setPlacing]    = useState(false);
  const [result,     setResult]     = useState<{ ok: boolean; msg: string } | null>(null);

  const qty = lots * cfg.lotSize;

  const handlePlace = async () => {
    if (!strike) { setResult({ ok: false, msg: 'Enter a strike price first.' }); return; }
    if (orderType === 'limit' && !limitPrice) { setResult({ ok: false, msg: 'Enter limit price.' }); return; }
    setPlacing(true);
    setResult(null);
    try {
      const r = await placeOrder(backendUrl, {
        stockCode:    cfg.breezeStockCode,
        exchangeCode: cfg.breezeExchangeCode,
        action,
        quantity:     String(qty),
        expiryDate:   expiry,
        right:        optType === 'CE' ? 'call' : 'put',
        strikePrice:  strike,
        orderType,
        price:        orderType === 'limit' ? limitPrice : '0',
      });
      setResult({ ok: r.ok, msg: r.ok ? `✓ Order placed! ID: ${r.orderId ?? 'N/A'}` : `✗ ${r.error ?? 'Failed'}` });
      if (r.ok) { onDone(); }
    } catch (e) {
      setResult({ ok: false, msg: `✗ ${e instanceof Error ? e.message : String(e)}` });
    }
    setPlacing(false);
  };

  return (
    <div className="p-4 space-y-4 max-w-[500px] mx-auto">
      <div className="bg-[#1a1d2e] rounded-2xl border border-gray-700/30 p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={14} className="text-blue-400" />
          <span className="text-white font-bold text-sm">Place Option Order</span>
          <span className="text-gray-600 text-[10px]">via ICICI Breeze API</span>
        </div>

        <div className="flex items-center gap-2 p-2.5 bg-blue-500/8 border border-blue-500/20 rounded-xl text-[11px]">
          <Info size={11} className="text-blue-400 flex-shrink-0" />
          <span className="text-blue-300">
            {cfg.displayName} · Expiry: <strong>{expiry || 'not set'}</strong> · Lot size: <strong className="text-amber-400">{cfg.lotSize}</strong>
          </span>
        </div>

        {/* CE / PE */}
        <div>
          <label className="text-gray-500 text-[10px] font-semibold mb-1.5 block">Option Type</label>
          <div className="flex rounded-xl overflow-hidden border border-gray-700/40">
            {(['CE', 'PE'] as const).map(t => (
              <button key={t} onClick={() => setOptType(t)}
                className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                  optType === t
                    ? t === 'CE' ? 'bg-blue-600 text-white' : 'bg-orange-600 text-white'
                    : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
                }`}>
                {t} — {t === 'CE' ? 'Call' : 'Put'}
              </button>
            ))}
          </div>
        </div>

        {/* BUY / SELL */}
        <div>
          <label className="text-gray-500 text-[10px] font-semibold mb-1.5 block">Action</label>
          <div className="flex rounded-xl overflow-hidden border border-gray-700/40">
            {(['BUY', 'SELL'] as const).map(a => (
              <button key={a} onClick={() => setAction(a)}
                className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                  action === a
                    ? a === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                    : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
                }`}>
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Strike */}
        <div>
          <label className="text-gray-500 text-[10px] font-semibold mb-1.5 block">
            Strike Price <span className="text-gray-700">(step: ₹{cfg.strikeStep})</span>
          </label>
          <input
            type="number"
            value={strike}
            onChange={e => setStrike(e.target.value)}
            placeholder={`e.g. ${symbol === 'NIFTY' ? '24500' : '80000'}`}
            step={cfg.strikeStep}
            className="w-full bg-[#0a0c15] border border-gray-700/40 focus:border-blue-500/60 text-white text-sm rounded-xl px-4 py-2.5 mono outline-none transition-colors"
          />
        </div>

        {/* Lots with live qty */}
        <div>
          <label className="text-gray-500 text-[10px] font-semibold mb-2 block">Lots</label>
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setLots(l => Math.max(1, l - 1))}
              className="w-10 h-10 bg-gray-700/60 hover:bg-gray-600 text-white rounded-xl flex items-center justify-center font-bold transition-colors">
              <Minus size={14} />
            </button>
            <input type="number" value={lots} min={1}
              onChange={e => setLots(Math.max(1, parseInt(e.target.value) || 1))}
              className="flex-1 text-center bg-[#0a0c15] border border-gray-700/40 text-white text-lg rounded-xl py-2 mono outline-none font-bold" />
            <button onClick={() => setLots(l => l + 1)}
              className="w-10 h-10 bg-gray-700/60 hover:bg-gray-600 text-white rounded-xl flex items-center justify-center font-bold transition-colors">
              <Plus size={14} />
            </button>
          </div>
          {/* Explicit lot × qty breakdown */}
          <div className="bg-[#0e1018] rounded-xl border border-gray-800/40 px-4 py-2.5 flex items-center justify-between">
            <span className="text-gray-600 text-[11px]">
              {lots} lot{lots !== 1 ? 's' : ''} × <span className="text-amber-400 font-bold">{cfg.lotSize}</span> =
            </span>
            <span className="text-white font-black text-xl mono">{qty} <span className="text-gray-600 text-[10px] font-normal">qty</span></span>
          </div>
        </div>

        {/* Order type */}
        <div>
          <label className="text-gray-500 text-[10px] font-semibold mb-1.5 block">Order Type</label>
          <div className="flex rounded-xl overflow-hidden border border-gray-700/40">
            <button onClick={() => setOrderType('market')}
              className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                orderType === 'market' ? 'bg-amber-600 text-white' : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
              }`}>
              MARKET
            </button>
            <button onClick={() => setOrderType('limit')}
              className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                orderType === 'limit' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-300 bg-[#1a1d2e]'
              }`}>
              LIMIT
            </button>
          </div>
          <p className="text-gray-700 text-[10px] mt-1">
            {orderType === 'market'
              ? 'Executes immediately at best available market price'
              : 'Executes at your specified price or better'}
          </p>
        </div>

        {orderType === 'limit' && (
          <div>
            <label className="text-gray-500 text-[10px] font-semibold mb-1.5 block">Limit Price (₹)</label>
            <input
              type="number"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              placeholder="e.g. 125.50"
              step="0.05"
              min="0.05"
              className="w-full bg-[#0a0c15] border border-blue-500/50 focus:border-blue-400 text-white text-sm rounded-xl px-4 py-2.5 mono outline-none transition-colors"
            />
          </div>
        )}

        {/* Preview */}
        {strike && (
          <div className={`p-3 rounded-xl border text-[11px] ${
            action === 'BUY' ? 'bg-emerald-500/6 border-emerald-500/20' : 'bg-red-500/6 border-red-500/20'
          }`}>
            <div className="text-gray-500 text-[9px] mb-1 uppercase tracking-wider">Order Preview</div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className={`font-black text-base ${action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{action}</span>
              <span className={`font-bold ${optType === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}>{optType}</span>
              <span className="text-white font-bold mono">{strike}</span>
              <span className="text-gray-500">·</span>
              <span className="text-amber-400 font-bold">{lots}L × {cfg.lotSize} = {qty} qty</span>
              <span className="text-gray-500">·</span>
              <span className={orderType === 'market' ? 'text-amber-400' : 'text-blue-400'}>
                {orderType === 'market' ? 'MARKET' : `LIMIT ₹${limitPrice}`}
              </span>
            </div>
          </div>
        )}

        {result && (
          <div className={`p-3 rounded-xl border text-[11px] font-mono ${
            result.ok ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300' : 'bg-red-500/8 border-red-500/25 text-red-300'
          }`}>
            {result.msg}
          </div>
        )}

        <button
          onClick={handlePlace}
          disabled={placing || !strike}
          className={`w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-black transition-colors flex items-center justify-center gap-2 ${
            action === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          {placing
            ? <><RefreshCw size={14} className="animate-spin" /> Placing order...</>
            : <><Crosshair size={14} /> {action} {lots}L {optType} {strike ? `@ ${strike}` : ''}</>}
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FUNDS DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

const FundsDashboard: React.FC<{
  funds:     FundsData | null;
  loading:   boolean;
  onRefresh: () => void;
  canFetch:  boolean;
}> = ({ funds, loading, onRefresh, canFetch }) => {
  if (!canFetch) return (
    <div className="text-center py-12 text-gray-700 px-4">
      <DollarSign size={32} className="mx-auto mb-2 opacity-15" />
      <p className="text-sm mb-1">Connect Kaggle backend to view funds</p>
      <p className="text-[10px] text-gray-800">Click "Connect Broker" → paste Kaggle URL → Validate Live</p>
    </div>
  );
  if (loading) return <div className="flex items-center justify-center h-40"><RefreshCw size={20} className="text-blue-400 animate-spin" /></div>;
  if (!funds) return (
    <div className="text-center py-12 text-gray-600 px-4">
      <DollarSign size={32} className="mx-auto mb-2 opacity-20" />
      <p className="text-sm">Funds data unavailable</p>
      <button onClick={onRefresh} className="mt-2 text-blue-400 text-xs underline">Retry</button>
    </div>
  );

  const items = [
    { label: 'Cash Balance',     key: 'cash_balance',    color: 'text-emerald-400', bg: 'border-emerald-500/20 bg-emerald-500/4' },
    { label: 'Net Amount',       key: 'net_amount',       color: 'text-blue-400',    bg: 'border-blue-500/20 bg-blue-500/4' },
    { label: 'Available Margin', key: 'available_margin', color: 'text-purple-400',  bg: 'border-purple-500/20 bg-purple-500/4' },
    { label: 'Utilized Margin',  key: 'utilized_margin',  color: 'text-amber-400',   bg: 'border-amber-500/20 bg-amber-500/4' },
  ];

  const availableMargin = asNumber((funds as Record<string, unknown>).available_margin);
  const utilizedMargin = asNumber((funds as Record<string, unknown>).utilized_margin);
  const totalMargin = Math.max(availableMargin + utilizedMargin, 0);
  const utilizationPct = totalMargin > 0 ? Math.min(100, (utilizedMargin / totalMargin) * 100) : 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-bold text-sm">Funds & Margin</h3>
        <button onClick={onRefresh} className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg">
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map(item => {
          const val = (funds as Record<string, unknown>)[item.key];
          const num = asNumber(val);
          return (
            <div key={item.key} className={`rounded-2xl border p-4 ${item.bg}`}>
              <div className="text-gray-600 text-[10px] mb-1">{item.label}</div>
              <div className={`font-black text-xl mono ${item.color}`}>
                ₹{num.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-gray-700/40 bg-[#0e1018] p-3">
        <div className="flex items-center justify-between text-[10px] mb-2">
          <span className="text-gray-500">Margin utilization</span>
          <span className="text-amber-300 mono font-bold">{utilizationPct.toFixed(1)}%</span>
        </div>
        <div className="h-2.5 bg-gray-800/80 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 transition-all duration-500"
            style={{ width: `${utilizationPct}%` }}
          />
        </div>
        <div className="mt-2 text-[10px] text-gray-600 flex justify-between">
          <span>Used: ₹{utilizedMargin.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          <span>Total: ₹{totalMargin.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ORDER BOOK TABLE
// ─────────────────────────────────────────────────────────────────────────────

const OrderBookTable: React.FC<{
  orders:    OrderBookRow[];
  loading:   boolean;
  canFetch:  boolean;
  onRefresh: () => void;
  onCancel:  (orderId: string, exchange: string) => Promise<void>;
}> = ({ orders, loading, canFetch, onRefresh, onCancel }) => {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OrderBookRow | null>(null);
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'timestamp' | 'quantity' | 'price' | 'status'>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  if (!canFetch) return (
    <div className="text-center py-12 text-gray-700 px-4">
      <BookOpen size={32} className="mx-auto mb-2 opacity-15" />
      <p className="text-sm mb-1">Connect Kaggle backend to view order book</p>
    </div>
  );
  if (loading) return <div className="flex items-center justify-center h-40"><RefreshCw size={20} className="text-blue-400 animate-spin" /></div>;

  const statusColor = (s: string) => {
    const l = s.toLowerCase();
    if (l.includes('complet')) return 'text-emerald-400';
    if (l.includes('cancel'))  return 'text-gray-500';
    if (l.includes('reject'))  return 'text-red-400';
    if (l.includes('open') || l.includes('pend')) return 'text-amber-400';
    return 'text-gray-400';
  };

  const filtered = orders.filter(row => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.order_id, row.stock_code, row.status, row.action, row.right, row.strike_price]
      .some(v => String(v ?? '').toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    const tsA = extractTimestamp(a as Record<string, unknown>);
    const tsB = extractTimestamp(b as Record<string, unknown>);
    let cmp = 0;
    if (sortBy === 'timestamp') cmp = tsA.localeCompare(tsB);
    if (sortBy === 'quantity') cmp = asNumber(a.quantity) - asNumber(b.quantity);
    if (sortBy === 'price') cmp = asNumber(a.price) - asNumber(b.price);
    if (sortBy === 'status') cmp = String(a.status ?? '').localeCompare(String(b.status ?? ''));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (field: 'timestamp' | 'quantity' | 'price' | 'status') => {
    if (sortBy === field) setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(field);
      setSortDir(field === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const handleCopy = async (orderId: string) => {
    try {
      await navigator.clipboard.writeText(orderId);
      setCopiedId(orderId);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {}
  };

  const executeCancel = async (row: OrderBookRow) => {
    setCancelling(String(row.order_id));
    await onCancel(String(row.order_id), String(row.exchange_code || 'NFO'));
    setCancelling(null);
    setCancelTarget(null);
    onRefresh();
  };

  if (orders.length === 0) return (
    <div className="text-center py-12 text-gray-700 px-4">
      <BookOpen size={32} className="mx-auto mb-2 opacity-15" />
      <p className="text-sm">No orders today</p>
      <button onClick={onRefresh} className="mt-2 text-blue-400 text-xs underline">Refresh</button>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-800/40">
        <span className="text-gray-600 text-[10px]">{sorted.length}/{orders.length} orders</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1.5 text-gray-600" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search orders" className="pl-6 pr-2 py-1 bg-[#0e1018] border border-gray-700/40 rounded-lg text-[10px] text-white outline-none" />
          </div>
          <button onClick={onRefresh} className="p-1 text-gray-600 hover:text-gray-300 rounded-lg"><RefreshCw size={11} /></button>
        </div>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-[10px]">
          <thead className="bg-[#0e1018] sticky top-0">
            <tr className="border-b border-gray-800/50 text-gray-600 text-[9px]">
              <th className="px-3 py-2 text-left font-semibold">Order ID</th>
              <th className="px-3 py-2 text-left font-semibold">Instrument</th>
              <th className="px-3 py-2 text-left font-semibold cursor-pointer" onClick={() => toggleSort('timestamp')}>Time</th>
              <th className="px-3 py-2 text-center font-semibold">B/S</th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer" onClick={() => toggleSort('quantity')}>Qty</th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer" onClick={() => toggleSort('price')}>Price</th>
              <th className="px-3 py-2 text-center font-semibold">Type</th>
              <th className="px-3 py-2 text-center font-semibold cursor-pointer" onClick={() => toggleSort('status')}>Status</th>
              <th className="px-3 py-2 text-center font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const isBuy     = String(row.action || '').toLowerCase() === 'buy';
              const statusStr = String(row.status || '').toLowerCase();
              const isPending = statusStr.includes('open') || statusStr.includes('pend');
              const rowId = String(row.order_id || '');
              return (
                <tr key={rowId + i} className="border-b border-gray-800/20 hover:bg-gray-800/10 transition-colors">
                  <td className="px-3 py-2 mono text-gray-500 text-[9px]">
                    <button onClick={() => handleCopy(rowId)} className="inline-flex items-center gap-1 hover:text-white">{rowId.slice(0, 12)}...{copiedId === rowId ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}</button>
                  </td>
                  <td className="px-3 py-2 mono">
                    <span className="text-white font-semibold">{String(row.stock_code || '')}</span>
                    {row.strike_price && <span className="text-gray-600 ml-1">{String(row.strike_price)} {String(row.right || '').toUpperCase()}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{extractTimestamp(row as Record<string, unknown>)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-md ${isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                      {String(row.action || '').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right mono">{String(row.quantity || '')}</td>
                  <td className="px-3 py-2 text-right mono">₹{String(row.price || '')}</td>
                  <td className="px-3 py-2 text-center text-gray-500">{String(row.order_type || '').toUpperCase()}</td>
                  <td className={`px-3 py-2 text-center font-semibold ${statusColor(String(row.status || ''))}`}>
                    {String(row.status || '')}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {isPending && (
                      <button
                        onClick={() => setCancelTarget(row)}
                        disabled={cancelling === String(row.order_id)}
                        className="px-2 py-0.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-lg text-[9px] font-semibold disabled:opacity-40"
                      >
                        {cancelling === String(row.order_id) ? '...' : 'Cancel'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cancelTarget && (
        <div className="m-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[11px]">
          <p className="text-red-200">Cancel order <span className="mono">{String(cancelTarget.order_id).slice(0, 16)}...</span>?</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setCancelTarget(null)} className="px-2 py-1 bg-gray-700/50 rounded-lg text-gray-300">Keep</button>
            <button onClick={() => executeCancel(cancelTarget)} className="px-2 py-1 bg-red-600 rounded-lg text-white">Confirm cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TRADE BOOK TABLE
// ─────────────────────────────────────────────────────────────────────────────

const TradeBookTable: React.FC<{
  trades:    TradeBookRow[];
  loading:   boolean;
  canFetch:  boolean;
  onRefresh: () => void;
}> = ({ trades, loading, canFetch, onRefresh }) => {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'timestamp' | 'quantity' | 'price'>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  if (!canFetch) return (
    <div className="text-center py-12 text-gray-700 px-4">
      <List size={32} className="mx-auto mb-2 opacity-15" />
      <p className="text-sm mb-1">Connect Kaggle backend to view trade book</p>
    </div>
  );
  if (loading) return <div className="flex items-center justify-center h-40"><RefreshCw size={20} className="text-blue-400 animate-spin" /></div>;
  if (trades.length === 0) return (
    <div className="text-center py-12 text-gray-700 px-4">
      <List size={32} className="mx-auto mb-2 opacity-15" />
      <p className="text-sm">No executed trades today</p>
      <button onClick={onRefresh} className="mt-2 text-blue-400 text-xs underline">Refresh</button>
    </div>
  );

  const filtered = trades.filter(row => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.order_id, row.stock_code, row.action, row.right, row.strike_price]
      .some(v => String(v ?? '').toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    const tsA = extractTimestamp(a as Record<string, unknown>);
    const tsB = extractTimestamp(b as Record<string, unknown>);
    let cmp = 0;
    if (sortBy === 'timestamp') cmp = tsA.localeCompare(tsB);
    if (sortBy === 'quantity') cmp = asNumber(a.quantity) - asNumber(b.quantity);
    if (sortBy === 'price') cmp = asNumber(a.trade_price ?? a.price) - asNumber(b.trade_price ?? b.price);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (field: 'timestamp' | 'quantity' | 'price') => {
    if (sortBy === field) setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(field);
      setSortDir(field === 'timestamp' ? 'desc' : 'asc');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-800/40">
        <span className="text-gray-600 text-[10px]">{sorted.length}/{trades.length} trades</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1.5 text-gray-600" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search trades" className="pl-6 pr-2 py-1 bg-[#0e1018] border border-gray-700/40 rounded-lg text-[10px] text-white outline-none" />
          </div>
          <button onClick={onRefresh} className="p-1 text-gray-600 hover:text-gray-300 rounded-lg"><RefreshCw size={11} /></button>
        </div>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-[10px]">
          <thead className="bg-[#0e1018] sticky top-0">
            <tr className="border-b border-gray-800/50 text-gray-600 text-[9px]">
              <th className="px-3 py-2 text-left font-semibold">Instrument</th>
              <th className="px-3 py-2 text-left font-semibold cursor-pointer" onClick={() => toggleSort('timestamp')}>Time</th>
              <th className="px-3 py-2 text-center font-semibold">B/S</th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer" onClick={() => toggleSort('quantity')}>Qty</th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer" onClick={() => toggleSort('price')}>Trade Price</th>
              <th className="px-3 py-2 text-right font-semibold">Expiry</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const isBuy = String(row.action || '').toLowerCase() === 'buy';
              return (
                <tr key={String(row.order_id) + i} className="border-b border-gray-800/20 hover:bg-gray-800/10">
                  <td className="px-3 py-2 mono">
                    <span className="text-white font-semibold">{String(row.stock_code || '')}</span>
                    {row.strike_price && <span className="text-gray-600 ml-1">{String(row.strike_price)} {String(row.right || '').toUpperCase()}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{extractTimestamp(row as Record<string, unknown>)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-md ${isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                      {String(row.action || '').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right mono">{String(row.quantity || '')}</td>
                  <td className="px-3 py-2 text-right mono text-amber-300">₹{String(row.trade_price || row.price || '')}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{String(row.expiry_date || '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// POSITION CARD
// ─────────────────────────────────────────────────────────────────────────────

const PositionCard: React.FC<{
  pos:          Position;
  onLoad:       () => void;
  onSquareOff?: (pos: Position) => void;
  canFetch:     boolean;
}> = ({ pos, onLoad, onSquareOff, canFetch }) => {
  const [exp, setExp] = useState(false);
  const cfg = SYMBOL_CONFIG[pos.symbol as SymbolCode] ?? SYMBOL_CONFIG['NIFTY'];
  const ip  = pos.mtmPnl >= 0;

  return (
    <div className={`rounded-2xl border transition-all ${
      pos.status === 'ACTIVE' ? 'bg-[#1a1d2e] border-gray-700/40 hover:border-gray-600/50' :
      pos.status === 'DRAFT'  ? 'bg-amber-950/6 border-amber-800/20' :
      'bg-[#14161f] border-gray-800/25 opacity-55'
    }`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${ip ? 'bg-emerald-500/8' : 'bg-red-500/8'}`}>
          {ip ? <TrendingUp size={16} className="text-emerald-400" /> : <TrendingDown size={16} className="text-red-400" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-xs">{cfg.displayName}</span>
            <span className="text-[9px] text-blue-400 bg-blue-500/8 px-1.5 py-0.5 rounded-lg border border-blue-500/15">{pos.expiry}</span>
            <span className="text-gray-600 text-[10px]">{pos.strategy}</span>
            <span className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-lg border ${
              pos.status === 'ACTIVE' ? 'text-emerald-400 bg-emerald-500/8 border-emerald-500/20' :
              pos.status === 'DRAFT'  ? 'text-amber-400 bg-amber-500/8 border-amber-500/20' :
              'text-gray-500 bg-gray-700/20 border-gray-700/20'
            }`}>
              <CheckCircle size={9} />{pos.status.charAt(0) + pos.status.slice(1).toLowerCase()}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[9px] text-gray-700">
            <span className="flex items-center gap-1"><Clock size={8} />{pos.entryDate}</span>
            <span>{pos.legs.length} leg{pos.legs.length > 1 ? 's' : ''}</span>
            <span className="text-amber-500 font-semibold">Lot {cfg.lotSize}</span>
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <div className={`text-base font-bold mono ${ip ? 'text-emerald-400' : 'text-red-400'}`}>
            {ip ? '+' : ''}₹{pos.mtmPnl.toLocaleString('en-IN')}
          </div>
          <div className="text-[9px] text-gray-700">MTM P&L</div>
        </div>

        <div className="text-right flex-shrink-0 ml-3 border-l border-gray-800/40 pl-3">
          <div className="text-[9px] text-emerald-400 mono">{pos.maxProfit === Infinity ? '∞' : fmtPnL(pos.maxProfit)}</div>
          <div className="text-[9px] text-red-400 mono">{pos.maxLoss === -Infinity ? '-∞' : fmtPnL(pos.maxLoss)}</div>
          <div className="text-[8px] text-gray-700">Max P / L</div>
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          <button onClick={onLoad}
            className="flex items-center gap-1 px-2 py-1 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/15 rounded-lg text-[9px] font-semibold transition-colors">
            <Zap size={9} />Load
          </button>

          {pos.status === 'ACTIVE' && (
            <button
              onClick={() => {
                if (!canFetch) return;
                onSquareOff?.(pos);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all border ${
                canFetch
                  ? 'bg-red-600/15 hover:bg-red-600/30 text-red-400 border-red-500/25 hover:border-red-500/50 hover:scale-105'
                  : 'bg-gray-700/20 text-gray-600 border-gray-700/20 cursor-not-allowed'
              }`}
              title={canFetch ? 'Square Off — place exit orders (partial or full)' : 'Connect Kaggle backend first'}
            >
              <ShieldAlert size={9} />
              Sq Off
            </button>
          )}

          <button onClick={() => setExp(!exp)} className="p-1 text-gray-700 hover:text-gray-300 transition-colors">
            {exp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded leg table */}
      {exp && (
        <div className="border-t border-gray-800/30 px-4 py-3">
          <div className="text-[9px] text-gray-700 mb-2 uppercase tracking-wider font-semibold">
            Leg Breakdown · 1 lot = {cfg.lotSize} qty
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-gray-700 border-b border-gray-800/40">
                <th className="pb-1.5 text-left font-semibold">Instrument</th>
                <th className="pb-1.5 text-center font-semibold">B/S</th>
                <th className="pb-1.5 text-right font-semibold">Lots</th>
                <th className="pb-1.5 text-right font-semibold bg-amber-500/5 px-2 rounded">Qty</th>
                <th className="pb-1.5 text-right font-semibold">Entry ₹</th>
                <th className="pb-1.5 text-right font-semibold">LTP ₹</th>
                <th className="pb-1.5 text-right font-semibold">P&L</th>
              </tr>
            </thead>
            <tbody>
              {pos.legs.map((leg, i) => (
                <tr key={i} className="border-b border-gray-800/15 last:border-0">
                  <td className="py-1.5 mono">
                    <span className={`font-bold ${leg.type === 'CE' ? 'text-blue-300' : 'text-orange-300'}`}>
                      {cfg.displayName} {leg.strike.toLocaleString('en-IN')} {leg.type}
                    </span>
                  </td>
                  <td className="py-1.5 text-center">
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded-md ${
                      leg.action === 'BUY' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                    }`}>{leg.action}</span>
                  </td>
                  <td className="py-1.5 text-right text-amber-400 font-bold mono">{leg.lots}</td>
                  <td className="py-1.5 text-right font-black mono bg-amber-500/5 px-2 rounded">
                    {leg.lots * cfg.lotSize}
                    <span className="text-gray-700 text-[8px] font-normal ml-1">{leg.lots}×{cfg.lotSize}</span>
                  </td>
                  <td className="py-1.5 text-right text-gray-600 mono">₹{leg.entryPrice.toFixed(2)}</td>
                  <td className="py-1.5 text-right text-white font-semibold mono">₹{leg.currentPrice.toFixed(2)}</td>
                  <td className={`py-1.5 text-right font-bold mono ${leg.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {leg.pnl >= 0 ? '+' : ''}₹{leg.pnl.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN POSITIONS PANEL
// ─────────────────────────────────────────────────────────────────────────────

export const Positions: React.FC<Props> = ({
  onLoadToBuilder, livePositions, isLive: isLiveRaw, session, onRefreshPositions,
}) => {
  const liveFlag   = !!isLiveRaw;
  const backendUrl = session?.proxyBase ?? '';
  const canFetch   = liveFlag && isKaggleBackend(backendUrl);

  const [filter,   setFilter]   = useState<Filter>('ALL');
  const [subTab,   setSubTab]   = useState<SubTab>('positions');
  const [funds,    setFunds]    = useState<FundsData | null>(null);
  const [orders,   setOrders]   = useState<OrderBookRow[]>([]);
  const [trades,   setTrades]   = useState<TradeBookRow[]>([]);
  const [fundsLoading,  setFundsLoading]  = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [toast,    setToast]    = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshTick, setRefreshTick] = useState(20);
  const [sqOffPos, setSqOffPos] = useState<Position | null>(null);

  const positions = resolvePositions(liveFlag, livePositions);
  const filtered  = positions.filter(p => filter === 'ALL' || p.status === filter);
  const totalMtm  = positions.filter(p => p.status === 'ACTIVE').reduce((s, p) => s + p.mtmPnl, 0);
  const active    = positions.filter(p => p.status === 'ACTIVE').length;

  const symbolChoices = Array.from(new Set(positions.map(p => p.symbol as SymbolCode)));
  const expiryChoices = Array.from(new Set(positions.map(p => p.expiry))).filter(Boolean);
  const [tradeSym, setTradeSym] = useState<SymbolCode>((symbolChoices[0] ?? 'NIFTY') as SymbolCode);
  const [tradeExpiry, setTradeExpiry] = useState<string>(expiryChoices[0] ?? '');

  useEffect(() => {
    if (!symbolChoices.includes(tradeSym)) setTradeSym((symbolChoices[0] ?? 'NIFTY') as SymbolCode);
  }, [symbolChoices, tradeSym]);

  useEffect(() => {
    if (!expiryChoices.includes(tradeExpiry)) setTradeExpiry(expiryChoices[0] ?? '');
  }, [expiryChoices, tradeExpiry]);

  const loadFunds  = useCallback(async () => {
    if (!canFetch) return;
    setFundsLoading(true); setError(null);
    try {
      const r = await fetchFunds(backendUrl);
      if (r.ok) setFunds(r.data ?? null); else setError(r.error ?? 'Failed to fetch funds');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setFundsLoading(false); }
  }, [canFetch, backendUrl]);

  const loadOrders = useCallback(async () => {
    if (!canFetch) return;
    setOrdersLoading(true); setError(null);
    try {
      const r = await fetchOrderBook(backendUrl);
      if (r.ok) setOrders(r.data); else setError(r.error ?? 'Failed');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setOrdersLoading(false); }
  }, [canFetch, backendUrl]);

  const loadTrades = useCallback(async () => {
    if (!canFetch) return;
    setTradesLoading(true); setError(null);
    try {
      const r = await fetchTradeBook(backendUrl);
      if (r.ok) setTrades(r.data); else setError(r.error ?? 'Failed');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setTradesLoading(false); }
  }, [canFetch, backendUrl]);

  useEffect(() => {
    if (subTab === 'funds')  loadFunds();
    if (subTab === 'orders') loadOrders();
    if (subTab === 'trades') loadTrades();
  }, [subTab, loadFunds, loadOrders, loadTrades]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!canFetch || !autoRefresh || !['orders', 'trades', 'funds'].includes(subTab)) return;
    const timer = window.setInterval(() => {
      setRefreshTick(prev => {
        if (prev <= 1) {
          if (subTab === 'orders') loadOrders();
          if (subTab === 'trades') loadTrades();
          if (subTab === 'funds') loadFunds();
          return 20;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [canFetch, autoRefresh, subTab, loadOrders, loadTrades, loadFunds]);

  useEffect(() => {
    setRefreshTick(20);
  }, [subTab, autoRefresh]);

  const handleCancel = useCallback(async (orderId: string, exchange: string) => {
    if (!canFetch) { setError('Connect Kaggle backend to cancel orders.'); return; }
    const r = await cancelOrder(backendUrl, orderId, exchange);
    if (!r.ok) setError(`Cancel failed: ${r.error ?? 'Unknown error'}`);
    else setToast(`Order ${orderId.slice(0, 10)}... cancelled`);
  }, [canFetch, backendUrl]);

  const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'positions', label: 'Positions',     icon: <BarChart3 size={10} />, badge: filtered.length },
    { id: 'trade',     label: 'Trade Options', icon: <Activity size={10} /> },
    { id: 'sell',      label: 'Sell Orders',   icon: <TrendingDown size={10} />, badge: orders.filter(o => String(o.action || '').toLowerCase() === 'sell').length },
    { id: 'orders',    label: 'Order Book',    icon: <BookOpen size={10} />, badge: orders.length },
    { id: 'trades',    label: 'Trade Book',    icon: <List size={10} />, badge: trades.length },
    { id: 'funds',     label: 'Funds',         icon: <DollarSign size={10} /> },
  ];

  return (
    <div className="flex-1 overflow-auto bg-[#13161f]">

      {/* Summary cards */}
      <div className="p-4 pb-2">
        <div className="grid grid-cols-4 gap-3 mb-3">
          {[
            { label: 'Total MTM P&L', value: `${totalMtm >= 0 ? '+' : ''}₹${totalMtm.toLocaleString('en-IN')}`, color: totalMtm >= 0 ? 'text-emerald-400' : 'text-red-400', bg: totalMtm >= 0 ? 'border-emerald-500/20 bg-emerald-500/4' : 'border-red-500/20 bg-red-500/4' },
            { label: 'Active',        value: String(active),           color: 'text-blue-400',   bg: 'border-blue-500/20 bg-blue-500/4' },
            { label: 'Total Legs',    value: String(positions.reduce((s, p) => s + p.legs.length, 0)), color: 'text-purple-400', bg: 'border-purple-500/20 bg-purple-500/4' },
            { label: 'Strategies',    value: String(positions.length), color: 'text-amber-400',  bg: 'border-amber-500/20 bg-amber-500/4' },
          ].map(c => (
            <div key={c.label} className={`rounded-2xl border p-3.5 ${c.bg}`}>
              <div className="text-gray-600 text-[10px] mb-1">{c.label}</div>
              <div className={`text-2xl font-black mono ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Sub-tab nav */}
        <div className="flex items-center gap-1 mb-3 border-b border-gray-800/40 pb-2 flex-wrap">
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg font-medium transition-colors ${
                subTab === t.id
                  ? t.id === 'trade' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-white hover:bg-gray-700/40'
              }`}>
              {t.icon}{t.label}
              {typeof t.badge === 'number' && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-800/80 text-[9px] text-gray-300">{t.badge}</span>
              )}
              {t.id === 'trade' && !canFetch && (
                <span className="text-[8px] text-gray-600 ml-0.5">·needs backend</span>
              )}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2 text-[9px]">
            {['orders', 'trades', 'funds'].includes(subTab) && canFetch && (
              <button onClick={() => setAutoRefresh(v => !v)} className="px-2 py-1 rounded-lg border border-gray-700/40 text-gray-400 hover:text-white">
                {autoRefresh ? `Auto ${refreshTick}s` : 'Auto off'}
              </button>
            )}
            {canFetch
              ? <span className="text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full pulse-dot" />LIVE · Breeze API
                </span>
              : liveFlag
                ? <span className="text-amber-500/70">Connected · awaiting live validation</span>
                : <span className="text-gray-700">Demo · connect Kaggle for live data</span>}
          </div>
        </div>

        {toast && (
          <div className="flex items-center gap-2 p-2.5 mb-3 bg-emerald-500/8 border border-emerald-500/20 rounded-xl text-[11px] text-emerald-300">
            <CheckCircle size={12} className="flex-shrink-0" />
            <span>{toast}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-2.5 mb-3 bg-red-500/8 border border-red-500/20 rounded-xl text-[11px] text-red-300">
            <AlertTriangle size={12} className="flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-gray-600 hover:text-gray-300"><X size={11} /></button>
          </div>
        )}
      </div>

      {/* ── Positions tab ── */}
      {subTab === 'positions' && (
        <div className="px-4 space-y-2">
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {(['ALL', 'ACTIVE', 'DRAFT', 'CLOSED'] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[11px] rounded-lg font-semibold transition-colors ${
                  filter === f ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-white hover:bg-gray-700/40'
                }`}>
                {f}
                {f !== 'ALL' && (
                  <span className="ml-1 opacity-50">({positions.filter(p => p.status === f).length})</span>
                )}
              </button>
            ))}
            {canFetch && onRefreshPositions && (
              <button onClick={onRefreshPositions}
                className="ml-auto flex items-center gap-1 px-2 py-1 text-gray-600 hover:text-gray-300 hover:bg-gray-700/40 rounded-lg text-[10px] transition-colors">
                <RefreshCw size={10} /> Refresh
              </button>
            )}
          </div>

          {liveFlag && Array.isArray(livePositions) && livePositions.length === 0 ? (
            <div className="text-center py-16 text-gray-700">
              <CheckCircle size={36} className="mx-auto mb-3 opacity-15 text-emerald-500" />
              <p className="text-sm text-gray-600">No open positions</p>
              <p className="text-[11px] mt-1">Your ICICI account has no FNO positions today.</p>
            </div>
          ) : filtered.length > 0 ? (
            filtered.map(pos => (
              <PositionCard
                key={pos.id}
                pos={pos}
                onLoad={() => onLoadToBuilder(pos)}
                onSquareOff={pos => setSqOffPos(pos)}
                canFetch={canFetch}
              />
            ))
          ) : (
            <div className="text-center py-16 text-gray-700">
              <FileText size={36} className="mx-auto mb-3 opacity-15" />
              <p className="text-sm">No {filter.toLowerCase()} positions</p>
            </div>
          )}

          {!liveFlag && (
            <div className="text-center py-3">
              <p className="text-[10px] text-gray-800">
                Showing demo data · Connect Kaggle backend for live positions
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Trade Options tab ── */}
      {subTab === 'trade' && (
        canFetch ? (
          <div className="space-y-3">
            <div className="mx-4 rounded-2xl border border-gray-700/30 bg-[#1a1d2e] p-3 flex items-center gap-3">
              <label className="text-[10px] text-gray-500">Symbol</label>
              <select value={tradeSym} onChange={e => setTradeSym(e.target.value as SymbolCode)} className="bg-[#0e1018] border border-gray-700/50 rounded-lg px-2 py-1 text-[11px] text-white">
                {(symbolChoices.length ? symbolChoices : ['NIFTY']).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <label className="text-[10px] text-gray-500">Expiry</label>
              <select value={tradeExpiry} onChange={e => setTradeExpiry(e.target.value)} className="bg-[#0e1018] border border-gray-700/50 rounded-lg px-2 py-1 text-[11px] text-white">
                {(expiryChoices.length ? expiryChoices : ['']).map(ex => <option key={ex || 'none'} value={ex}>{ex || 'Select expiry'}</option>)}
              </select>
            </div>
            <TradeOptionsPanel
              backendUrl={backendUrl}
              symbol={tradeSym}
              expiry={tradeExpiry}
              onDone={() => { if (onRefreshPositions) onRefreshPositions(); }}
            />
          </div>
        ) : (
          <div className="text-center py-16 text-gray-700 px-4">
            <Activity size={36} className="mx-auto mb-3 opacity-15" />
            <p className="text-sm text-gray-600 mb-1">Connect Kaggle backend to place orders</p>
            <p className="text-[11px]">Click "Connect Broker" → paste Kaggle URL → Validate Live</p>
          </div>
        )
      )}

      {/* ── Sell Orders tab ── */}
      {subTab === 'sell' && (
        <div className="bg-[#1a1d2e] mx-4 rounded-2xl border border-gray-700/30 overflow-hidden">
          <OrderBookTable
            orders={orders.filter(o => String(o.action || '').toLowerCase() === 'sell')}
            loading={ordersLoading}
            canFetch={canFetch}
            onRefresh={loadOrders}
            onCancel={handleCancel}
          />
        </div>
      )}

      {/* ── Orders tab ── */}
      {subTab === 'orders' && (
        <div className="bg-[#1a1d2e] mx-4 rounded-2xl border border-gray-700/30 overflow-hidden">
          <OrderBookTable orders={orders} loading={ordersLoading} canFetch={canFetch} onRefresh={loadOrders} onCancel={handleCancel} />
        </div>
      )}

      {/* ── Trades tab ── */}
      {subTab === 'trades' && (
        <div className="bg-[#1a1d2e] mx-4 rounded-2xl border border-gray-700/30 overflow-hidden">
          <TradeBookTable trades={trades} loading={tradesLoading} canFetch={canFetch} onRefresh={loadTrades} />
        </div>
      )}

      {/* ── Funds tab ── */}
      {subTab === 'funds' && (
        <div className="bg-[#1a1d2e] mx-4 rounded-2xl border border-gray-700/30 overflow-hidden">
          <FundsDashboard funds={funds} loading={fundsLoading} canFetch={canFetch} onRefresh={loadFunds} />
        </div>
      )}

      <div className="h-6" />

      {/* ── Square Off Modal ── */}
      {sqOffPos && (
        <SquareOffModal
          pos={sqOffPos}
          backendUrl={backendUrl}
          onClose={() => setSqOffPos(null)}
          onDone={() => {
            setSqOffPos(null);
            if (onRefreshPositions) onRefreshPositions();
          }}
        />
      )}
    </div>
  );
};
