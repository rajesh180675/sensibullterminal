// components/OptionChain/components/ChainHeader.tsx

import React, { memo, useCallback } from 'react';
import type { SortState, SortableColumn } from '../types';
import { LABELS, TOOLTIPS } from '../constants';

interface ChainHeaderProps {
  ceCols: readonly string[];
  peCols: readonly string[];
  sortState: SortState;
  onToggleSort: (col: SortableColumn) => void;
}

export const ChainHeader = memo<ChainHeaderProps>(function ChainHeader({
  ceCols,
  peCols,
  sortState,
  onToggleSort,
}) {
  return (
    <thead className="sticky top-0 z-20">
      {/* Group headers */}
      <tr>
        <th
          colSpan={ceCols.length + 1}
          scope="colgroup"
          className="py-1 text-center bg-blue-950/60 border-b border-blue-900/30
                     text-blue-400 font-semibold text-[9px] tracking-widest"
        >
          ← CALLS (CE)
        </th>
        <th
          scope="col"
          style={{ minWidth: 90 }}
          className="py-1 text-center bg-[#0e1018] border-b border-gray-800/40
                     text-gray-600 font-semibold text-[9px] tracking-wide"
        >
          STRIKE
        </th>
        <th
          colSpan={peCols.length + 1}
          scope="colgroup"
          className="py-1 text-center bg-orange-950/60 border-b border-orange-900/30
                     text-orange-400 font-semibold text-[9px] tracking-widest"
        >
          PUTS (PE) →
        </th>
      </tr>

      {/* Column headers — SPEC-F1: clickable for sorting */}
      <tr className="bg-[#0e1018] border-b border-gray-800/50">
        <th scope="col" aria-label="Call actions"
            className="py-1 px-1.5 w-[52px] text-gray-700 text-[9px] font-medium">
          Act
        </th>

        {ceCols.map((c) => (
          <SortableHeader
            key={c}
            col={c}
            sortState={sortState}
            onToggleSort={onToggleSort}
            align="text-right"
          />
        ))}

        <SortableHeader
          col="strike"
          sortState={sortState}
          onToggleSort={onToggleSort}
          align="text-center"
          className="bg-[#080b12]/50 font-bold"
        />

        {peCols.map((c) => (
          <SortableHeader
            key={c}
            col={c}
            sortState={sortState}
            onToggleSort={onToggleSort}
            align="text-left"
          />
        ))}

        <th scope="col" aria-label="Put actions"
            className="py-1 px-1.5 w-[52px] text-gray-700 text-[9px] font-medium">
          Act
        </th>
      </tr>
    </thead>
  );
});

// ── Sortable Header Cell ───────────────────────────────────────

interface SortableHeaderProps {
  col: string;
  sortState: SortState;
  onToggleSort: (col: SortableColumn) => void;
  align: string;
  className?: string;
}

const SortableHeader = memo<SortableHeaderProps>(function SortableHeader({
  col,
  sortState,
  onToggleSort,
  align,
  className = '',
}) {
  const isActive = sortState.column === col;

  const handleClick = useCallback(() => {
    onToggleSort(col as SortableColumn);
  }, [col, onToggleSort]);

  const ariaSort = isActive
    ? sortState.direction === 'asc' ? 'ascending' as const : 'descending' as const
    : 'none' as const;

  return (
    <th
      scope="col"
      title={TOOLTIPS[col] ?? col}
      onClick={handleClick}
      aria-sort={ariaSort}
      className={`
        py-1 px-2 text-gray-600 font-medium text-[9px]
        ${align} whitespace-nowrap
        cursor-pointer hover:text-gray-400 select-none
        transition-colors
        ${isActive ? 'text-gray-300' : ''}
        ${className}
      `}
    >
      {LABELS[col] ?? col}
      {isActive && (
        <span className="ml-0.5 text-[7px] text-blue-400">
          {sortState.direction === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </th>
  );
});
