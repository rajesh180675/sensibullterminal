// ════════════════════════════════════════════════════════════════════════════
// OPTIONS TERMINAL — Root Application v10
//
// KEY FIX: session is now passed to ALL child components that need it,
// including <Positions session={session}/> so it can call Kaggle backend
// for live orders, trades, funds, and square-off.
//
// LIVE DATA FLOW (anti-ban, per BreezeEngine spec):
//   1. User connects → POST /api/connect (BreezeEngine.connect)
//   2. Fetch expiries → GET /api/expiries (one REST call)
//   3. Fetch chain   → GET /api/optionchain × 2 (CE + PE, one snapshot)
//   4. Subscribe WS  → POST /api/ws/subscribe (tell backend)
//   5. Open WS       → wss://backend/ws/ticks (live tick stream)
//   6. onTickUpdate  → merge into chain → React re-render
//   7. On expiry change → steps 3-5 only
//
//   ✓ ZERO setInterval polling of REST endpoints
//   ✓ get_option_chain_quotes called ONCE per expiry, never in loop
//   ✓ All live prices come from WebSocket on_ticks callback
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react';
import { TopBar }             from './components/TopBar';
import { OptionChain }        from './components/OptionChain';
import { StrategyBuilder }    from './components/StrategyBuilder';
import { Positions }          from './components/Positions';
import { ConnectBrokerModal } from './components/ConnectBrokerModal';

import {
  OptionLeg, OptionRow, ExpiryDate, Position,
  SymbolCode, BreezeSession,
} from './types/index';
import { generateChain, simulateTick }            from './data/mock';
import { SPOT_PRICES, getExpiries, SYMBOL_CONFIG } from './config/market';
import { placeLegOrder, extractApiSession }        from './utils/breezeClient';
import {
  fetchOptionChain  as kaggleFetchChain,
  fetchExpiryDates,
  fetchPositions    as kaggleFetchPositions,
  isKaggleBackend,
  type OptionQuote,
} from './utils/kaggleClient';
import {
  breezeWs,
  subscribeOptionChain,
  startTickPolling,
  type TickData,
  type WsStatus,
} from './utils/breezeWs';

type Tab = 'optionchain' | 'strategy' | 'positions';

let _lid = 0;
const nextId = () => `leg-${++_lid}-${Date.now()}`;
const DEFAULT_SYM: SymbolCode = 'NIFTY';

// ── Merge Breeze OptionQuote[] (CE + PE) → OptionRow[] ───────────────────────
function mergeQuotesToChain(
  calls: OptionQuote[],
  puts:  OptionQuote[],
  spot:  number,
  step:  number,
): OptionRow[] {
  const ceMap = new Map<number, OptionQuote>();
  const peMap = new Map<number, OptionQuote>();

  calls.forEach(q => {
    const s = Math.round(parseFloat(q['strike-price']) || 0);
    if (s > 0) ceMap.set(s, q);
  });
  puts.forEach(q => {
    const s = Math.round(parseFloat(q['strike-price']) || 0);
    if (s > 0) peMap.set(s, q);
  });

  const allStrikes = Array.from(
    new Set([...ceMap.keys(), ...peMap.keys()])
  ).sort((a, b) => a - b);

  if (allStrikes.length === 0) return [];

  const ATM = allStrikes.reduce((p, c) =>
    Math.abs(c - spot) < Math.abs(p - spot) ? c : p
  );

  return allStrikes.map(strike => {
    const ce = ceMap.get(strike);
    const pe = peMap.get(strike);
    const n  = (v: string | undefined, fb = 0) => {
      const x = parseFloat(v ?? '');
      return isNaN(x) ? fb : x;
    };

    const ce_ltp    = n(ce?.ltp);
    const pe_ltp    = n(pe?.ltp);
    const dte       = 7;
    const T         = dte / 365;
    const mono      = (spot - strike) / spot;
    const ce_delta  = Math.max(0.01, Math.min(0.99, 0.5 + mono * 2.5));
    const pe_delta  = -(1 - ce_delta);
    const gamma     = 0.00028 * Math.exp(-Math.pow(mono * 10, 2) / 2);
    const theta     = -((ce_ltp || 1) * 0.016 + 1.2);
    const vega      = 18 * gamma * spot * 0.01 * Math.sqrt(T > 0 ? T : 0.019);

    return {
      strike,
      isATM: Math.abs(strike - ATM) < step / 2,
      ce_ltp,
      ce_oi:     n(ce?.['open-interest']),
      ce_oiChg:  n(ce?.['oi-change-percentage']),
      ce_volume: n(ce?.['total-quantity-traded']),
      ce_iv:     n(ce?.['implied-volatility']),
      ce_delta,
      ce_theta:  theta,
      ce_gamma:  gamma,
      ce_vega:   vega,
      ce_bid:    n(ce?.['best-bid-price']),
      ce_ask:    n(ce?.['best-offer-price']),
      pe_ltp,
      pe_oi:     n(pe?.['open-interest']),
      pe_oiChg:  n(pe?.['oi-change-percentage']),
      pe_volume: n(pe?.['total-quantity-traded']),
      pe_iv:     n(pe?.['implied-volatility']),
      pe_delta,
      pe_theta:  theta,
      pe_gamma:  gamma,
      pe_vega:   vega,
      pe_bid:    n(pe?.['best-bid-price']),
      pe_ask:    n(pe?.['best-offer-price']),
    } satisfies OptionRow;
  });
}

// ── Derive live spot from ATM strike (put-call parity) ────────────────────────
function deriveSpot(chain: OptionRow[]): number | null {
  const atm = chain.find(r => r.isATM);
  if (!atm) return null;
  return Math.round(atm.strike + (atm.ce_ltp - atm.pe_ltp));
}

// ── Merge WebSocket tick delta into existing option chain ─────────────────────
function applyTicksToChain(chain: OptionRow[], ticks: TickData[]): OptionRow[] {
  if (ticks.length === 0) return chain;

  const ceUpdates = new Map<number, Partial<OptionRow>>();
  const peUpdates = new Map<number, Partial<OptionRow>>();

  for (const tick of ticks) {
    const isCE = tick.right === 'CE';
    const map  = isCE ? ceUpdates : peUpdates;
    const prev = map.get(tick.strike) || {};

    map.set(tick.strike, {
      ...prev,
      ...(isCE ? {
        ce_ltp:    tick.ltp,
        ce_oi:     tick.oi,
        ce_volume: tick.volume,
        ce_iv:     tick.iv,
        ce_bid:    tick.bid,
        ce_ask:    tick.ask,
      } : {
        pe_ltp:    tick.ltp,
        pe_oi:     tick.oi,
        pe_volume: tick.volume,
        pe_iv:     tick.iv,
        pe_bid:    tick.bid,
        pe_ask:    tick.ask,
      }),
    });
  }

  let changed = false;
  const next = chain.map(row => {
    const cu = ceUpdates.get(row.strike);
    const pu = peUpdates.get(row.strike);
    if (!cu && !pu) return row;
    changed = true;
    return { ...row, ...cu, ...pu };
  });

  return changed ? next : chain;
}

// ── Map Breeze portfolio response → Position[] ───────────────────────────────
function mapBreezePositions(data: unknown): Position[] {
  const d = data as { positions?: unknown[]; holdings?: unknown[] } | null;
  if (!d?.positions) return [];

  const positions: Position[] = [];
  (d.positions as Array<Record<string, string>>).forEach((p, idx) => {
    const isOptions = !!(p.right || p.strike_price);
    if (!isOptions) return;

    const sym: SymbolCode =
      (p.stock_code || '').includes('SENSEX') ||
      (p.stock_code || '').includes('BSESEN')
        ? 'BSESEN' : 'NIFTY';

    const action     = (p.action || p.transaction_type || '').toLowerCase().startsWith('b') ? 'BUY' : 'SELL';
    const type: 'CE' | 'PE' = (p.right || '').toLowerCase().startsWith('c') ? 'CE' : 'PE';
    const strike     = parseFloat(p.strike_price || '0');
    const entryPx    = parseFloat(p.average_price || '0');
    const currentPx  = parseFloat(p.ltp || p.current_price || String(entryPx));
    const qty        = parseInt(p.quantity || '1');
    const lotSize    = SYMBOL_CONFIG[sym].lotSize;
    const lots       = Math.max(1, Math.round(qty / lotSize));
    const pnl        = (action === 'BUY' ? 1 : -1) * (currentPx - entryPx) * qty;

    positions.push({
      id:        `live-${idx}`,
      symbol:    sym,
      expiry:    p.expiry_date || '',
      strategy:  `${sym} ${type} ${strike}`,
      entryDate: p.order_date || new Date().toISOString().slice(0, 10),
      status:    'ACTIVE',
      mtmPnl:    Math.round(pnl),
      maxProfit: Infinity,
      maxLoss:   -Infinity,
      legs: [{
        type, strike, action, lots,
        entryPrice:   entryPx,
        currentPrice: currentPx,
        pnl:          Math.round(pnl),
      }],
    });
  });

  return positions;
}

// ═════════════════════════════════════════════════════════════════════════════

export function App() {
  const [tab,           setTab]           = useState<Tab>('optionchain');
  const [symbol,        setSymbol]        = useState<SymbolCode>(DEFAULT_SYM);
  const [expiry,        setExpiry]        = useState<ExpiryDate>(getExpiries(DEFAULT_SYM)[0]);
  const [chain,         setChain]         = useState<OptionRow[]>(() => generateChain(DEFAULT_SYM));
  const [legs,          setLegs]          = useState<OptionLeg[]>([]);
  const [showBroker,    setShowBroker]    = useState(false);
  const [session,       setSession]       = useState<BreezeSession | null>(null);
  const [lastUpdate,    setLastUpdate]    = useState(new Date());
  const [isLoading,     setIsLoading]     = useState(false);
  const [spotPrice,     setSpotPrice]     = useState<number>(SPOT_PRICES[DEFAULT_SYM]);
  const [livePositions, setLivePositions] = useState<Position[] | null>(null);
  const [loadingMsg,    setLoadingMsg]    = useState('');
  const [wsStatus,      setWsStatus]      = useState<WsStatus>('disconnected');

  const demoTickRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPollRef  = useRef<(() => void) | null>(null);
  const currentChain = useRef<OptionRow[]>(chain);
  const currentSpot  = useRef<number>(spotPrice);
  const currentSym   = useRef<SymbolCode>(symbol);
  const cfg          = SYMBOL_CONFIG[symbol];

  useEffect(() => { currentChain.current = chain; },     [chain]);
  useEffect(() => { currentSpot.current  = spotPrice; }, [spotPrice]);
  useEffect(() => { currentSym.current   = symbol; },    [symbol]);

  // ── Auto-extract ?apisession= ─────────────────────────────────────────────
  useEffect(() => {
    const token = extractApiSession();
    if (token) setShowBroker(true);
  }, []);

  // ── Demo tick simulation (only when NOT connected) ────────────────────────
  useEffect(() => {
    if (session?.isConnected) {
      if (demoTickRef.current) { clearInterval(demoTickRef.current); demoTickRef.current = null; }
      return;
    }
    demoTickRef.current = setInterval(() => {
      setChain(prev => simulateTick(prev));
      setLastUpdate(new Date());
    }, 2500);
    return () => { if (demoTickRef.current) clearInterval(demoTickRef.current); };
  }, [session?.isConnected]);

  // ── WebSocket tick handler ────────────────────────────────────────────────
  const handleTickUpdate = useCallback((update: { ticks: TickData[]; ws_live: boolean }) => {
    setChain(prev => applyTicksToChain(prev, update.ticks));
    setLastUpdate(new Date());

    // Derive spot from ATM tick
    const atm = currentChain.current.find(r => r.isATM);
    if (atm && update.ticks.length > 0) {
      const ceTick = update.ticks.find(t => t.strike === atm.strike && t.right === 'CE');
      const peTick = update.ticks.find(t => t.strike === atm.strike && t.right === 'PE');
      const ceLtp  = ceTick?.ltp ?? atm.ce_ltp;
      const peLtp  = peTick?.ltp ?? atm.pe_ltp;
      const derived = Math.round(atm.strike + (ceLtp - peLtp));
      if (derived > 0 && Math.abs(derived - currentSpot.current) < currentSpot.current * 0.05) {
        setSpotPrice(derived);
        SPOT_PRICES[currentSym.current] = derived;
      }
    }
  }, []);

  // ── Start WebSocket connection ─────────────────────────────────────────────
  const startWsConnection = useCallback((backendUrl: string) => {
    setWsStatus('connecting');
    breezeWs.connect(
      backendUrl,
      handleTickUpdate,
      (status: WsStatus) => {
        setWsStatus(status);
        if (status === 'connected') {
          setLoadingMsg('● WebSocket live — tick streaming active');
        } else if (status === 'reconnecting') {
          setLoadingMsg('⟳ WebSocket reconnecting...');
        } else if (status === 'error') {
          console.warn('[App] WS failed — falling back to REST tick polling');
          const stopFn = startTickPolling(backendUrl, handleTickUpdate);
          stopPollRef.current = stopFn;
          setLoadingMsg('⚠️ WS unavailable — REST polling fallback active');
        }
      },
    );
  }, [handleTickUpdate]);

  // ── Stop WebSocket / polling ──────────────────────────────────────────────
  const stopLiveData = useCallback(() => {
    breezeWs.disconnect();
    if (stopPollRef.current) { stopPollRef.current(); stopPollRef.current = null; }
    setWsStatus('disconnected');
  }, []);

  // ── Fetch live option chain (REST — ONCE per expiry) ──────────────────────
  const fetchLiveChain = useCallback(async (
    sym:  SymbolCode,
    exp:  ExpiryDate,
    sess: BreezeSession,
  ) => {
    if (!isKaggleBackend(sess.proxyBase)) return;

    const { breezeStockCode, breezeExchangeCode } = SYMBOL_CONFIG[sym];
    setIsLoading(true);
    setLoadingMsg('Fetching option chain snapshot from ICICI Breeze...');

    try {
      const [callResult, putResult] = await Promise.all([
        kaggleFetchChain(sess.proxyBase, {
          stockCode: breezeStockCode, exchangeCode: breezeExchangeCode,
          expiryDate: exp.breezeValue, right: 'Call',
        }),
        kaggleFetchChain(sess.proxyBase, {
          stockCode: breezeStockCode, exchangeCode: breezeExchangeCode,
          expiryDate: exp.breezeValue, right: 'Put',
        }),
      ]);

      const calls  = callResult.data ?? [];
      const puts   = putResult.data  ?? [];
      const merged = mergeQuotesToChain(calls, puts, currentSpot.current, SYMBOL_CONFIG[sym].strikeStep);

      if (merged.length > 0) {
        setChain(merged);
        currentChain.current = merged;

        const derived = deriveSpot(merged);
        if (derived && Math.abs(derived - currentSpot.current) < currentSpot.current * 0.05) {
          setSpotPrice(derived);
          SPOT_PRICES[sym] = derived;
          currentSpot.current = derived;
        }
        setLastUpdate(new Date());
        setLoadingMsg(`✓ ${merged.length} strikes loaded — subscribing WS feeds...`);

        const strikes   = merged.map(r => r.strike);
        const subResult = await subscribeOptionChain(
          sess.proxyBase, breezeStockCode, breezeExchangeCode, exp.breezeValue, strikes,
        );

        setLoadingMsg(subResult.ok
          ? `✓ Live — ${merged.length} strikes · ${subResult.subscribed ?? 0} WS feeds`
          : `✓ ${merged.length} strikes (WS: ${subResult.error})`);
      } else {
        setLoadingMsg('⚠️ No data — market may be closed or expiry invalid');
      }
    } catch (err) {
      setLoadingMsg(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Fetch expiries from backend ───────────────────────────────────────────
  const fetchLiveExpiries = useCallback(async (
    sym:  SymbolCode,
    sess: BreezeSession,
  ): Promise<ExpiryDate[]> => {
    if (!isKaggleBackend(sess.proxyBase)) return getExpiries(sym);
    try {
      const { breezeStockCode, breezeExchangeCode } = SYMBOL_CONFIG[sym];
      const r = await fetchExpiryDates(sess.proxyBase, breezeStockCode, breezeExchangeCode);
      if (r.ok && r.expiries.length > 0) {
        return r.expiries.map(e => ({
          label:        e.label || e.date,
          breezeValue:  e.date,
          daysToExpiry: e.days_away,
        }));
      }
    } catch { /* fall through */ }
    return getExpiries(sym);
  }, []);

  // ── Fetch live positions ──────────────────────────────────────────────────
  const fetchLivePositions = useCallback(async (sess: BreezeSession) => {
    if (!isKaggleBackend(sess.proxyBase)) return;
    try {
      const r = await kaggleFetchPositions(sess.proxyBase);
      if (r.ok && r.data) {
        const mapped = mapBreezePositions(r.data);
        // Always update — even if empty (empty = no open positions)
        setLivePositions(mapped.length > 0 ? mapped : []);
      }
    } catch (e) {
      console.warn('[App] fetchLivePositions error:', e);
    }
  }, []);

  // ── On symbol change ──────────────────────────────────────────────────────
  useEffect(() => {
    setSpotPrice(SPOT_PRICES[symbol]);
    setLegs([]);
    const doChange = async () => {
      if (session?.isConnected && isKaggleBackend(session.proxyBase)) {
        const liveExpiries = await fetchLiveExpiries(symbol, session);
        const newExpiry    = liveExpiries[0];
        setExpiry(newExpiry);
        await fetchLiveChain(symbol, newExpiry, session);
      } else {
        setExpiry(getExpiries(symbol)[0]);
        setChain(generateChain(symbol));
        setLastUpdate(new Date());
      }
    };
    doChange();
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── On expiry change ──────────────────────────────────────────────────────
  useEffect(() => {
    if (session?.isConnected && isKaggleBackend(session.proxyBase)) {
      fetchLiveChain(symbol, expiry, session);
    }
  }, [expiry.breezeValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── On connect ────────────────────────────────────────────────────────────
  const handleConnected = useCallback(async (s: BreezeSession) => {
    setSession(s);
    setLoadingMsg('Connected! Initialising live data...');

    if (isKaggleBackend(s.proxyBase)) {
      startWsConnection(s.proxyBase);

      const liveExpiries = await fetchLiveExpiries(symbol, s);
      if (liveExpiries.length > 0) {
        setExpiry(liveExpiries[0]);
        await fetchLiveChain(symbol, liveExpiries[0], s);
      } else {
        await fetchLiveChain(symbol, expiry, s);
      }

      await fetchLivePositions(s);
    }
  }, [symbol, expiry, fetchLiveChain, fetchLiveExpiries, fetchLivePositions, startWsConnection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup on disconnect / unmount ──────────────────────────────────────
  useEffect(() => { if (!session?.isConnected) stopLiveData(); }, [session?.isConnected, stopLiveData]);
  useEffect(() => () => { stopLiveData(); }, [stopLiveData]);

  // ── Manual refresh ────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    if (session?.isConnected && isKaggleBackend(session.proxyBase)) {
      await fetchLiveChain(symbol, expiry, session);
    } else {
      setChain(generateChain(symbol, spotPrice));
      setLastUpdate(new Date());
    }
    setIsLoading(false);
  }, [session, symbol, expiry, spotPrice, fetchLiveChain]);

  // ── Leg management ────────────────────────────────────────────────────────
  const handleAddLeg = useCallback((leg: Omit<OptionLeg, 'id'>) => {
    setLegs(prev => [...prev, { ...leg, id: nextId() }]);
    if (tab === 'optionchain') setTab('strategy');
  }, [tab]);

  const handleUpdateLeg = useCallback((id: string, u: Partial<OptionLeg>) =>
    setLegs(prev => prev.map(l => l.id === id ? { ...l, ...u } : l)), []);

  const handleRemoveLeg = useCallback((id: string) =>
    setLegs(prev => prev.filter(l => l.id !== id)), []);

  // ── Execute strategy ──────────────────────────────────────────────────────
  const handleExecute = useCallback(async (execLegs: OptionLeg[]) => {
    if (!session?.isConnected) {
      alert('⚠️ Not connected.\n\nClick "Connect Broker" → enter credentials → Validate Live.');
      return;
    }

    const results: string[] = [];

    if (isKaggleBackend(session.proxyBase)) {
      try {
        const base = session.proxyBase.replace(/\/api\/?$/, '').replace(/\/$/, '');
        const res  = await fetch(`${base}/api/strategy/execute`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            legs: execLegs.map(leg => ({
              stock_code:    cfg.breezeStockCode,
              exchange_code: cfg.breezeExchangeCode,
              action:        leg.action.toLowerCase(),
              quantity:      String(leg.lots * cfg.lotSize),
              expiry_date:   leg.expiry,
              right:         leg.type === 'CE' ? 'call' : 'put',
              strike_price:  String(leg.strike),
              order_type:    leg.orderType ?? 'market',
              price:         leg.orderType === 'limit' ? String(leg.limitPrice ?? leg.ltp) : '0',
            })),
          }),
        });
        const data = await res.json() as {
          success: boolean;
          results: Array<{ success: boolean; order_id: string; error: string; leg_index: number }>;
        };
        if (data.results) {
          data.results.forEach((r, i) => {
            const leg = execLegs[i];
            results.push(r.success
              ? `✓ ${leg.type} ${leg.strike} ${leg.action} → OrderID: ${r.order_id}`
              : `✗ ${leg.type} ${leg.strike}: ${r.error}`);
          });
        }
      } catch (e) {
        results.push(`✗ Strategy execute error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      for (const leg of execLegs) {
        try {
          const r = await placeLegOrder(session, {
            stockCode:    cfg.breezeStockCode,
            exchangeCode: cfg.breezeExchangeCode,
            right:        leg.type === 'CE' ? 'call' : 'put',
            strikePrice:  String(leg.strike),
            expiryDate:   leg.expiry,
            action:       leg.action.toLowerCase() as 'buy' | 'sell',
            quantity:     String(leg.lots * cfg.lotSize),
            orderType:    (leg.orderType ?? 'market') as 'market' | 'limit',
            price:        leg.orderType === 'limit' ? String(leg.limitPrice ?? leg.ltp) : '0',
          });
          results.push(`✓ ${leg.type} ${leg.strike} ${leg.action} → ${r.order_id}`);
        } catch (e) {
          results.push(`✗ ${leg.type} ${leg.strike}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    alert(`Strategy Results:\n\n${results.join('\n')}`);
  }, [session, cfg]);

  // ── Load position into builder ────────────────────────────────────────────
  const handleLoadPosition = useCallback((pos: Position) => {
    setLegs(pos.legs.map(l => ({
      id:     nextId(),
      symbol: pos.symbol,
      type:   l.type,
      strike: l.strike,
      action: l.action,
      lots:   l.lots,
      ltp:    l.currentPrice,
      iv:     14.0,
      delta:  l.type === 'CE' ? 0.45 : -0.45,
      theta:  -2.5,
      gamma:  0.0002,
      vega:   0.15,
      expiry: expiry.breezeValue,
    })));
    setSymbol(pos.symbol);
    setTab('strategy');
  }, [expiry.breezeValue]);

  // ── Tab switch → refresh live data ────────────────────────────────────────
  const handleTabChange = useCallback(async (t: string) => {
    setTab(t as Tab);
    if (t === 'positions' && session?.isConnected && isKaggleBackend(session.proxyBase)) {
      await fetchLivePositions(session);
    }
  }, [session, fetchLivePositions]);

  // ATM fix: recompute isATM on every chain render using live spotPrice
  const chainWithAtm = chain.map(row => ({
    ...row,
    isATM: Math.abs(row.strike - spotPrice) === Math.min(...chain.map(r => Math.abs(r.strike - spotPrice))),
  }));

  const isLive             = !!(session?.isConnected && isKaggleBackend(session.proxyBase));
  const highlightedStrikes = new Set(legs.map(l => l.strike));

  const wsLabel = wsStatus === 'connected'    ? '● WS Live'
                : wsStatus === 'connecting'   ? '⟳ WS Connecting'
                : wsStatus === 'reconnecting' ? '⟳ WS Reconnecting'
                : wsStatus === 'error'        ? '⚠ WS Error'
                : '';

  return (
    <div className="flex flex-col h-screen bg-[#0d0f1a] overflow-hidden text-white">
      <TopBar
        selectedSymbol={symbol}
        onSymbolChange={setSymbol}
        activeTab={tab}
        onTabChange={handleTabChange}
        session={session}
        onOpenBroker={() => setShowBroker(true)}
        strategyLegCount={legs.length}
        lastUpdate={lastUpdate}
        isLive={isLive}
        loadingMsg={wsLabel || loadingMsg}
      />

      <main className="flex-1 overflow-hidden">
        {tab === 'optionchain' && (
          <OptionChain
            symbol={symbol}
            data={chainWithAtm}
            spotPrice={spotPrice}
            selectedExpiry={expiry}
            onExpiryChange={setExpiry}
            onAddLeg={handleAddLeg}
            highlightedStrikes={highlightedStrikes}
            lastUpdate={lastUpdate}
            isLoading={isLoading}
            onRefresh={handleRefresh}
            isLive={isLive}
            loadingMsg={loadingMsg}
          />
        )}

        {tab === 'strategy' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-hidden">
              <StrategyBuilder
                legs={legs}
                onUpdateLeg={handleUpdateLeg}
                onRemoveLeg={handleRemoveLeg}
                onExecute={handleExecute}
                spotPrice={spotPrice}
                symbol={symbol}
              />
            </div>
            <div className="border-t border-gray-800/40 bg-[#1a1d2e] px-4 py-1.5 flex items-center gap-3 text-[10px] flex-shrink-0">
              <span className="text-gray-700">Add more legs:</span>
              <button onClick={() => setTab('optionchain')} className="text-blue-400 hover:text-blue-300 underline">
                Option Chain →
              </button>
              {legs.length > 0 && (
                <button onClick={() => setLegs([])} className="ml-auto text-red-500 hover:text-red-400 text-[10px]">
                  Clear all legs
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'positions' && (
          <Positions
            onLoadToBuilder={handleLoadPosition}
            livePositions={livePositions}
            isLive={isLive}
            session={session}              // ← CRITICAL: pass session so Positions can call backend
            onRefreshPositions={() => session && fetchLivePositions(session)}
          />
        )}
      </main>

      {tab === 'optionchain' && legs.length > 0 && (
        <div className="fixed bottom-5 right-5 z-30">
          <button onClick={() => setTab('strategy')}
            className="flex items-center gap-2.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl shadow-2xl font-bold text-sm transition-all hover:scale-105 active:scale-95">
            <span className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center text-xs font-black">
              {legs.length}
            </span>
            View Strategy
          </button>
        </div>
      )}

      {showBroker && (
        <ConnectBrokerModal
          onClose={() => setShowBroker(false)}
          onConnected={handleConnected}
          session={session}
        />
      )}
    </div>
  );
}
