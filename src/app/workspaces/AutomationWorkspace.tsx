import { BellRing, Bot, Pencil, Play, PlusCircle, Radar, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AutomationRule } from '../../types/index';
import { useAutomationStore } from '../../domains/automation/automationStore';

type TriggerConfig = NonNullable<AutomationRule['triggerConfig']>;

function ensureTriggerConfig(rule: AutomationRule): TriggerConfig {
  return {
    type: rule.triggerConfig?.type ?? 'manual',
    referencePrice: rule.triggerConfig?.referencePrice ?? 0,
    lowerPrice: rule.triggerConfig?.lowerPrice ?? 0,
    upperPrice: rule.triggerConfig?.upperPrice ?? 0,
    thresholdPrice: rule.triggerConfig?.thresholdPrice ?? 0,
    movePercent: rule.triggerConfig?.movePercent ?? 0.5,
    direction: rule.triggerConfig?.direction ?? 'either',
    maxDrawdown: rule.triggerConfig?.maxDrawdown ?? -5000,
    profitTarget: rule.triggerConfig?.profitTarget ?? 5000,
    netQuantity: rule.triggerConfig?.netQuantity ?? 0,
  };
}

function cloneRule(rule: AutomationRule): AutomationRule {
  return {
    ...rule,
    triggerConfig: ensureTriggerConfig(rule),
    actionConfig: rule.actionConfig
      ? {
        ...rule.actionConfig,
        legs: rule.actionConfig.legs ? [...rule.actionConfig.legs] : undefined,
      }
      : { type: 'notify' },
  };
}

function formatTriggerLabel(rule: AutomationRule) {
  const trigger = rule.triggerConfig;
  if (!trigger) return rule.trigger;
  switch (trigger.type) {
    case 'spot_cross_above':
      return `Spot crosses above ${trigger.thresholdPrice ?? 0}`;
    case 'spot_cross_below':
      return `Spot crosses below ${trigger.thresholdPrice ?? 0}`;
    case 'spot_pct_move':
      return `Spot moves ${trigger.movePercent ?? 0}% ${trigger.direction ?? 'either'} from ${trigger.referencePrice ?? 0}`;
    case 'mtm_drawdown':
      return `Live MTM drawdown <= ${trigger.maxDrawdown ?? 0}`;
    case 'mtm_profit_target':
      return `Live MTM profit >= ${trigger.profitTarget ?? 0}`;
    case 'position_net_quantity_below':
      return `Net quantity <= ${trigger.netQuantity ?? 0}`;
    case 'position_net_quantity_above':
      return `Net quantity >= ${trigger.netQuantity ?? 0}`;
    case 'spot_range_break':
      return `Spot leaves ${trigger.lowerPrice ?? 0} - ${trigger.upperPrice ?? 0}`;
    default:
      return rule.trigger;
  }
}

function numberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AutomationWorkspace() {
  const { rules, callbacks, syncStatus, createRuleFromStrategy, saveRule, deleteRule, toggleRuleStatus, evaluateRules } = useAutomationStore();
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [draftRule, setDraftRule] = useState<AutomationRule | null>(null);

  const activeRules = useMemo(() => rules.filter((rule) => rule.status === 'active').length, [rules]);
  const draftRules = useMemo(() => rules.filter((rule) => rule.status === 'draft').length, [rules]);
  const pausedRules = useMemo(() => rules.filter((rule) => rule.status === 'paused').length, [rules]);

  const startEditing = (rule: AutomationRule) => {
    setEditingRuleId(rule.id);
    setDraftRule(cloneRule(rule));
  };

  const cancelEditing = () => {
    setEditingRuleId(null);
    setDraftRule(null);
  };

  const saveEditing = async () => {
    if (!draftRule) return;
    await saveRule({ ...draftRule, trigger: formatTriggerLabel(draftRule) });
    cancelEditing();
  };

  const updateDraft = (patch: Partial<AutomationRule>) => {
    setDraftRule((current) => current ? { ...current, ...patch, updatedAt: Date.now() } : current);
  };

  const updateTrigger = (patch: TriggerConfig) => {
    setDraftRule((current) => {
      if (!current) return current;
      return {
        ...current,
        triggerConfig: patch,
        trigger: formatTriggerLabel({ ...current, triggerConfig: patch }),
        updatedAt: Date.now(),
      };
    });
  };

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[0.85fr,1.15fr]">
      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <Bot size={13} />
          Rule Center
        </div>
        <h2 className="mt-3 text-xl text-white">Automation workflows</h2>
        <p className="mt-3 text-sm text-slate-400">
          Persist, edit, and evaluate broker-backed GTT, alert, hedge, and rebalance rules with live spot and MTM triggers.
        </p>
        <button
          onClick={() => void createRuleFromStrategy()}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-400"
        >
          <PlusCircle size={14} />
          Create From Strategy
        </button>
        <button
          onClick={() => void evaluateRules()}
          className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/10"
        >
          <Radar size={14} />
          Evaluate Now
        </button>

        <div className="mt-5 grid gap-3">
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Coverage</div>
            <div className="mt-2 text-white">{activeRules} active rules</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Draft queue</div>
            <div className="mt-2 text-white">{draftRules} drafts awaiting review</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Paused</div>
            <div className="mt-2 text-white">{pausedRules} rules paused</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Backend sync</div>
            <div className="mt-2 text-white">{syncStatus === 'ready' ? 'Live backend' : syncStatus === 'loading' ? 'Refreshing' : 'Local fallback'}</div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <BellRing size={13} />
          GTT and Alerts
        </div>
        <div className="mt-4 space-y-3">
          {rules.map((rule) => {
            const isEditing = editingRuleId === rule.id && draftRule;
            const editor = isEditing ? draftRule : null;
            const triggerConfig = editor ? ensureTriggerConfig(editor) : null;
            return (
              <div key={rule.id} className="rounded-3xl border border-white/8 bg-white/5 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-white">{isEditing ? editor?.name : rule.name}</div>
                    <div className="mt-1 text-sm text-slate-400">{rule.kind.toUpperCase()} · {rule.scope}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void toggleRuleStatus(rule.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                    >
                      <Play size={12} />
                      {rule.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                    <button
                      onClick={() => isEditing ? cancelEditing() : startEditing(rule)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                    >
                      <Pencil size={12} />
                      {isEditing ? 'Cancel' : 'Edit'}
                    </button>
                    <button
                      onClick={() => void deleteRule(rule.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-red-400/20 px-3 py-2 text-xs text-red-200 transition hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                </div>

                {isEditing && editor ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Name</div>
                      <input
                        value={editor.name}
                        onChange={(event) => updateDraft({ name: event.target.value })}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                      />
                    </label>
                    <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Notes</div>
                      <input
                        value={editor.notes ?? ''}
                        onChange={(event) => updateDraft({ notes: event.target.value })}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                      />
                    </label>
                    <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Trigger Type</div>
                      <select
                        value={editor.triggerConfig?.type ?? 'manual'}
                        onChange={(event) => {
                          const nextType = event.target.value as TriggerConfig['type'];
                          updateTrigger({
                            type: nextType,
                            referencePrice: triggerConfig?.referencePrice ?? 0,
                            lowerPrice: triggerConfig?.lowerPrice ?? 0,
                            upperPrice: triggerConfig?.upperPrice ?? 0,
                            thresholdPrice: triggerConfig?.thresholdPrice ?? 0,
                            movePercent: triggerConfig?.movePercent ?? 0.5,
                            direction: triggerConfig?.direction ?? 'either',
                            maxDrawdown: triggerConfig?.maxDrawdown ?? -5000,
                            profitTarget: triggerConfig?.profitTarget ?? 5000,
                            netQuantity: triggerConfig?.netQuantity ?? 0,
                          });
                        }}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                      >
                        <option value="manual">Manual</option>
                        <option value="spot_range_break">Spot range break</option>
                        <option value="spot_cross_above">Spot cross above</option>
                        <option value="spot_cross_below">Spot cross below</option>
                        <option value="spot_pct_move">Spot % move</option>
                        <option value="mtm_drawdown">MTM drawdown</option>
                        <option value="mtm_profit_target">MTM profit target</option>
                        <option value="position_net_quantity_below">Net quantity below</option>
                        <option value="position_net_quantity_above">Net quantity above</option>
                      </select>
                    </label>
                    <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Action Summary</div>
                      <input
                        value={editor.action}
                        onChange={(event) => updateDraft({ action: event.target.value })}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                      />
                    </label>

                    {triggerConfig?.type === 'spot_range_break' && (
                      <>
                        <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Lower Price</div>
                          <input
                            type="number"
                            value={triggerConfig.lowerPrice ?? 0}
                            onChange={(event) => updateTrigger({ ...triggerConfig, lowerPrice: numberOrZero(event.target.value) })}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                          />
                        </label>
                        <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Upper Price</div>
                          <input
                            type="number"
                            value={triggerConfig.upperPrice ?? 0}
                            onChange={(event) => updateTrigger({ ...triggerConfig, upperPrice: numberOrZero(event.target.value) })}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                          />
                        </label>
                      </>
                    )}

                    {(triggerConfig?.type === 'spot_cross_above' || triggerConfig?.type === 'spot_cross_below') && (
                      <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300 md:col-span-2">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Threshold Price</div>
                        <input
                          type="number"
                          value={triggerConfig.thresholdPrice ?? 0}
                          onChange={(event) => updateTrigger({ ...triggerConfig, thresholdPrice: numberOrZero(event.target.value) })}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                        />
                      </label>
                    )}

                    {triggerConfig?.type === 'spot_pct_move' && (
                      <>
                        <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Reference Price</div>
                          <input
                            type="number"
                            value={triggerConfig.referencePrice ?? 0}
                            onChange={(event) => updateTrigger({ ...triggerConfig, referencePrice: numberOrZero(event.target.value) })}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                          />
                        </label>
                        <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Move Percent</div>
                          <input
                            type="number"
                            step="0.1"
                            value={triggerConfig.movePercent ?? 0}
                            onChange={(event) => updateTrigger({ ...triggerConfig, movePercent: numberOrZero(event.target.value) })}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                          />
                        </label>
                        <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300 md:col-span-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Direction</div>
                          <select
                            value={triggerConfig.direction ?? 'either'}
                            onChange={(event) => updateTrigger({ ...triggerConfig, direction: event.target.value as 'up' | 'down' | 'either' })}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                          >
                            <option value="either">Either</option>
                            <option value="up">Up</option>
                            <option value="down">Down</option>
                          </select>
                        </label>
                      </>
                    )}

                    {(triggerConfig?.type === 'mtm_drawdown' || triggerConfig?.type === 'mtm_profit_target') && (
                      <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300 md:col-span-2">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          {triggerConfig.type === 'mtm_drawdown' ? 'Max Drawdown' : 'Profit Target'}
                        </div>
                        <input
                          type="number"
                          value={triggerConfig.type === 'mtm_drawdown' ? triggerConfig.maxDrawdown ?? 0 : triggerConfig.profitTarget ?? 0}
                          onChange={(event) => updateTrigger({
                            ...triggerConfig,
                            maxDrawdown: triggerConfig.type === 'mtm_drawdown' ? numberOrZero(event.target.value) : triggerConfig.maxDrawdown,
                            profitTarget: triggerConfig.type === 'mtm_profit_target' ? numberOrZero(event.target.value) : triggerConfig.profitTarget,
                          })}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                        />
                      </label>
                    )}

                    {(triggerConfig?.type === 'position_net_quantity_below' || triggerConfig?.type === 'position_net_quantity_above') && (
                      <label className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300 md:col-span-2">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Net Quantity Threshold</div>
                        <input
                          type="number"
                          value={triggerConfig.netQuantity ?? 0}
                          onChange={(event) => updateTrigger({ ...triggerConfig, netQuantity: numberOrZero(event.target.value) })}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#08101d] px-3 py-2 text-white outline-none"
                        />
                      </label>
                    )}

                    <div className="md:col-span-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => void saveEditing()}
                        className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
                      >
                        <Save size={14} />
                        Save Rule
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/10"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl bg-black/15 px-3 py-3 text-sm text-slate-300">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Trigger</div>
                        <div className="mt-2">{formatTriggerLabel(rule)}</div>
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
                      <span>Runs: {rule.runCount ?? 0}</span>
                    </div>
                    {rule.notes && <div className="mt-3 text-xs text-slate-500">{rule.notes}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Callback log</div>
          <div className="mt-3 space-y-3">
            {callbacks.length === 0 && (
              <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-400">
                No backend callback events recorded yet.
              </div>
            )}
            {callbacks.slice(0, 8).map((event) => (
              <div key={event.id} className="rounded-3xl border border-white/8 bg-black/15 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{event.ruleName}</div>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{event.eventType}</span>
                </div>
                <div className="mt-2 text-sm text-slate-300">{event.message}</div>
                <div className="mt-2 text-xs text-slate-500">
                  {new Date(event.timestamp).toLocaleString()} · {event.status}
                  {event.brokerResults && event.brokerResults.length > 0 ? ` · ${event.brokerResults.filter((item) => item.success).length}/${event.brokerResults.length} legs successful` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
