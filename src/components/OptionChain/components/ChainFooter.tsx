// components/OptionChain/components/ChainFooter.tsx

import React, { memo } from 'react';

interface ChainFooterProps {
  rowCount: number;
  totalCount: number;
  stockCode: string;
  exchangeCode: string;
  expiryVal: string;
}

export const ChainFooter = memo<ChainFooterProps>(function ChainFooter({
  rowCount, totalCount, stockCode, exchangeCode, expiryVal,
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 border-t border-gray-800/50
                    bg-[#0e1018] text-[9px] text-gray-700 flex-shrink-0" role="contentinfo">
      <span>
        Hover row →{' '}
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-emerald-500 font-bold text-[8px]">B</kbd>=Buy{' '}
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-red-500 font-bold text-[8px]">S</kbd>=Sell
        {' '}· DblClick=Buy CE · Focus +{' '}
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-[8px]">B</kbd>/
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-[8px]">S</kbd> CE,{' '}
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-[8px]">⇧B</kbd>/
        <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400 text-[8px]">⇧S</kbd> PE
      </span>
      <span className="ml-auto">
        {rowCount === totalCount ? `${rowCount} strikes` : `${rowCount} of ${totalCount} strikes`}
        {' '}· {stockCode}/{exchangeCode} · {expiryVal}
      </span>
    </div>
  );
});
