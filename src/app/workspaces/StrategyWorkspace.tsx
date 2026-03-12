import React from 'react';
import { StrategyBuilder } from '../../components/StrategyBuilder';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';

export function StrategyWorkspace() {
  const { legs, appendLegs, updateLeg, removeLeg, executeStrategy, clearLegs } = useExecutionStore();
  const { chain, symbol, spotPrice } = useMarketStore();

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
        <div className="flex items-center justify-between border-t border-white/8 bg-[#09111f] px-5 py-3 text-sm">
          <div className="text-slate-300">{legs.length} legs staged for execution.</div>
          <button onClick={clearLegs} className="rounded-2xl border border-red-500/25 px-3 py-2 text-red-300 transition hover:bg-red-500/10">
            Clear strategy
          </button>
        </div>
      )}
    </div>
  );
}
