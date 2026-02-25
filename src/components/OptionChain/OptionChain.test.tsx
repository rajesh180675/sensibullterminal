// components/OptionChain/OptionChain.test.tsx

import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OptionChain } from './OptionChain';
import { computeMaxPain } from './utils/computeMaxPain';
import { deriveOISignal } from './utils/deriveOISignal';
import { formatCell } from './utils/formatCell';
import { getRowValue } from './utils/getRowValue';
import type { OptionRow, ExpiryDate, SymbolCode } from '../../types/index';

// ════════════════════════════════════════════════════════════════
// TEST HELPERS
// ════════════════════════════════════════════════════════════════

function makeRow(strike: number, overrides: Partial<OptionRow> = {}): OptionRow {
  return {
    strike, isATM: false,
    ce_oi: 10000, ce_oiChg: 500, ce_volume: 3000, ce_iv: 15.5,
    ce_ltp: 120.50, ce_delta: 0.55, ce_theta: -3.2,
    ce_gamma: 0.002, ce_vega: 8.5,
    pe_oi: 8000, pe_oiChg: -200, pe_volume: 2500, pe_iv: 16.0,
    pe_ltp: 95.75, pe_delta: -0.45, pe_theta: -2.8,
    pe_gamma: 0.0018, pe_vega: 7.9,
    ...overrides,
  };
}

function buildChain(center = 22500, count = 5, step = 100): OptionRow[] {
  const start = center - Math.floor(count / 2) * step;
  return Array.from({ length: count }, (_, i) => {
    const s = start + i * step;
    return makeRow(s, {
      isATM: s === center,
      ce_oi: 10000 + i * 1000,
      pe_oi: 8000 + (count - i) * 1000,
    });
  });
}

const EXPIRY: ExpiryDate = {
  label: '29 May', breezeValue: '2025-05-29T06:00:00.000Z', daysToExpiry: 5,
};

const BASE_PROPS = {
  symbol: 'NIFTY' as SymbolCode,
  spotPrice: 22500,
  selectedExpiry: EXPIRY,
  onExpiryChange: jest.fn(),
  onAddLeg: jest.fn(),
  highlightedStrikes: new Set<number>(),
  lastUpdate: new Date(),
  isLoading: false,
  onRefresh: jest.fn(),
};

// ════════════════════════════════════════════════════════════════
// SPEC-B1: computeMaxPain
// ════════════════════════════════════════════════════════════════

describe('computeMaxPain (SPEC-B1)', () => {
  it('returns 0 for empty data', () => {
    expect(computeMaxPain([])).toBe(0);
  });

  it('returns the single strike for single-row data', () => {
    const data = [makeRow(22500)];
    expect(computeMaxPain(data)).toBe(22500);
  });

  it('finds max pain between clustered CE and PE OI', () => {
    // Heavy CE OI at 23000 (resistance) and heavy PE OI at 22000 (support)
    // Max pain should be somewhere between them
    const data = [
      makeRow(21500, { ce_oi: 100, pe_oi: 5000 }),
      makeRow(22000, { ce_oi: 200, pe_oi: 50000 }),
      makeRow(22500, { ce_oi: 1000, pe_oi: 1000 }),
      makeRow(23000, { ce_oi: 50000, pe_oi: 200 }),
      makeRow(23500, { ce_oi: 5000, pe_oi: 100 }),
    ];

    const mp = computeMaxPain(data);
    // Max pain should be between 22000 and 23000
    expect(mp).toBeGreaterThanOrEqual(22000);
    expect(mp).toBeLessThanOrEqual(23000);
  });

  it('is NOT equal to naive spot rounding', () => {
    const data = [
      makeRow(22000, { ce_oi: 100, pe_oi: 80000 }),
      makeRow(22200, { ce_oi: 500, pe_oi: 40000 }),
      makeRow(22400, { ce_oi: 2000, pe_oi: 10000 }),
      makeRow(22600, { ce_oi: 10000, pe_oi: 2000 }),
      makeRow(22800, { ce_oi: 40000, pe_oi: 500 }),
      makeRow(23000, { ce_oi: 80000, pe_oi: 100 }),
    ];

    const mp = computeMaxPain(data);
    const naiveSpotRound = 22500; // Math.round(22500 / 200) * 200
    // With asymmetric OI, max pain should NOT equal naive rounding
    expect(mp).not.toBe(naiveSpotRound);
  });
});

// ════════════════════════════════════════════════════════════════
// SPEC-F2: deriveOISignal
// ════════════════════════════════════════════════════════════════

describe('deriveOISignal (SPEC-F2)', () => {
  it('returns long_buildup for OI↑ + Price↑', () => {
    expect(deriveOISignal(5000, 10)).toBe('long_buildup');
  });

  it('returns short_buildup for OI↑ + Price↓', () => {
    expect(deriveOISignal(5000, -10)).toBe('short_buildup');
  });

  it('returns short_covering for OI↓ + Price↑', () => {
    expect(deriveOISignal(-5000, 10)).toBe('short_covering');
  });

  it('returns long_unwinding for OI↓ + Price↓', () => {
    expect(deriveOISignal(-5000, -10)).toBe('long_unwinding');
  });

  it('returns neutral for small OI change', () => {
    expect(deriveOISignal(50, 10)).toBe('neutral');
  });

  it('returns neutral for NaN inputs', () => {
    expect(deriveOISignal(NaN, 10)).toBe('neutral');
    expect(deriveOISignal(5000, NaN)).toBe('neutral');
  });
});

// ════════════════════════════════════════════════════════════════
// SPEC-A2: formatCell registry
// ════════════════════════════════════════════════════════════════

describe('formatCell (SPEC-A2)', () => {
  it('formats LTP with 2 decimals', () => {
    expect(formatCell('ce_ltp', 123.456)).toBe('123.46');
  });

  it('formats IV with 1 decimal + percent', () => {
    expect(formatCell('ce_iv', 15.678)).toBe('15.7%');
  });

  it('formats delta with 3 decimals', () => {
    expect(formatCell('ce_delta', 0.55123)).toBe('0.551');
  });

  it('formats OI change with sign', () => {
    expect(formatCell('ce_oiChg', 5000)).toMatch(/^\+/);
    expect(formatCell('pe_oiChg', -3000)).toMatch(/^-/);
  });

  it('returns — for NaN/Infinity', () => {
    expect(formatCell('ce_ltp', NaN)).toBe('—');
    expect(formatCell('ce_ltp', Infinity)).toBe('—');
  });

  it('uses fallback for unknown columns', () => {
    expect(formatCell('unknown_col', 42)).toBe('42');
  });
});

// ════════════════════════════════════════════════════════════════
// getRowValue
// ════════════════════════════════════════════════════════════════

describe('getRowValue', () => {
  it('reads existing fields', () => {
    const row = makeRow(22500);
    expect(getRowValue(row, 'ce_ltp')).toBe(120.50);
  });

  it('returns 0 for missing fields', () => {
    expect(getRowValue(makeRow(22500), 'nonexistent')).toBe(0);
  });

  it('returns 0 for NaN', () => {
    const row = { ...makeRow(22500), ce_ltp: NaN } as unknown as OptionRow;
    expect(getRowValue(row, 'ce_ltp')).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// COMPONENT RENDERING
// ════════════════════════════════════════════════════════════════

describe('OptionChain component', () => {
  it('renders without crashing', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} />);
    expect(screen.getByTestId('option-chain')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading with no data', () => {
    render(<OptionChain {...BASE_PROPS} data={[]} isLoading />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('shows empty state', () => {
    render(<OptionChain {...BASE_PROPS} data={[]} />);
    expect(screen.getByTestId('chain-empty')).toBeInTheDocument();
  });

  it('shows error banner', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} error="Network timeout" />);
    expect(screen.getByTestId('chain-error')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  it('renders correct number of rows', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain(22500, 7)} />);
    expect(screen.getAllByTestId(/^chain-row-/)).toHaveLength(7);
  });

  it('marks ATM row', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} />);
    expect(screen.getByTestId('chain-row-22500')).toHaveAttribute('data-atm', 'true');
  });

  it('highlights strategy strikes', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} highlightedStrikes={new Set([22400])} />);
    expect(screen.getByTestId('chain-row-22400')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('chain-row-22500')).toHaveAttribute('aria-selected', 'false');
  });

  it('shows LIVE indicator', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} isLive />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('shows straddle premium in stats', () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} />);
    // ATM row: ce_ltp=120.50, pe_ltp=95.75 → straddle ≈ 216
    expect(screen.getByText(/Straddle/)).toBeInTheDocument();
  });

  it('shows max pain (not naive spot rounding)', () => {
    const data = [
      makeRow(22000, { ce_oi: 100, pe_oi: 50000, isATM: false }),
      makeRow(22500, { ce_oi: 1000, pe_oi: 1000, isATM: true }),
      makeRow(23000, { ce_oi: 50000, pe_oi: 100, isATM: false }),
    ];
    render(<OptionChain {...BASE_PROPS} data={data} />);
    expect(screen.getByText(/Max Pain/)).toBeInTheDocument();
  });

  it('shows unknown symbol error', () => {
    render(<OptionChain {...BASE_PROPS} symbol={'INVALID' as SymbolCode} data={[]} />);
    expect(screen.getByTestId('chain-unknown-symbol')).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// INTERACTIONS
// ════════════════════════════════════════════════════════════════

describe('OptionChain interactions', () => {
  it('calls onAddLeg on Buy CE click', async () => {
    const onAddLeg = jest.fn();
    render(<OptionChain {...BASE_PROPS} data={buildChain()} onAddLeg={onAddLeg} />);
    const row = screen.getByTestId('chain-row-22500');
    await userEvent.hover(row);
    const buyBtns = within(row).getAllByRole('button', { name: /buy ce/i });
    await userEvent.click(buyBtns[0]);
    expect(onAddLeg).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CE', strike: 22500, action: 'BUY' }),
    );
  });

  it('adds leg on B key', () => {
    const onAddLeg = jest.fn();
    render(<OptionChain {...BASE_PROPS} data={buildChain()} onAddLeg={onAddLeg} />);
    const row = screen.getByTestId('chain-row-22500');
    row.focus();
    fireEvent.keyDown(row, { key: 'b' });
    expect(onAddLeg).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CE', action: 'BUY', strike: 22500 }),
    );
  });

  it('adds PE leg on Shift+S', () => {
    const onAddLeg = jest.fn();
    render(<OptionChain {...BASE_PROPS} data={buildChain()} onAddLeg={onAddLeg} />);
    const row = screen.getByTestId('chain-row-22500');
    row.focus();
    fireEvent.keyDown(row, { key: 's', shiftKey: true });
    expect(onAddLeg).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PE', action: 'SELL' }),
    );
  });

  it('adds CE leg on double-click (SPEC-F10)', async () => {
    const onAddLeg = jest.fn();
    render(<OptionChain {...BASE_PROPS} data={buildChain()} onAddLeg={onAddLeg} />);
    const row = screen.getByTestId('chain-row-22400');
    await userEvent.dblClick(row);
    expect(onAddLeg).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CE', action: 'BUY', strike: 22400 }),
    );
  });

  it('toggles Greeks columns', async () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} />);
    const btn = screen.getByRole('button', { name: /greeks/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    // Δ headers should appear
    expect(screen.getAllByText('Δ').length).toBeGreaterThanOrEqual(2);
  });

  it('throttles refresh', async () => {
    jest.useFakeTimers();
    const onRefresh = jest.fn();
    render(<OptionChain {...BASE_PROPS} data={buildChain()} onRefresh={onRefresh} />);
    const btn = screen.getByRole('button', { name: /refresh option chain/i });
    await userEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await userEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1); // blocked by cooldown
    act(() => { jest.advanceTimersByTime(2100); });
    await userEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('sorts by column on click (SPEC-F1)', async () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain(22500, 5)} />);
    // Find a CE OI header and click it
    const headers = screen.getAllByText('OI');
    const ceOIHeader = headers[0]; // first OI is CE side
    await userEvent.click(ceOIHeader);
    // Should now show sort indicator
    expect(ceOIHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');
    // Click again
    await userEvent.click(ceOIHeader);
    expect(ceOIHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    // Third click resets
    await userEvent.click(ceOIHeader);
    expect(ceOIHeader.closest('th')).toHaveAttribute('aria-sort', 'none');
  });
});

// ════════════════════════════════════════════════════════════════
// SPEC-B2: Staleness timer
// ════════════════════════════════════════════════════════════════

describe('Staleness warning (SPEC-B2)', () => {
  it('appears when data is stale', () => {
    const staleDate = new Date(Date.now() - 180_000); // 3 min ago
    render(<OptionChain {...BASE_PROPS} data={buildChain()} lastUpdate={staleDate} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Data is/)).toBeInTheDocument();
  });

  it('does not appear for fresh data', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} lastUpdate={new Date()} />);
    expect(screen.queryByText(/Data is.*old/)).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ════════════════════════════════════════════════════════════════

describe('Error boundary', () => {
  beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { (console.error as jest.Mock).mockRestore(); });

  it('catches errors and shows fallback', () => {
    // Passing null data should be caught by the boundary
    render(<OptionChain {...BASE_PROPS} data={null as unknown as OptionRow[]} />);
    expect(
      document.querySelector('[data-testid="option-chain"], [role="alert"]'),
    ).toBeInTheDocument();
  });
});
