// components/OptionChain/components/ActionButtons.tsx

import React, { memo } from 'react';

interface ActionButtonsProps {
  visible: boolean;
  onBuy: () => void;
  onSell: () => void;
  side: 'CE' | 'PE';
  strike: number;
}

export const ActionButtons = memo<ActionButtonsProps>(
  function ActionButtons({ visible, onBuy, onSell, side, strike }) {
    return (
      <td className="px-1 py-[2px] text-center" role="gridcell">
        <div
          className={`
            flex gap-0.5 justify-center transition-opacity duration-150
            ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}
          `}
        >
          <button
            onClick={onBuy}
            aria-label={`Buy ${side} ${strike}`}
            tabIndex={visible ? 0 : -1}
            className="
              px-1.5 py-0.5
              bg-emerald-600/20 hover:bg-emerald-500/40
              text-emerald-400 text-[8px]
              rounded font-bold
              border border-emerald-600/25 leading-none
              focus-visible:outline focus-visible:outline-2
              focus-visible:outline-emerald-400
            "
          >
            B
          </button>
          <button
            onClick={onSell}
            aria-label={`Sell ${side} ${strike}`}
            tabIndex={visible ? 0 : -1}
            className="
              px-1.5 py-0.5
              bg-red-600/20 hover:bg-red-500/40
              text-red-400 text-[8px]
              rounded font-bold
              border border-red-600/25 leading-none
              focus-visible:outline focus-visible:outline-2
              focus-visible:outline-red-400
            "
          >
            S
          </button>
        </div>
      </td>
    );
  },
);
