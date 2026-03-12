import React from 'react';
import { Activity, Bot, Cable, ChartCandlestick, FolderKanban, ShieldAlert, Wallet } from 'lucide-react';
import { WORKSPACE_ROUTES, type WorkspacePath } from '../router';

const routeIcons: Record<WorkspacePath, React.ReactNode> = {
  '/market': <ChartCandlestick size={16} />,
  '/strategy': <FolderKanban size={16} />,
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
}: {
  currentPath: WorkspacePath;
  onNavigate: (path: WorkspacePath) => void;
  strategyLegCount: number;
}) {
  return (
    <aside className="flex w-[92px] flex-col border-r border-white/8 bg-[#08111f]/90 backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_top_left,#f97316,#ea580c_55%,#7c2d12)] shadow-[0_10px_35px_rgba(249,115,22,0.25)]">
          <Activity size={18} className="text-white" />
        </div>
        <div className="hidden xl:block">
          <div className="text-[10px] uppercase tracking-[0.35em] text-orange-300/80">Desk</div>
          <div className="text-sm font-semibold text-white">Sensibull Terminal</div>
        </div>
      </div>

      <nav className="flex-1 space-y-2 px-3 py-4">
        {WORKSPACE_ROUTES.map((route) => {
          const active = route.path === currentPath;
          return (
            <button
              key={route.path}
              onClick={() => onNavigate(route.path)}
              className={`group relative flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-3 text-[10px] font-semibold transition ${
                active
                  ? 'bg-orange-500 text-white shadow-[0_10px_25px_rgba(249,115,22,0.25)]'
                  : 'text-slate-400 hover:bg-white/6 hover:text-white'
              }`}
            >
              {routeIcons[route.path]}
              <span>{route.shortLabel}</span>
              {route.path === '/strategy' && strategyLegCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/80 px-1 text-[9px] text-orange-300">
                  {strategyLegCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
