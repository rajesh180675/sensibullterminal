import React from 'react';

export function AutomationWorkspace() {
  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-2">
      <div className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Automation</div>
        <h2 className="mt-3 text-xl text-white">Workflow Staging Area</h2>
        <p className="mt-3 text-sm text-slate-400">
          GTT, alerts, and rule-driven execution are intentionally scaffolded for later phases.
        </p>
      </div>
      <div className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5 text-sm text-slate-400">
        The workspace route is wired now so these features can land without revisiting the shell architecture.
      </div>
    </div>
  );
}
