// ================================================================
// STRATEGY BUILDER — Legs panel + Payoff chart + Greeks dashboard
// ================================================================

import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { Trash2, Plus, Zap, Target, BarChart2, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { OptionLeg, OptionRow, SymbolCode } from '../types/index';

let _sbLid = 0;
const nextId = () => `leg-sb-${++_sbLid}-${Date.now()}`;
import { SYMBOL_CONFIG }          from '../config/market';
import { buildPayoff, combinedGreeks, findBreakevens, maxProfitLoss, fmtPnL, fmtNum } from '../utils/math';

interface Props {
  legs:        OptionLeg[];
  onUpdateLeg: (id: string, u: Partial<OptionLeg>) => void;
  onRemoveLeg: (id: string) => void;
  onExecute:   (legs: OptionLeg[]) => void;
  spotPrice:   number;
  symbol:      SymbolCode;
  chain?:      OptionRow[];  // live chain for real-time LTP/Greeks updates
}

// ── Strategy template builder ─────────────────────────────────────────────────
// Each template returns legs relative to current ATM (spotPrice) and lotSize.
// Strikes are snapped to the nearest strikeStep.

interface TemplateDef {
  name:  string;
  icon:  string;
  desc:  string;
  build: (spot: number, step: number) => Array<Omit<OptionLeg, 'id' | 'symbol' | 'expiry' | 'iv' | 'gamma' | 'vega'>>;
}

function snapStrike(price: number, step: number): number {
  return Math.round(price / step) * step;
}

const TEMPLATES: TemplateDef[] = [
  {
    name: 'Bull Call Spread',
    icon: '📈',
    desc: 'Buy ATM CE + Sell OTM CE. Capped profit, limited risk.',
    build: (spot, step) => [
      { type:'CE', strike: snapStrike(spot, step),         action:'BUY',  lots:1, ltp:0, delta:0.5,  theta:-2.5 },
      { type:'CE', strike: snapStrike(spot + step * 4, step), action:'SELL', lots:1, ltp:0, delta:0.25, theta:-1.5 },
    ],
  },
  {
    name: 'Bear Put Spread',
    icon: '📉',
    desc: 'Buy ATM PE + Sell OTM PE. Profits when market falls.',
    build: (spot, step) => [
      { type:'PE', strike: snapStrike(spot, step),         action:'BUY',  lots:1, ltp:0, delta:-0.5,  theta:-2.5 },
      { type:'PE', strike: snapStrike(spot - step * 4, step), action:'SELL', lots:1, ltp:0, delta:-0.25, theta:-1.5 },
    ],
  },
  {
    name: 'Iron Condor',
    icon: '🦅',
    desc: 'Sell strangle + buy wings. Profits in range-bound markets.',
    build: (spot, step) => [
      { type:'CE', strike: snapStrike(spot + step * 3, step),  action:'SELL', lots:1, ltp:0, delta:0.3,  theta:-2.0 },
      { type:'CE', strike: snapStrike(spot + step * 7, step),  action:'BUY',  lots:1, ltp:0, delta:0.1,  theta:-0.8 },
      { type:'PE', strike: snapStrike(spot - step * 3, step),  action:'SELL', lots:1, ltp:0, delta:-0.3, theta:-2.0 },
      { type:'PE', strike: snapStrike(spot - step * 7, step),  action:'BUY',  lots:1, ltp:0, delta:-0.1, theta:-0.8 },
    ],
  },
  {
    name: 'Straddle',
    icon: '⚖️',
    desc: 'Buy ATM CE + ATM PE. Profits from large moves either way.',
    build: (spot, step) => [
      { type:'CE', strike: snapStrike(spot, step), action:'BUY', lots:1, ltp:0, delta:0.5,  theta:-3.0 },
      { type:'PE', strike: snapStrike(spot, step), action:'BUY', lots:1, ltp:0, delta:-0.5, theta:-3.0 },
    ],
  },
  {
    name: 'Short Straddle',
    icon: '🎯',
    desc: 'Sell ATM CE + ATM PE. Max profit when market stays flat.',
    build: (spot, step) => [
      { type:'CE', strike: snapStrike(spot, step), action:'SELL', lots:1, ltp:0, delta:0.5,  theta:3.0 },
      { type:'PE', strike: snapStrike(spot, step), action:'SELL', lots:1, ltp:0, delta:-0.5, theta:3.0 },
    ],
  },
  {
    name: 'Strangle',
    icon: '🌐',
    desc: 'Buy OTM CE + OTM PE. Cheaper than straddle, needs bigger move.',
    build: (spot, step) => [
      { type:'CE', strike: snapStrike(spot + step * 3, step), action:'BUY', lots:1, ltp:0, delta:0.3,  theta:-2.0 },
      { type:'PE', strike: snapStrike(spot - step * 3, step), action:'BUY', lots:1, ltp:0, delta:-0.3, theta:-2.0 },
    ],
  },
  {
    name: 'Bull Put Spread',
    icon: '🐂',
    desc: 'Sell OTM PE + Buy further OTM PE. Collect premium in bullish market.',
    build: (spot, step) => [
      { type:'PE', strike: snapStrike(spot - step * 2, step), action:'SELL', lots:1, ltp:0, delta:-0.35, theta:2.0 },
      { type:'PE', strike: snapStrike(spot - step * 6, step), action:'BUY',  lots:1, ltp:0, delta:-0.15, theta:-0.8 },
    ],
  },
  {
    name: 'Butterfly',
    icon: '🦋',
    desc: 'Buy 1 ATM + Sell 2 OTM + Buy 1 far OTM. Profits near ATM at expiry.',
    build: (spot, step) => [
      { type:'CE', strike: snapStrike(spot, step),             action:'BUY',  lots:1, ltp:0, delta:0.5,  theta:-3.0 },
      { type:'CE', strike: snapStrike(spot + step * 3, step),  action:'SELL', lots:2, ltp:0, delta:0.3,  theta:2.0  },
      { type:'CE', strike: snapStrike(spot + step * 6, step),  action:'BUY',  lots:1, ltp:0, delta:0.1,  theta:-0.8 },
    ],
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartTip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const pnl = payload.find((p: { dataKey: string }) => p.dataKey === 'pnl')?.value ?? 0;
  return (
    <div className="bg-[#1a1d2e] border border-gray-700/40 rounded-xl p-2.5 shadow-2xl text-xs">
      <div className="text-gray-500 mb-1">Price: <span className="text-white font-bold mono">₹{Number(label).toLocaleString('en-IN')}</span></div>
      <div className={`font-bold mono text-sm ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPnL(pnl)}</div>
    </div>
  );
};

const GCard: React.FC<{ label: string; value: number; color: string; desc: string }> = ({ label, value, color, desc }) => (
  <div className="bg-[#1e2135] rounded-xl p-3 border border-gray-700/30 flex-1 min-w-0">
    <div className="text-[9px] font-bold text-gray-600 mb-1 uppercase tracking-wider">{label}</div>
    <div className={`font-bold text-sm mono ${color}`}>{value >= 0 ? '+' : ''}{fmtNum(value, 4)}</div>
    <div className="text-[9px] text-gray-700 mt-0.5">{desc}</div>
  </div>
);

export const StrategyBuilder: React.FC<Props> = ({
  legs, onUpdateLeg, onRemoveLeg, onExecute, spotPrice, symbol, chain,
}) => {
  // Live LTP sync: whenever chain ticks update, push current LTP into each leg
  // This keeps the payoff curve and Greeks accurate during a live session
  React.useEffect(() => {
    if (!chain || chain.length === 0) return;
    const chainMap = new Map(chain.map(r => [r.strike, r]));
    legs.forEach(leg => {
      const row = chainMap.get(leg.strike);
      if (!row) return;
      const liveLtp   = leg.type === 'CE' ? row.ce_ltp   : row.pe_ltp;
      const liveDelta = leg.type === 'CE' ? row.ce_delta : row.pe_delta;
      const liveTheta = leg.type === 'CE' ? row.ce_theta : row.pe_theta;
      const liveIv    = leg.type === 'CE' ? row.ce_iv    : row.pe_iv;
      const liveGamma = leg.type === 'CE' ? row.ce_gamma : row.pe_gamma;
      const liveVega  = leg.type === 'CE' ? row.ce_vega  : row.pe_vega;
      if (Math.abs(liveLtp - leg.ltp) > 0.01) {
        onUpdateLeg(leg.id, {
          ltp: liveLtp, delta: liveDelta, theta: liveTheta,
          iv: liveIv, gamma: liveGamma, vega: liveVega,
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain]);  // only re-run when chain data changes
  const [showTemplates, setShowTemplates] = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [view,          setView]          = useState<'payoff'|'greeks'>('payoff');

  const cfg     = SYMBOL_CONFIG[symbol];
  const lotSize = cfg.lotSize;

  const payoff = useMemo(() => buildPayoff(legs, spotPrice), [legs, spotPrice]);
  const greeks = useMemo(() => combinedGreeks(legs), [legs]);
  const bes    = useMemo(() => findBreakevens(payoff), [payoff]);
  const { maxProfit, maxLoss } = useMemo(() => maxProfitLoss(payoff), [payoff]);

  const netPremium = legs.reduce((acc, l) => acc + l.ltp * (l.action==='BUY'?-1:1) * l.lots * lotSize, 0);
  const fmtMax = (v: number) => !isFinite(v) ? (v > 0 ? '∞ Unlimited' : '-∞ Unlimited') : fmtPnL(v);

  return (
    <div className="flex h-full bg-[#13161f] overflow-hidden">

      {/* ── LEFT: Legs ────────────────────────────────────── */}
      <div className="w-[400px] flex-shrink-0 flex flex-col border-r border-gray-800/60 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800/60 bg-[#1a1d2e] flex-shrink-0">
          <BookOpen size={12} className="text-blue-400"/>
          <span className="text-white font-bold text-xs">Strategy Builder</span>
          <span className="text-[9px] text-gray-600 bg-gray-700/40 px-1.5 py-0.5 rounded-full">
            {legs.length} leg{legs.length !== 1 ? 's' : ''}
          </span>
          <span className="text-[9px] text-gray-700">· {cfg.displayName} · Lot {lotSize}</span>
          <button onClick={() => setShowTemplates(!showTemplates)}
            className="ml-auto flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
            Templates {showTemplates ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
          </button>
        </div>

        {/* Templates */}
        {showTemplates && (
          <div className="px-2.5 py-2 border-b border-gray-800/40 bg-[#0e1018] flex-shrink-0">
            <div className="grid grid-cols-4 gap-1.5">
              {TEMPLATES.map(t => (
                <button key={t.name}
                  onClick={() => {
                    const newLegs = t.build(spotPrice, cfg.strikeStep);
                    const expStr  = legs[0]?.expiry ?? '';
                    setLegs(prev => [
                      ...prev,
                      ...newLegs.map(l => ({
                        ...l,
                        id:     nextId(),
                        symbol,
                        expiry: expStr,
                        iv:     14.0,
                        gamma:  0.0002,
                        vega:   0.15,
                      })),
                    ]);
                    setShowTemplates(false);
                  }}
                  className="flex flex-col items-center gap-1 p-2 bg-[#1a1d2e] hover:bg-[#222540] rounded-xl border border-gray-800/40 hover:border-blue-500/20 transition-colors group">
                  <span className="text-base leading-none">{t.icon}</span>
                  <span className="text-[8px] text-gray-700 group-hover:text-gray-400 text-center leading-tight">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Legs list */}
        <div className="flex-1 overflow-y-auto">
          {legs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
              <div className="w-14 h-14 bg-blue-500/5 rounded-2xl flex items-center justify-center mb-3 border border-blue-500/10">
                <Plus size={22} className="text-blue-600/40"/>
              </div>
              <p className="text-gray-500 text-xs font-semibold mb-1.5">No legs added yet</p>
              <p className="text-gray-700 text-[11px] leading-relaxed">
                Go to <span className="text-blue-400">Option Chain</span> → hover a row →
                click <span className="text-emerald-400 font-bold">B</span> or <span className="text-red-400 font-bold">S</span>
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {legs.map(leg => (
                <div key={leg.id} className={`rounded-2xl border p-2.5 transition-colors ${
                  leg.type === 'CE'
                    ? 'bg-blue-950/12 border-blue-800/20 hover:border-blue-700/30'
                    : 'bg-orange-950/12 border-orange-800/20 hover:border-orange-700/30'
                }`}>
                  <div className="grid grid-cols-12 gap-1 items-center">
                    {/* Type badge */}
                    <div className="col-span-2">
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-lg ${
                        leg.type === 'CE' ? 'bg-blue-500/15 text-blue-300' : 'bg-orange-500/15 text-orange-300'
                      }`}>{leg.type}</span>
                    </div>
                    {/* Strike */}
                    <div className="col-span-2 text-right text-[10px] text-white font-bold mono">
                      {leg.strike.toLocaleString('en-IN')}
                    </div>
                    {/* B/S toggle */}
                    <div className="col-span-3">
                      <div className="flex rounded-lg overflow-hidden border border-gray-700/40 text-[9px]">
                        <button onClick={() => onUpdateLeg(leg.id, { action:'BUY' })}
                          className={`flex-1 py-0.5 font-bold transition-colors ${leg.action==='BUY' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:text-gray-400'}`}>
                          BUY
                        </button>
                        <button onClick={() => onUpdateLeg(leg.id, { action:'SELL' })}
                          className={`flex-1 py-0.5 font-bold transition-colors ${leg.action==='SELL' ? 'bg-red-600 text-white' : 'text-gray-600 hover:text-gray-400'}`}>
                          SELL
                        </button>
                      </div>
                    </div>
                    {/* Lots */}
                    <div className="col-span-3">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => onUpdateLeg(leg.id, { lots: Math.max(1, leg.lots-1) })}
                          className="w-5 h-5 bg-gray-700/60 hover:bg-gray-600 text-gray-300 rounded text-[11px] flex items-center justify-center">−</button>
                        <input type="number" value={leg.lots} min={1} max={100}
                          onChange={e => onUpdateLeg(leg.id, { lots: Math.max(1, parseInt(e.target.value)||1) })}
                          className="w-10 text-center bg-gray-800/40 text-white text-[10px] rounded border border-gray-700/30 py-0.5 mono"/>
                        <button onClick={() => onUpdateLeg(leg.id, { lots: leg.lots+1 })}
                          className="w-5 h-5 bg-gray-700/60 hover:bg-gray-600 text-gray-300 rounded text-[11px] flex items-center justify-center">+</button>
                      </div>
                    </div>
                    {/* LTP */}
                    <div className="col-span-1 text-right">
                      <span className={`text-[10px] font-bold mono ${leg.type==='CE' ? 'text-blue-300' : 'text-orange-300'}`}>
                        ₹{leg.ltp.toFixed(2)}
                      </span>
                    </div>
                    {/* Remove */}
                    <div className="col-span-1 flex justify-end">
                      <button onClick={() => onRemoveLeg(leg.id)} className="text-gray-700 hover:text-red-400 transition-colors">
                        <Trash2 size={11}/>
                      </button>
                    </div>
                  </div>

                  {/* Order type row */}
                  <div className="mt-2 pt-1.5 border-t border-gray-800/25 flex items-center gap-2">
                    <span className="text-gray-700 text-[9px]">Order:</span>
                    <div className="flex rounded-lg overflow-hidden border border-gray-700/30 text-[9px]">
                      <button onClick={() => onUpdateLeg(leg.id, { orderType: 'market', limitPrice: undefined })}
                        className={`px-2 py-0.5 font-bold transition-colors ${(leg.orderType ?? 'market')==='market' ? 'bg-amber-600 text-white' : 'text-gray-600 hover:text-gray-300'}`}>
                        MKT
                      </button>
                      <button onClick={() => onUpdateLeg(leg.id, { orderType: 'limit', limitPrice: leg.limitPrice ?? leg.ltp })}
                        className={`px-2 py-0.5 font-bold transition-colors ${leg.orderType==='limit' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-300'}`}>
                        LMT
                      </button>
                    </div>
                    {leg.orderType === 'limit' && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-700 text-[9px]">₹</span>
                        <input type="number"
                          value={leg.limitPrice ?? leg.ltp}
                          onChange={e => onUpdateLeg(leg.id, { limitPrice: parseFloat(e.target.value) || leg.ltp })}
                          step="0.05" min="0.05"
                          className="w-20 bg-[#0a0c15] border border-blue-500/40 text-white text-[9px] rounded-lg px-2 py-0.5 mono outline-none"/>
                        <span className="text-gray-700 text-[9px]">limit</span>
                      </div>
                    )}
                    <span className="ml-auto text-gray-700 text-[9px]">
                      {(leg.orderType ?? 'market') === 'market' ? 'executes at market price' : 'executes at limit or better'}
                    </span>
                  </div>

                  {/* Greeks micro-row */}
                  <div className="mt-2 pt-1.5 border-t border-gray-800/25 grid grid-cols-4 gap-1">
                    {[
                      { sym:'Δ', val:leg.delta, col:'text-blue-400' },
                      { sym:'Θ', val:leg.theta, col:'text-red-400'  },
                      { sym:'Γ', val:leg.gamma, col:'text-purple-400' },
                      { sym:'V', val:leg.vega,  col:'text-amber-400' },
                    ].map(g => {
                      const net = (leg.action==='BUY'?1:-1) * g.val * leg.lots;
                      return (
                        <div key={g.sym} className="text-center">
                          <div className={`text-[8px] ${g.col}`}>{g.sym}</div>
                          <div className="text-[9px] text-gray-600 mono">{net>=0?'+':''}{net.toFixed(3)}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Premium cost/credit */}
                  <div className="mt-1 text-[9px] text-gray-700">
                    {leg.action==='BUY' ? 'Premium paid' : 'Premium received'}:{' '}
                    <span className={leg.action==='BUY' ? 'text-red-400' : 'text-emerald-400'}>
                      {leg.action==='BUY'?'-':'+'}₹{(leg.ltp*leg.lots*lotSize).toFixed(0)}
                    </span>
                    <span className="text-gray-800 ml-1">({leg.lots}L × {lotSize})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Summary + Execute */}
        {legs.length > 0 && (
          <div className="flex-shrink-0 border-t border-gray-800/50 p-2.5 bg-[#1a1d2e] space-y-2">
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="bg-[#0e1018] rounded-xl p-2 border border-gray-800/50">
                <div className="text-gray-700 text-[9px] mb-0.5">Net Premium</div>
                <div className={`font-bold ${netPremium>=0?'text-emerald-400':'text-red-400'}`}>
                  {netPremium>=0?'Credit ₹':'Debit ₹'}{Math.abs(netPremium).toFixed(0)}
                </div>
              </div>
              <div className="bg-[#0e1018] rounded-xl p-2 border border-gray-800/50">
                <div className="text-gray-700 text-[9px] mb-0.5">Breakeven{bes.length>1?'s':''}</div>
                <div className="font-bold text-yellow-400 text-[10px] mono truncate">
                  {bes.length > 0 ? bes.map(b=>`₹${b.toLocaleString('en-IN')}`).join(' / ') : 'N/A'}
                </div>
              </div>
              <div className="bg-emerald-900/6 rounded-xl p-2 border border-emerald-800/15">
                <div className="text-gray-700 text-[9px] mb-0.5">Max Profit</div>
                <div className="font-bold text-emerald-400 text-[10px]">{fmtMax(maxProfit)}</div>
              </div>
              <div className="bg-red-900/6 rounded-xl p-2 border border-red-800/15">
                <div className="text-gray-700 text-[9px] mb-0.5">Max Loss</div>
                <div className="font-bold text-red-400 text-[10px]">{fmtMax(maxLoss)}</div>
              </div>
            </div>

            {!showConfirm ? (
              <button onClick={() => setShowConfirm(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs transition-colors shadow-lg shadow-blue-500/15">
                <Zap size={12}/> Execute Strategy ({legs.length} leg{legs.length>1?'s':''})
              </button>
            ) : (
              <div className="bg-amber-500/6 border border-amber-500/20 rounded-xl p-2.5">
                <p className="text-amber-400 text-[10px] font-semibold mb-2">
                  ⚠️ Place {legs.length} live order{legs.length>1?'s':''} via ICICI Breeze API?
                </p>
                <div className="flex gap-2">
                  <button onClick={() => { onExecute(legs); setShowConfirm(false); }}
                    className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[10px] rounded-xl font-bold">
                    ✓ Confirm Execute
                  </button>
                  <button onClick={() => setShowConfirm(false)}
                    className="flex-1 py-1.5 bg-gray-700/60 hover:bg-gray-700 text-gray-300 text-[10px] rounded-xl">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── RIGHT: Chart + Greeks ─────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* View tabs */}
        <div className="flex-shrink-0 border-b border-gray-800/50 bg-[#1a1d2e] px-3 pt-2">
          <div className="flex items-center gap-1">
            {[
              { id:'payoff', icon:<BarChart2 size={11}/>, label:'Payoff Diagram' },
              { id:'greeks', icon:null,                   label:'Δ Greeks Dashboard' },
            ].map(v => (
              <button key={v.id} onClick={() => setView(v.id as 'payoff'|'greeks')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-t-xl font-medium border-b-2 -mb-px transition-colors ${
                  view === v.id
                    ? `text-white ${v.id==='payoff'?'border-blue-500':'border-purple-500'} bg-[#13161f]`
                    : 'text-gray-600 border-transparent hover:text-gray-300'
                }`}>
                {v.icon}{v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Greeks dashboard */}
        {view === 'greeks' && (
          <div className="flex-1 p-4 overflow-y-auto">
            <h3 className="text-white font-bold text-sm mb-0.5">Combined Greeks</h3>
            <p className="text-gray-600 text-[11px] mb-4">Net sensitivities — {cfg.displayName} · Lot size: {lotSize}</p>
            <div className="flex gap-2 mb-5">
              <GCard label="Delta (Δ)" value={greeks.delta} color="text-blue-400"   desc="P&L per ₹1 spot move"/>
              <GCard label="Theta (Θ)" value={greeks.theta} color="text-red-400"    desc="Time decay per day"/>
              <GCard label="Gamma (Γ)" value={greeks.gamma} color="text-purple-400" desc="Δ change per ₹1 move"/>
              <GCard label="Vega (V)"  value={greeks.vega}  color="text-amber-400"  desc="P&L per 1% IV change"/>
            </div>

            {legs.length > 0 && (<>
              <h4 className="text-gray-600 text-[10px] font-bold mb-2 uppercase tracking-wider">Per-Leg Breakdown</h4>
              <div className="bg-[#0e1018] rounded-2xl border border-gray-800/40 overflow-hidden">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-800/50">
                      <th className="px-3 py-2 text-left text-gray-600 font-semibold">Leg</th>
                      <th className="px-3 py-2 text-center text-gray-600 font-semibold">Act</th>
                      <th className="px-3 py-2 text-right text-blue-400   font-semibold">Δ</th>
                      <th className="px-3 py-2 text-right text-red-400    font-semibold">Θ</th>
                      <th className="px-3 py-2 text-right text-purple-400 font-semibold">Γ</th>
                      <th className="px-3 py-2 text-right text-amber-400  font-semibold">V</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legs.map((leg, i) => {
                      const m = leg.action==='BUY' ? 1 : -1;
                      return (
                        <tr key={leg.id} className={`border-b border-gray-800/20 ${i%2===0?'':'bg-gray-800/5'}`}>
                          <td className="px-3 py-1.5 mono">
                            <span className={`font-bold ${leg.type==='CE'?'text-blue-300':'text-orange-300'}`}>{leg.type}</span>{' '}
                            {leg.strike.toLocaleString('en-IN')}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`text-[8px] font-bold px-1 py-0.5 rounded-md ${leg.action==='BUY'?'bg-emerald-500/15 text-emerald-400':'bg-red-500/15 text-red-400'}`}>
                              {leg.action}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right mono text-blue-300">{(m*leg.delta*leg.lots).toFixed(4)}</td>
                          <td className="px-3 py-1.5 text-right mono text-red-300">{(m*leg.theta*leg.lots).toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right mono text-purple-300">{(m*leg.gamma*leg.lots).toFixed(5)}</td>
                          <td className="px-3 py-1.5 text-right mono text-amber-300">{(m*leg.vega*leg.lots).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-blue-500/5 border-t border-blue-500/15">
                      <td colSpan={2} className="px-3 py-1.5 text-gray-600 font-bold text-[9px] uppercase">NET</td>
                      <td className="px-3 py-1.5 text-right mono font-bold text-blue-300">{greeks.delta>=0?'+':''}{greeks.delta.toFixed(4)}</td>
                      <td className="px-3 py-1.5 text-right mono font-bold text-red-300">{greeks.theta>=0?'+':''}{greeks.theta.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right mono font-bold text-purple-300">{greeks.gamma>=0?'+':''}{greeks.gamma.toFixed(5)}</td>
                      <td className="px-3 py-1.5 text-right mono font-bold text-amber-300">{greeks.vega>=0?'+':''}{greeks.vega.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>)}
          </div>
        )}

        {/* Payoff chart */}
        {view === 'payoff' && (<>
          <div className="flex-1 flex flex-col px-4 pt-3 pb-2 overflow-hidden">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <div>
                <span className="text-white font-bold text-xs">Payoff at Expiry</span>
                <span className="text-gray-700 text-[10px] ml-2">{cfg.displayName} · {lotSize} qty/lot · ±8% range</span>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-emerald-400"><span className="w-2.5 h-1.5 rounded-sm bg-emerald-500/40 inline-block"/>Profit</span>
                <span className="flex items-center gap-1 text-red-400"><span className="w-2.5 h-1.5 rounded-sm bg-red-500/40 inline-block"/>Loss</span>
              </div>
            </div>

            {legs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-700">
                <Target size={52} className="mb-3 opacity-10"/>
                <p className="text-sm text-gray-600">Add option legs to see the payoff diagram</p>
                <p className="text-[11px] mt-1 text-gray-700">Shows P&L at expiry vs. spot price</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={payoff} margin={{ top:10, right:20, left:5, bottom:5 }}>
                    <defs>
                      <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.28}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
                      </linearGradient>
                      <linearGradient id="gLoss" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.28}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1d2e" vertical={false}/>
                    <XAxis dataKey="price"
                      tickFormatter={v => `₹${(Number(v)/1000).toFixed(1)}K`}
                      stroke="#1e2135" tick={{ fill:'#4b5563', fontSize:9 }} tickLine={false}/>
                    <YAxis
                      tickFormatter={v => Math.abs(Number(v))>=1000 ? `₹${(Number(v)/1000).toFixed(0)}K` : `₹${v}`}
                      stroke="#1e2135" tick={{ fill:'#4b5563', fontSize:9 }} tickLine={false} axisLine={false} width={58}/>
                    <Tooltip content={<ChartTip/>}/>
                    <ReferenceLine y={0} stroke="#2d3147" strokeDasharray="4 4" strokeWidth={1}/>
                    <ReferenceLine x={spotPrice} stroke="#f59e0b" strokeDasharray="5 3" strokeWidth={1.5}
                      label={{ value:'Spot', fill:'#f59e0b', fontSize:9, position:'insideTopLeft' }}/>
                    {bes.map((be, i) => (
                      <ReferenceLine key={i} x={be} stroke="#a78bfa" strokeDasharray="3 3" strokeWidth={1}
                        label={{ value:`BE${bes.length>1?i+1:''} ₹${be.toLocaleString('en-IN')}`, fill:'#a78bfa', fontSize:8, position:'insideTopRight' }}/>
                    ))}
                    <Area type="monotone" dataKey="profit" stroke="none" fill="url(#gProfit)" dot={false}/>
                    <Area type="monotone" dataKey="loss"   stroke="none" fill="url(#gLoss)"   dot={false}/>
                    <Line type="monotone" dataKey="pnl" stroke="#60a5fa" strokeWidth={2} dot={false}
                      activeDot={{ r:4, fill:'#60a5fa', stroke:'#1e40af', strokeWidth:2 }}/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Stats strip */}
          {legs.length > 0 && (
            <div className="flex-shrink-0 border-t border-gray-800/50 bg-[#0e1018] px-4 py-1.5">
              <div className="flex items-center gap-4 text-[10px] flex-wrap">
                <span className="flex gap-1.5 items-center">
                  <span className="text-gray-600">Max Profit:</span>
                  <span className="text-emerald-400 font-bold">{fmtMax(maxProfit)}</span>
                </span>
                <span className="flex gap-1.5 items-center">
                  <span className="text-gray-600">Max Loss:</span>
                  <span className="text-red-400 font-bold">{fmtMax(maxLoss)}</span>
                </span>
                {bes.map((be, i) => (
                  <span key={i} className="flex gap-1.5 items-center">
                    <span className="text-gray-600">BE{bes.length>1?` ${i+1}`:''}:</span>
                    <span className="text-purple-400 font-bold mono">₹{be.toLocaleString('en-IN')}</span>
                  </span>
                ))}
                <span className="ml-auto flex gap-1.5 items-center">
                  <span className="text-gray-600">Net:</span>
                  <span className={`font-bold ${netPremium>=0?'text-emerald-400':'text-red-400'}`}>
                    {netPremium>=0?'Cr ':'Dr '}₹{Math.abs(netPremium).toFixed(0)}
                  </span>
                </span>
              </div>
            </div>
          )}
        </>)}
      </div>
    </div>
  );
};
