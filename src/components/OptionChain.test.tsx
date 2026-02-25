// OptionChain.test.tsx
// NOTE: This file tests the refactored OptionChain module (OptionChain/index.ts).
// The old monolith OptionChain.tsx has been removed.
// Detailed unit tests live in OptionChain/OptionChain.test.tsx.
// This file provides integration-level smoke tests via the public index.

import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OptionChain, exportToCSV, formatCell, getRowValue } from './OptionChain';
import { REFRESH_COOLDOWN_MS } from './OptionChain';
import type { OptionRow, ExpiryDate, SymbolCode } from '../types/index';

// ── Test helpers ───────────────────────────────────────────────

function makeRow(strike: number, overrides: Partial<OptionRow> = {}): OptionRow {
  return {
    strike,
    isATM: false,
    ce_oi: 10000, ce_oiChg: 500, ce_volume: 3000, ce_iv: 15.5,
    ce_ltp: 120.50, ce_delta: 0.55, ce_theta: -3.2,
    ce_gamma: 0.002, ce_vega: 8.5,
    ce_bid: 120.00, ce_ask: 121.00,
    pe_oi: 8000, pe_oiChg: -200, pe_volume: 2500, pe_iv: 16.0,
    pe_ltp: 95.75, pe_delta: -0.45, pe_theta: -2.8,
    pe_gamma: 0.0018, pe_vega: 7.9,
    pe_bid: 95.25, pe_ask: 96.25,
    ...overrides,
  };
}

const EXPIRY: ExpiryDate = {
  label: '29 May',
  breezeValue: '2025-05-29T06:00:00.000Z',
  daysToExpiry: 5,
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

function buildChain(center = 22500, count = 5, step = 100): OptionRow[] {
  const rows: OptionRow[] = [];
  const start = center - Math.floor(count / 2) * step;
  for (let i = 0; i < count; i++) {
    const strike = start + i * step;
    rows.push(makeRow(strike, {
      isATM: strike === center,
      ce_oi: 10000 + i * 1000,
      pe_oi: 8000 + (count - i) * 1000,
    }));
  }
  return rows;
}

// ── Utility function tests (via public index re-exports) ────────

describe('formatCell (via public index)', () => {
  it('formats LTP with 2 decimal places', () => {
    expect(formatCell('ce_ltp', 123.456)).toBe('123.46');
    expect(formatCell('pe_ltp', 0)).toBe('0.00');
  });
  it('formats IV with 1 decimal + percent', () => {
    expect(formatCell('ce_iv', 15.678)).toBe('15.7%');
  });
  it('returns dash for non-finite values', () => {
    expect(formatCell('ce_ltp', NaN)).toBe('—');
    expect(formatCell('ce_ltp', Infinity)).toBe('—');
  });
});

describe('getRowValue (via public index)', () => {
  const row = makeRow(22500);
  it('reads existing numeric fields', () => {
    expect(getRowValue(row, 'ce_ltp')).toBe(120.50);
  });
  it('returns 0 for missing fields', () => {
    expect(getRowValue(row, 'nonexistent_field')).toBe(0);
  });
});

// ── Component smoke tests ──────────────────────────────────────

describe('OptionChain (integration smoke tests)', () => {
  it('renders without crashing', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} />);
    expect(screen.getByTestId('option-chain')).toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading with no data', () => {
    render(<OptionChain {...BASE_PROPS} data={[]} isLoading={true} />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('shows empty state when data is empty and not loading', () => {
    render(<OptionChain {...BASE_PROPS} data={[]} />);
    expect(screen.getByTestId('chain-empty')).toBeInTheDocument();
  });

  it('shows error banner when error prop is set', () => {
    render(<OptionChain {...BASE_PROPS} data={buildChain()} error="Network timeout" />);
    expect(screen.getByTestId('chain-error')).toBeInTheDocument();
  });

  it('shows LIVE/DEMO indicator', () => {
    const { rerender } = render(<OptionChain {...BASE_PROPS} data={buildChain()} isLive />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    rerender(<OptionChain {...BASE_PROPS} data={buildChain()} isLive={false} />);
    expect(screen.getByText('DEMO')).toBeInTheDocument();
  });
});

// ── CSV export via public index ────────────────────────────────

describe('exportToCSV (via public index)', () => {
  let createObjectURL: jest.SpyInstance;
  let revokeObjectURL: jest.SpyInstance;

  beforeEach(() => {
    createObjectURL = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    revokeObjectURL = jest.spyOn(URL, 'revokeObjectURL').mockImplementation();
  });

  afterEach(() => {
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('does nothing with empty data', () => {
    exportToCSV([], 'NIFTY', '2025-05-29', 22500);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('creates a blob and triggers download', () => {
    const appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(
      (node) => {
        if (node instanceof HTMLAnchorElement) {
          jest.spyOn(node, 'click').mockImplementation(jest.fn());
        }
        return node;
      },
    );
    exportToCSV([makeRow(22500, { isATM: true })], 'NIFTY', '2025-05-29', 22500);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as [Blob])[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv;charset=utf-8;');
    appendSpy.mockRestore();
  });
});

// ── Refresh throttle uses REFRESH_COOLDOWN_MS constant ─────────

describe('Refresh throttle (REFRESH_COOLDOWN_MS)', () => {
  it('exports the correct constant value', () => {
    expect(REFRESH_COOLDOWN_MS).toBe(2000);
  });

  it('throttles refresh button clicks', async () => {
    jest.useFakeTimers();
    const onRefresh = jest.fn();
    render(<OptionChain {...BASE_PROPS} data={buildChain()} onRefresh={onRefresh} />);

    const btn = screen.getByRole('button', { name: /refresh option chain/i });
    await userEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await userEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1); // blocked by cooldown

    act(() => { jest.advanceTimersByTime(REFRESH_COOLDOWN_MS + 100); });
    await userEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });
});
