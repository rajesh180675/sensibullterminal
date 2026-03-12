import { BellRing, Bot, Pause, Play, PlusCircle } from 'lucide-react';
import { useAutomationStore } from '../../domains/automation/automationStore';

export function AutomationWorkspace() {
  const { rules, createRuleFromStrategy, toggleRuleStatus } = useAutomationStore();

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[0.8fr,1.2fr]">
      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <Bot size={13} />
          Rule Center
        </div>
        <h2 className="mt-3 text-xl text-white">Automation workflows</h2>
        <p className="mt-3 text-sm text-slate-400">
          Draft GTT, alert, hedge, and rebalance workflows from the current staged strategy.
        </p>
        <button
          onClick={createRuleFromStrategy}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-400"
        >
          <PlusCircle size={14} />
          Create From Strategy
        </button>

        <div className="mt-5 grid gap-3">
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Coverage</div>
            <div className="mt-2 text-white">{rules.filter((rule) => rule.status === 'active').length} active rules</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Draft queue</div>
            <div className="mt-2 text-white">{rules.filter((rule) => rule.status === 'draft').length} drafts awaiting review</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Paused</div>
            <div className="mt-2 text-white">{rules.filter((rule) => rule.status === 'paused').length} rules paused</div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <BellRing size={13} />
          GTT and Alerts
        </div>
        <div className="mt-4 space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-3xl border border-white/8 bg-white/5 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{rule.name}</div>
                  <div className="mt-1 text-sm text-slate-400">{rule.kind.toUpperCase()} · {rule.scope}</div>
                </div>
                <button
                  onClick={() => toggleRuleStatus(rule.id)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                >
                  {rule.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                  {rule.status === 'active' ? 'Pause' : 'Activate'}
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Trigger</div>
                  <div className="mt-2">{rule.trigger}</div>
                </div>
                <div className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Action</div>
                  <div className="mt-2">{rule.action}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                <span>Status: {rule.status}</span>
                <span>Last run: {rule.lastRun}</span>
                <span>Next: {rule.nextRun}</span>
              </div>
              {rule.notes && <div className="mt-3 text-xs text-slate-500">{rule.notes}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
