import { Bell, Cable, Command, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { ALL_SYMBOLS, SYMBOL_CONFIG } from '../../config/market';
import type { MarketIndex, SymbolCode } from '../../types/index';
import type { WorkspacePath } from '../router';

const TITLES: Record<WorkspacePath, { title: string; subtitle: string }> = {
  '/market': { title: 'Market Workspace', subtitle: 'Option chain, expiries, live spot, and streaming depth.' },
  '/strategy': { title: 'Strategy Lab', subtitle: 'Build, template, and monitor multi-leg structures.' },
  '/journal': { title: 'Journal and Review', subtitle: 'Capture rationale, mistake tags, and playbook compliance.' },
  '/execution': { title: 'Execution Desk', subtitle: 'Preflight active legs before submitting to Breeze.' },
  '/portfolio': { title: 'Portfolio Cockpit', subtitle: 'Live positions, orders, trades, and funds.' },
  '/risk': { title: 'Risk Console', subtitle: 'Planned margin, exposure, and alert surface.' },
  '/automation': { title: 'Automation Center', subtitle: 'Rule-based actions and future GTT workflows.' },
  '/settings/connections': { title: 'Connection Center', subtitle: 'Broker session health, capability flags, and diagnostics.' },
};

export function WorkspaceHeader({
  currentPath,
  symbol,
  onSymbolChange,
  onOpenConnections,
  onRefresh,
  statusMessage,
  isLive,
  lastUpdate,
  liveIndices,
}: {
  currentPath: WorkspacePath;
  symbol: SymbolCode;
  onSymbolChange: (symbol: SymbolCode) => void;
  onOpenConnections: () => void;
  onRefresh: () => void;
  statusMessage: string;
  isLive: boolean;
  lastUpdate: Date;
  liveIndices: MarketIndex[];
}) {
  const title = TITLES[currentPath];

  return (
    <header className="border-b border-white/8 bg-[#0d1729]/90 px-6 py-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-orange-300/70">Workspace</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">{title.title}</h1>
          <p className="mt-1 text-sm text-slate-400">{title.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-2xl border border-white/8 bg-white/5 p-1">
            {ALL_SYMBOLS.map((candidate) => {
              const active = candidate === symbol;
              return (
                <button
                  key={candidate}
                  onClick={() => onSymbolChange(candidate)}
                  className={`rounded-xl px-3 py-2 text-left transition ${active ? 'bg-orange-500 text-white' : 'text-slate-300 hover:bg-white/6'}`}
                >
                  <div className="text-xs font-semibold">{SYMBOL_CONFIG[candidate].displayName}</div>
                  <div className="text-[10px] opacity-75">
                    {SYMBOL_CONFIG[candidate].exchange} · Lot {SYMBOL_CONFIG[candidate].lotSize}
                  </div>
                </button>
              );
            })}
          </div>

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
            {isLive ? 'Live Session' : 'Connect Broker'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1.5fr,1fr,1fr]">
        <div className="rounded-3xl border border-white/8 bg-[linear-gradient(135deg,rgba(249,115,22,0.16),rgba(12,18,31,0.25))] px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.25em] text-orange-200/80">Session Status</div>
          <div className="mt-2 text-sm text-white">{statusMessage}</div>
          <div className="mt-2 text-xs text-slate-400">Updated {lastUpdate.toLocaleTimeString('en-IN')}</div>
        </div>

        <div className="rounded-3xl border border-white/8 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
            <Bell size={12} />
            Market Tape
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {liveIndices.map((index) => (
              <div key={index.label} className="rounded-2xl bg-black/20 px-3 py-2">
                <div className="text-[10px] text-slate-400">{index.label}</div>
                <div className="mono text-sm text-white">{index.value.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/8 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
            <Command size={12} />
            Shortcuts
          </div>
          <div className="mt-2 text-sm text-slate-300">`Ctrl+K` opens the command palette. `Shift+C` jumps to connections.</div>
          <button
            onClick={onOpenConnections}
            className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-white/8 px-3 py-2 text-xs text-white transition hover:bg-white/12"
          >
            <Cable size={12} />
            Connection Center
          </button>
        </div>
      </div>
    </header>
  );
}
