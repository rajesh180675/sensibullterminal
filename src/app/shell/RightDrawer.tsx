import { Activity, Cable, Radar, ShieldCheck } from 'lucide-react';
import { useSessionStore } from '../../domains/session/sessionStore';

const toneClass = {
  connected: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  connecting: 'text-amber-200 bg-amber-500/10 border-amber-500/20',
  reconnecting: 'text-amber-200 bg-amber-500/10 border-amber-500/20',
  error: 'text-red-200 bg-red-500/10 border-red-500/20',
  disconnected: 'text-slate-300 bg-white/5 border-white/10',
} as const;

export function RightDrawer() {
  const { session, health, capabilities } = useSessionStore();

  return (
    <aside className="hidden w-[320px] flex-col border-l border-white/8 bg-[#09111f]/95 p-4 xl:flex">
      <div className="rounded-3xl border border-white/8 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
          <ShieldCheck size={13} />
          Broker Health
        </div>
        <div className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${toneClass[health.streamStatus]}`}>
          Stream {health.streamStatus}
        </div>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          <div className="flex items-center justify-between">
            <span>Backend reachable</span>
            <span>{health.backendReachable ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Broker connected</span>
            <span>{health.backendConnected ? 'Yes' : 'No'}</span>
          </div>
          <div className="rounded-2xl bg-black/20 px-3 py-2 text-xs text-slate-400">{health.backendMessage}</div>
        </div>
      </div>

      <div className="mt-4 rounded-3xl border border-white/8 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
          <Radar size={13} />
          Capability Registry
        </div>
        <div className="mt-3 grid gap-2 text-sm text-slate-300">
          <div className="rounded-2xl bg-black/20 px-3 py-2">Backend-primary: {capabilities.backendPrimary ? 'Enabled' : 'Fallback'}</div>
          <div className="rounded-2xl bg-black/20 px-3 py-2">Streaming: {capabilities.streaming ? 'Enabled' : 'Unavailable'}</div>
          <div className="rounded-2xl bg-black/20 px-3 py-2">Positions: {capabilities.positions ? 'Enabled' : 'Unavailable'}</div>
          <div className="rounded-2xl bg-black/20 px-3 py-2">Diagnostics: {capabilities.diagnostics ? 'Enabled' : 'Hidden'}</div>
        </div>
      </div>

      <div className="mt-4 rounded-3xl border border-white/8 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
          <Cable size={13} />
          Session
        </div>
        <div className="mt-3 text-sm text-slate-300">
          <div className="rounded-2xl bg-black/20 px-3 py-2">{session?.proxyBase || 'No active broker session'}</div>
          <div className="mt-2 rounded-2xl bg-black/20 px-3 py-2">Connected at: {session?.connectedAt?.toLocaleString('en-IN') || 'N/A'}</div>
        </div>
      </div>

      <div className="mt-4 rounded-3xl border border-white/8 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
          <Activity size={13} />
          Notes
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Risk, automation, and richer execution details remain scaffolded surfaces. The core broker/session/market stack is now centralized.
        </p>
      </div>
    </aside>
  );
}
