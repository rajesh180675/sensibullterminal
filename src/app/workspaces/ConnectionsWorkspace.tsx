import React from 'react';
import { Cable, ShieldCheck } from 'lucide-react';
import { useSessionStore } from '../../domains/session/sessionStore';

export function ConnectionsWorkspace({ onOpenConnections }: { onOpenConnections: () => void }) {
  const { session, capabilities, health, openConnectionCenter } = useSessionStore();

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[1.1fr,0.9fr]">
      <div className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <Cable size={13} />
          Connection Center
        </div>
        <div className="mt-4 rounded-3xl bg-white/5 p-4 text-sm text-slate-300">
          <div>Proxy: {session?.proxyBase || 'No active broker session'}</div>
          <div className="mt-2">Status: {health.backendMessage}</div>
        </div>
        <button
          onClick={() => {
            openConnectionCenter();
            onOpenConnections();
          }}
          className="mt-4 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-400"
        >
          Open modal
        </button>
      </div>

      <div className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <ShieldCheck size={13} />
          Capability Flags
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-300">
          <div className="rounded-3xl bg-white/5 px-4 py-3">Backend primary: {capabilities.backendPrimary ? 'Yes' : 'No'}</div>
          <div className="rounded-3xl bg-white/5 px-4 py-3">Streaming: {capabilities.streaming ? 'Yes' : 'No'}</div>
          <div className="rounded-3xl bg-white/5 px-4 py-3">Positions: {capabilities.positions ? 'Yes' : 'No'}</div>
          <div className="rounded-3xl bg-white/5 px-4 py-3">Diagnostics: {capabilities.diagnostics ? 'Enabled' : 'Hidden'}</div>
        </div>
      </div>
    </div>
  );
}
