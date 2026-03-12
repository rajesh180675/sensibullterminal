import React from 'react';
import { BellPlus, Shield, Zap } from 'lucide-react';
import { StrategyBuilder } from '../../components/StrategyBuilder';
import { useAutomationStore } from '../../domains/automation/automationStore';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useRiskStore } from '../../domains/risk/riskStore';
import { fmtPnL } from '../../utils/math';

export function StrategyWorkspace() {
  const { legs, appendLegs, updateLeg, removeLeg, executeStrategy, clearLegs, preview } = useExecutionStore();
  const { chain, symbol, spotPrice } = useMarketStore();
  const { snapshot } = useRiskStore();
  const { createRuleFromStrategy } = useAutomationStore();

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
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
  );
}
