import React from 'react';
import {
  Activity,
  BookOpenText,
  Bot,
  Cable,
  ChartCandlestick,
  FolderKanban,
  Radar,
  ShieldAlert,
  Wifi,
  WifiOff,
  Wallet,
} from 'lucide-react';
import { WORKSPACE_GROUPS, type WorkspacePath } from '../router';

const routeIcons: Record<WorkspacePath, React.ReactNode> = {
  '/market': <ChartCandlestick size={16} />,
  '/strategy': <FolderKanban size={16} />,
  '/journal': <BookOpenText size={16} />,
  '/execution': <Activity size={16} />,
  '/portfolio': <Wallet size={16} />,
  '/risk': <ShieldAlert size={16} />,
  '/automation': <Bot size={16} />,
  '/settings/connections': <Cable size={16} />,
};

export function WorkspaceNav({
  currentPath,
  onNavigate,
  strategyLegCount,
  isLive,
  statusMessage,
  onOpenConnections,
}: {
  currentPath: WorkspacePath;
  onNavigate: (path: WorkspacePath) => void;
  strategyLegCount: number;
  isLive: boolean;
  statusMessage: string;
  onOpenConnections: () => void;
}) {
  return (
    <aside className="hidden w-[280px] flex-col rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,20,33,0.96),rgba(5,10,18,0.94))] shadow-[0_24px_80px_rgba(0,0,0,0.45)] lg:flex">
      <div className="border-b border-white/8 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_top_left,#f97316,#ea580c_55%,#7c2d12)] shadow-[0_10px_35px_rgba(249,115,22,0.25)]">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.35em] text-orange-300/80">Seller Desk</div>
            <div className="mt-1 text-base font-semibold text-white">Sensibull Terminal</div>
            <div className="mt-1 text-xs text-slate-400">Structured workflow for options sellers</div>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          <button
            onClick={onOpenConnections}
            className={`flex items-center justify-between rounded-2xl border px-3 py-3 text-left transition ${
              isLive
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15'
            }`}
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              {isLive ? <Wifi size={14} /> : <WifiOff size={14} />}
              {isLive ? 'Broker connected' : 'Broker disconnected'}
            </span>
            <Cable size={14} />
          </button>
          <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3 text-xs text-slate-300">
            {statusMessage}
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-5">
          {WORKSPACE_GROUPS.map((group) => (
            <div key={group.group}>
              <div className="px-2 text-[10px] uppercase tracking-[0.32em] text-slate-500">{group.group}</div>
              <div className="mt-2 space-y-2">
                {group.routes.map((route) => {
                  const active = route.path === currentPath;
                  return (
                    <button
                      key={route.path}
                      onClick={() => onNavigate(route.path)}
                      className={`group relative flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                        active
                          ? 'border-orange-400/35 bg-orange-500/12 text-white shadow-[0_16px_36px_rgba(249,115,22,0.18)]'
                          : 'border-transparent bg-transparent text-slate-300 hover:border-white/8 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                          active ? 'bg-orange-500 text-white' : 'bg-white/5 text-slate-300'
                        }`}
                      >
                        {routeIcons[route.path]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{route.label}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">{route.shortLabel}</span>
                      </span>
                      {route.path === '/strategy' && strategyLegCount > 0 && (
                        <span className="rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-orange-300">
                          {strategyLegCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-white/8 px-4 py-4">
        <div className="rounded-[24px] border border-white/8 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.26em] text-slate-500">
            <Radar size={12} />
            Desk State
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-2xl bg-black/20 px-3 py-3">
              <div className="text-slate-500">Staged legs</div>
              <div className="mt-1 text-lg font-semibold text-white">{strategyLegCount}</div>
            </div>
            <div className="rounded-2xl bg-black/20 px-3 py-3">
              <div className="text-slate-500">Mode</div>
              <div className="mt-1 text-sm font-semibold text-white">{isLive ? 'Live' : 'Preview'}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
