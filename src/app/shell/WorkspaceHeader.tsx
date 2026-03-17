import { Command, RefreshCw, Sparkles, Wifi, WifiOff } from 'lucide-react';
import { TruthPill } from '../../components/TruthPill';
import type { TruthDescriptor } from '../../lib/truth';
import { ALL_SYMBOLS, SYMBOL_CONFIG } from '../../config/market';
import type { MarketIndex, SymbolCode } from '../../types/index';
import { WORKSPACE_ROUTE_BY_PATH, type WorkspacePath } from '../router';

export function WorkspaceHeader({
  currentPath,
  symbol,
  onSymbolChange,
  onOpenConnections,
  onRefresh,
  statusMessage,
  statusTruth,
  isLive,
  streamLabel,
  lastUpdate,
  liveIndices,
  spotTruth,
  chainTruth,
}: {
  currentPath: WorkspacePath;
  symbol: SymbolCode;
  onSymbolChange: (symbol: SymbolCode) => void;
  onOpenConnections: () => void;
  onRefresh: () => void;
  statusMessage: string;
  statusTruth: TruthDescriptor;
  isLive: boolean;
  streamLabel: string;
  lastUpdate: Date;
  liveIndices: MarketIndex[];
  spotTruth: TruthDescriptor;
  chainTruth: TruthDescriptor;
}) {
  const route = WORKSPACE_ROUTE_BY_PATH[currentPath];

  return (
    <header className="border-b border-white/8 bg-[linear-gradient(180deg,rgba(12,24,39,0.96),rgba(9,17,30,0.9))] px-5 py-4 backdrop-blur-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.34em] text-orange-300/75">
            <span>{route.group}</span>
            <span className="h-1 w-1 rounded-full bg-orange-400/70" />
            <span>Updated {lastUpdate.toLocaleTimeString('en-IN')}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{route.title}</h1>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${isLive ? 'bg-emerald-500/12 text-emerald-200' : 'bg-amber-500/12 text-amber-200'}`}>
              {streamLabel}
            </span>
            <TruthPill descriptor={spotTruth} compact />
            <TruthPill descriptor={chainTruth} compact />
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">{route.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <RefreshCw size={14} />
            Refresh
          </button>

          <button
            onClick={onOpenConnections}
            className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition ${
              isLive
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15'
            }`}
          >
            {isLive ? <Wifi size={14} /> : <WifiOff size={14} />}
            {isLive ? 'Stream live' : 'Review connections'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex flex-wrap items-center rounded-[22px] border border-white/8 bg-white/5 p-1.5">
          {ALL_SYMBOLS.map((candidate) => {
            const active = candidate === symbol;
            return (
              <button
                key={candidate}
                onClick={() => onSymbolChange(candidate)}
                className={`rounded-2xl px-3 py-2 text-left transition ${active ? 'bg-orange-500 text-white shadow-[0_10px_26px_rgba(249,115,22,0.26)]' : 'text-slate-300 hover:bg-white/6'}`}
              >
                <div className="text-xs font-semibold">{SYMBOL_CONFIG[candidate].displayName}</div>
                <div className="text-[10px] opacity-75">
                  {SYMBOL_CONFIG[candidate].exchange} · Lot {SYMBOL_CONFIG[candidate].lotSize}
                </div>
                </button>
              );
            })}
        </div>

        <div className="flex flex-1 flex-wrap gap-2 2xl:justify-end">
          <div className="flex min-w-[280px] flex-1 flex-wrap gap-2 rounded-[22px] border border-white/8 bg-white/5 px-3 py-3 2xl:max-w-[620px]">
            {liveIndices.map((index) => (
              <div key={index.label} className="rounded-2xl bg-black/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{index.label}</div>
                <div className="mono mt-1 text-sm text-white">{index.value.toFixed(2)}</div>
              </div>
            ))}
          </div>
          <div className="min-w-[260px] rounded-[22px] border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-500">
              <Sparkles size={12} />
              Desk Notes
            </div>
            <div className="mt-2 text-sm text-white">{statusMessage}</div>
            <div className="mt-2">
              <TruthPill descriptor={statusTruth} compact />
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <Command size={12} />
              `Ctrl+K` palette · `Shift+C` connections
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
