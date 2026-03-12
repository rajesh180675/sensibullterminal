import React from 'react';

export function RiskWorkspace() {
  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-3">
      <div className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5 text-slate-300">
        <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Planned</div>
        <h2 className="mt-3 text-xl text-white">Risk Dashboard Scaffold</h2>
        <p className="mt-3 text-sm">Margin calculators, exposure ladders, and alert rules belong here in the next phase.</p>
      </div>
      <div className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5 text-sm text-slate-400">
        Pre-trade margin and preview APIs are not integrated yet.
      </div>
      <div className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5 text-sm text-slate-400">
        This route exists so the app shell no longer depends on legacy top-level tabs.
      </div>
    </div>
  );
}
