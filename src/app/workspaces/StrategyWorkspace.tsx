import { BellPlus, BookOpenText, Shield, Slash, Zap } from 'lucide-react';
import { StrategyBuilder } from '../../components/StrategyBuilder';
import { useAutomationStore } from '../../domains/automation/automationStore';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useJournalStore } from '../../domains/journal/journalStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useRiskStore } from '../../domains/risk/riskStore';
import { useSellerIntelligenceStore } from '../../domains/seller/sellerIntelligenceStore';
import { fmtPnL } from '../../utils/math';

export function StrategyWorkspace() {
  const { legs, activeBasket, appendLegs, updateLeg, removeLeg, executeStrategy, clearLegs, preview, stageStrategy } = useExecutionStore();
  const { chain, symbol, spotPrice } = useMarketStore();
  const { snapshot } = useRiskStore();
  const { createRuleFromStrategy, createRuleFromOpportunity } = useAutomationStore();
  const { attachAutomationRule, captureOpportunity } = useJournalStore();
  const { regime, opportunities, suppressedOpportunities, playbooks, exposure } = useSellerIntelligenceStore();

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[0.95fr,1.45fr]">
      <div className="grid min-h-0 gap-4">
        <section id="strategy-regime" className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Seller Regime</div>
              <h2 className="mt-3 text-xl text-white">{regime.label}</h2>
            </div>
            <div className="rounded-2xl bg-white/5 px-3 py-2 text-right text-xs text-slate-300">
              <div>Suitability {regime.sellerSuitability}/100</div>
              <div>Confidence {regime.confidence}%</div>
            </div>
          </div>
          <div className="mt-4 text-sm text-slate-300">{regime.summary}</div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {regime.preferredStructures.map((item) => (
              <span key={item} className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-200">{item}</span>
            ))}
            {regime.restrictedStructures.map((item) => (
              <span key={item} className="rounded-full bg-red-500/15 px-3 py-1 text-red-200">{item}</span>
            ))}
          </div>
          {regime.warnings.length > 0 && (
            <div className="mt-4 space-y-2">
              {regime.warnings.map((warning) => (
                <div key={warning} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {warning}
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="strategy-ideas" className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Portfolio Overlay</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl bg-white/5 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Live exposure</div>
              <div className="mt-2 text-sm text-white">
                {exposure.activeShortPutLots} short put lots · {exposure.activeShortCallLots} short call lots
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Delta bias {exposure.dominantBias} · margin {Math.round(exposure.marginUtilization * 100)}%
              </div>
            </div>
            <div className="rounded-3xl bg-white/5 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Pressure flags</div>
              <div className="mt-2 text-sm text-white">{exposure.pressureFlags[0] ?? 'No material portfolio pressure detected.'}</div>
              <div className="mt-1 text-xs text-slate-400">Unhedged exposure {Math.round(exposure.unhedgedExposurePct * 100)}%</div>
            </div>
          </div>
        </section>

        <section id="strategy-playbooks" className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Opportunity Feed</div>
          <div className="mt-4 space-y-3">
            {opportunities.map((idea) => (
              <div key={idea.id} className="rounded-3xl border border-white/8 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-white">{idea.title}</div>
                    <div className="mt-1 text-xs text-slate-400">{idea.structure} · {idea.mode.split('_').join(' ')}</div>
                  </div>
                  <div className="rounded-2xl bg-black/20 px-3 py-2 text-right text-xs text-slate-200">
                    <div>Seller {idea.sellerScore}</div>
                    <div>Fit {idea.regimeFit}</div>
                    <div>Exposure {idea.exposureFit}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-slate-300">{idea.thesis}</div>
                <div className="mt-2 text-xs text-slate-400">{idea.whyNow}</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-2xl bg-[#0f1728] px-3 py-2 text-xs text-slate-300">Credit {fmtPnL(idea.expectedCredit)}</div>
                  <div className="rounded-2xl bg-[#0f1728] px-3 py-2 text-xs text-slate-300">Margin {fmtPnL(-idea.marginEstimate)}</div>
                  <div className="rounded-2xl bg-[#0f1728] px-3 py-2 text-xs text-slate-300">Max loss {fmtPnL(idea.maxLossEstimate)}</div>
                  <div className="rounded-2xl bg-[#0f1728] px-3 py-2 text-xs text-slate-300">Theta/margin {idea.thetaPerMargin.toFixed(2)}</div>
                  <div className="rounded-2xl bg-[#0f1728] px-3 py-2 text-xs text-slate-300">Liquidity {idea.liquidityScore}/100</div>
                  <div className="rounded-2xl bg-[#0f1728] px-3 py-2 text-xs text-slate-300">Tail risk {idea.tailRiskScore}/100</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {idea.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">{tag}</span>
                  ))}
                  {idea.playbookMatches.map((match) => (
                    <span key={match} className="rounded-full bg-orange-500/15 px-3 py-1 text-orange-200">{match}</span>
                  ))}
                  <span className={`rounded-full px-3 py-1 ${idea.playbookCompliance === 'aligned' ? 'bg-emerald-500/15 text-emerald-200' : idea.playbookCompliance === 'violates' ? 'bg-red-500/15 text-red-200' : 'bg-amber-500/15 text-amber-200'}`}>
                    {idea.playbookCompliance}
                  </span>
                </div>
                {idea.warnings.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    {idea.warnings.join(' | ')}
                  </div>
                )}
                <div className="mt-3 text-xs text-slate-400">Invalidation: {idea.invalidation}</div>
                <div className="mt-1 text-xs text-slate-400">Adjustment: {idea.adjustmentPlan}</div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {idea.automationPresets.map((preset) => (
                    <span key={preset.id} className="rounded-full border border-cyan-400/15 bg-cyan-400/10 px-3 py-1 text-cyan-100">
                      {preset.label}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => stageStrategy(idea.legs)}
                    className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-400"
                  >
                    Stage idea
                  </button>
                  <button
                    onClick={() => captureOpportunity(idea)}
                    className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/10"
                  >
                    <span className="inline-flex items-center gap-2"><BookOpenText size={14} /> Journal</span>
                  </button>
                  <button
                    onClick={() => {
                      void (async () => {
                        const entry = captureOpportunity(idea);
                        const rule = await createRuleFromOpportunity(idea);
                        if (entry && rule) {
                          attachAutomationRule(entry.id, rule.id);
                        }
                      })();
                    }}
                    className="rounded-2xl border border-cyan-400/20 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/10"
                  >
                    <span className="inline-flex items-center gap-2"><BellPlus size={14} /> Automation</span>
                  </button>
                  <div className="rounded-2xl border border-white/10 px-4 py-2 text-xs text-slate-300">
                    Breakevens {idea.breakevens.length > 0 ? idea.breakevens.join(', ') : 'None'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {suppressedOpportunities.length > 0 && (
          <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
              <Slash size={13} />
              Suppressed Ideas
            </div>
            <div className="mt-4 space-y-3">
              {suppressedOpportunities.map((idea) => (
                <div key={idea.id} className="rounded-3xl border border-red-500/15 bg-red-500/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{idea.title}</div>
                      <div className="mt-1 text-xs text-slate-400">{idea.structure} · exposure fit {idea.exposureFit}</div>
                    </div>
                    <div className="text-xs text-red-200">suppressed</div>
                  </div>
                  <div className="mt-3 text-xs text-red-100">{idea.suppressionReasons.join(' | ')}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Playbooks</div>
          <div className="mt-4 grid gap-3">
            {playbooks.map((playbook) => (
              <div key={playbook.id} className="rounded-3xl border border-white/8 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{playbook.name}</div>
                  <div className="text-xs text-slate-400">Risk budget {playbook.riskBudgetPct}%</div>
                </div>
                <div className="mt-2 text-sm text-slate-300">{playbook.description}</div>
                <div className="mt-2 text-xs text-slate-400">
                  Regimes: {playbook.targetRegimes.join(', ')} · Structures: {playbook.allowedStructures.join(', ')}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  No-trade: {playbook.noTradeConditions.join(' | ')}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div id="strategy-builder" className="min-h-0 overflow-hidden rounded-[28px] border border-white/8 bg-[#09111f]">
        <div className="h-[calc(100%-86px)] overflow-hidden">
          <StrategyBuilder
            legs={legs}
            onAppendLegs={appendLegs}
            onUpdateLeg={updateLeg}
            onRemoveLeg={removeLeg}
            onExecute={executeStrategy}
            spotPrice={spotPrice}
            symbol={symbol}
            chain={chain}
          />
        </div>

        {legs.length > 0 && (
          <div className="grid gap-3 border-t border-white/8 bg-[#09111f] px-5 py-3 text-sm xl:grid-cols-[1.2fr,1fr,1fr,auto,auto]">
            <div className="flex items-center text-slate-300">{legs.length} legs staged for execution.</div>
            <div className="rounded-2xl bg-white/5 px-3 py-2 text-slate-300">
              <span className="inline-flex items-center gap-2 text-white"><Zap size={14} /> Basket {activeBasket?.status ?? 'staged'}</span>
            </div>
            <div className="rounded-2xl bg-white/5 px-3 py-2 text-slate-300">
              <span className="inline-flex items-center gap-2 text-white"><Zap size={14} /> Margin {fmtPnL(-preview.marginRequired)}</span>
            </div>
            <div className="rounded-2xl bg-white/5 px-3 py-2 text-slate-300">
              <span className="inline-flex items-center gap-2 text-white"><Shield size={14} /> Headroom {fmtPnL(snapshot.marginHeadroom)}</span>
            </div>
            <button
              onClick={createRuleFromStrategy}
              className="rounded-2xl border border-white/10 px-3 py-2 text-white transition hover:bg-white/10"
            >
              <span className="inline-flex items-center gap-2"><BellPlus size={14} /> Draft Automation</span>
            </button>
            <button onClick={clearLegs} className="rounded-2xl border border-red-500/25 px-3 py-2 text-red-300 transition hover:bg-red-500/10">
              Clear strategy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
