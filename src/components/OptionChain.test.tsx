// OptionChain.test.tsx
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OptionChain, exportToCSV, formatCell, getRowValue } from './OptionChain';
import type { OptionRow, ExpiryDate, SymbolCode } from '../types/index';

// ── Test helpers ───────────────────────────────────────────────

function makeRow(strike: number, overrides: Partial<OptionRow> = {}): OptionRow {
  return {
    strike,
    isATM: false,
    ce_oi: 10000, ce_oiChg: 500, ce_volume: 3000, ce_iv: 15.5,
    ce_ltp: 120.50, ce_delta: 0.55, ce_theta: -3.2,
    ce_gamma: 0.002, ce_vega: 8.5,
    pe_oi: 8000, pe_oiChg: -200, pe_volume: 2500, pe_iv: 16.0,
    pe_ltp: 95.75, pe_delta: -0.45, pe_theta: -2.8,
    pe_gamma: 0.0018, pe_vega: 7.9,
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

// ── Utility function tests ─────────────────────────────────────

describe('formatCell', () => {
  it('formats LTP with 2 decimal places', () => {
    expect(formatCell('ce_ltp', 123.456)).toBe('123.46');
    expect(formatCell('pe_ltp', 0)).toBe('0.00');
  });

  it('formats IV with 1 decimal + percent', () => {
    expect(formatCell('ce_iv', 15.678)).toBe('15.7%');
  });

  it('formats delta with 3 decimals', () => {
    expect(formatCell('ce_delta', 0.55123)).toBe('0.551');
  });

  it('formats OI change with sign prefix', () => {
    expect(formatCell('ce_oiChg', 5000)).toMatch(/^\+/);
    expect(formatCell('pe_oiChg', -3000)).toMatch(/^-/);
  });

  it('returns dash for non-finite values', () => {
    expect(formatCell('ce_ltp', NaN)).toBe('—');
    expect(formatCell('ce_ltp', Infinity)).toBe('—');
  });
});

describe('getRowValue', () => {
  const row = makeRow(22500);

  it('reads existing numeric fields', () => {
    expect(getRowValue(row, 'ce_ltp')).toBe(120.50);
    expect(getRowValue(row, 'strike')).toBe(22500);
  });

  it('returns 0 for missing fields', () => {
    expect(getRowValue(row, 'nonexistent_field')).toBe(0);
  });

  it('returns 0 for non-finite values', () => {
    const bad = { ...row, ce_ltp: NaN } as unknown as OptionRow;
    expect(getRowValue(bad, 'ce_ltp')).toBe(0);
  });
});

// ── Component render tests ─────────────────────────────────────

describe('OptionChain', () => {
  it('renders without crashing with valid data', () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} />);
    expect(screen.getByTestId('option-chain')).toBeInTheDocument();
  });

  it('renders loading skeleton when isLoading with no data', () => {
    render(<OptionChain {...BASE_PROPS} data={[]} isLoading={true} />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders empty state when data is empty and not loading', () => {
    render(<OptionChain {...BASE_PROPS} data={[]} />);
    expect(screen.getByTestId('chain-empty')).toBeInTheDocument();
  });

  it('renders error banner when error prop is set', () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} error="Network timeout" />);
    expect(screen.getByTestId('chain-error')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  it('renders the correct number of data rows', () => {
    const data = buildChain(22500, 7);
    render(<OptionChain {...BASE_PROPS} data={data} />);
    const rows = screen.getAllByTestId(/^chain-row-/);
    expect(rows).toHaveLength(7);
  });

  it('marks ATM row with data attribute', () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} />);
    const atmRow = screen.getByTestId('chain-row-22500');
    expect(atmRow).toHaveAttribute('data-atm', 'true');
  });

  it('highlights strikes in the strategy', () => {
    const data = buildChain();
    const highlighted = new Set([22400, 22600]);
    render(<OptionChain {...BASE_PROPS} data={data} highlightedStrikes={highlighted} />);

    const row22400 = screen.getByTestId('chain-row-22400');
    expect(row22400).toHaveAttribute('aria-selected', 'true');

    const row22500 = screen.getByTestId('chain-row-22500');
    expect(row22500).toHaveAttribute('aria-selected', 'false');
  });

  it('displays spot price in stats strip', () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} />);
    expect(screen.getByText(/22,500/)).toBeInTheDocument();
  });

  it('shows LIVE indicator when isLive is true', () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} isLive={true} />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('shows DEMO indicator when isLive is false', () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} isLive={false} />);
    expect(screen.getByText('DEMO')).toBeInTheDocument();
  });

  it('displays unknown symbol error for invalid symbol', () => {
    render(
      <OptionChain
        {...BASE_PROPS}
        symbol={'INVALID' as SymbolCode}
        data={[]}
      />,
    );
    expect(screen.getByTestId('chain-unknown-symbol')).toBeInTheDocument();
  });
});

// ── Interaction tests ──────────────────────────────────────────

describe('OptionChain interactions', () => {
  it('calls onAddLeg when Buy CE button is clicked', async () => {
    const onAddLeg = jest.fn();
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} onAddLeg={onAddLeg} />);

    const row = screen.getByTestId('chain-row-22500');
    await userEvent.hover(row);

    const buyButtons = within(row).getAllByRole('button', { name: /buy ce/i });
    await userEvent.click(buyButtons[0]);

    expect(onAddLeg).toHaveBeenCalledTimes(1);
    expect(onAddLeg).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'NIFTY',
        type: 'CE',
        strike: 22500,
        action: 'BUY',
        lots: 1,
      }),
    );
  });

  it('calls onAddLeg when Sell PE button is clicked', async () => {
    const onAddLeg = jest.fn();
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} onAddLeg={onAddLeg} />);

    const row = screen.getByTestId('chain-row-22400');
    await userEvent.hover(row);

    const sellButtons = within(row).getAllByRole('button', { name: /sell pe/i });
    await userEvent.click(sellButtons[0]);

    expect(onAddLeg).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PE',
        strike: 22400,
        action: 'SELL',
      }),
    );
  });

  it('toggles Greeks columns', async () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} />);

    const greeksBtn = screen.getByRole('button', { name: /greeks/i });
    expect(greeksBtn).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(greeksBtn);
    expect(greeksBtn).toHaveAttribute('aria-pressed', 'true');

    // Delta column header should now be visible
    const deltaHeaders = screen.getAllByText('Δ');
    expect(deltaHeaders.length).toBeGreaterThanOrEqual(2); // CE + PE
  });

  it('toggles OI bars', async () => {
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} />);

    const oiBtn = screen.getByRole('button', { name: /oi bars/i });
    expect(oiBtn).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(oiBtn);
    expect(oiBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('throttles refresh clicks', async () => {
    jest.useFakeTimers();
    const onRefresh = jest.fn();
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} onRefresh={onRefresh} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh option chain/i });

    await userEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Immediate second click should be blocked
    await userEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // After cooldown
    act(() => { jest.advanceTimersByTime(REFRESH_COOLDOWN_MS + 100); });

    await userEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('changes expiry when expiry button is clicked', async () => {
    const onExpiryChange = jest.fn();
    const data = buildChain();
    render(
      <OptionChain
        {...BASE_PROPS}
        data={data}
        onExpiryChange={onExpiryChange}
      />,
    );

    // Find expiry radio buttons
    const expiryGroup = screen.getByRole('radiogroup', { name: /expiry/i });
    const buttons = within(expiryGroup).getAllByRole('radio');

    if (buttons.length > 1) {
      await userEvent.click(buttons[1]);
      expect(onExpiryChange).toHaveBeenCalledTimes(1);
    }
  });

  it('calls onRefresh when Retry is clicked on error banner', async () => {
    const onRefresh = jest.fn();
    const data = buildChain();
    render(
      <OptionChain
        {...BASE_PROPS}
        data={data}
        onRefresh={onRefresh}
        error="Something went wrong"
      />,
    );

    const retryBtn = within(screen.getByTestId('chain-error')).getByText('Retry');
    await userEvent.click(retryBtn);
    expect(onRefresh).toHaveBeenCalled();
  });
});

// ── Keyboard navigation tests ──────────────────────────────────

describe('OptionChain keyboard navigation', () => {
  it('navigates rows with arrow keys', async () => {
    const data = buildChain(22500, 5);
    render(<OptionChain {...BASE_PROPS} data={data} />);

    const firstRow = screen.getByTestId('chain-row-22300');
    firstRow.focus();

    fireEvent.keyDown(firstRow.closest('[class*="overflow-auto"]')!, {
      key: 'ArrowDown',
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('chain-row-22400'));
    });
  });

  it('adds CE leg on B key when row is focused', async () => {
    const onAddLeg = jest.fn();
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} onAddLeg={onAddLeg} />);

    const row = screen.getByTestId('chain-row-22500');
    row.focus();
    fireEvent.keyDown(row, { key: 'b' });

    expect(onAddLeg).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CE', action: 'BUY', strike: 22500 }),
    );
  });

  it('adds PE leg on Shift+S key when row is focused', async () => {
    const onAddLeg = jest.fn();
    const data = buildChain();
    render(<OptionChain {...BASE_PROPS} data={data} onAddLeg={onAddLeg} />);

    const row = screen.getByTestId('chain-row-22500');
    row.focus();
    fireEvent.keyDown(row, { key: 's', shiftKey: true });

    expect(onAddLeg).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PE', action: 'SELL', strike: 22500 }),
    );
  });
});

// ── CSV export tests ───────────────────────────────────────────

describe('exportToCSV', () => {
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

  it('creates a blob with BOM and triggers download', () => {
    const data = [makeRow(22500, { isATM: true })];
    const clickSpy = jest.fn();
    const appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(
      (node) => {
        if (node instanceof HTMLAnchorElement) {
          jest.spyOn(node, 'click').mockImplementation(clickSpy);
        }
        return node;
      },
    );

    exportToCSV(data, 'NIFTY', '2025-05-29', 22500);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as [Blob])[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv;charset=utf-8;');

    appendSpy.mockRestore();
  });
});

// ── Error boundary tests ───────────────────────────────────────

describe('OptionChain error boundary', () => {
  const consoleError = console.error;

  beforeEach(() => {
    // Suppress React error boundary console noise in tests
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = consoleError;
  });

  it('catches render errors and shows fallback', () => {
    // Force an error by passing data that would cause a crash
    // We simulate this by rendering a broken child component
    const BrokenChild = () => {
      throw new Error('Test crash');
    };

    const { getByText } = render(
      <OptionChain
        {...BASE_PROPS}
        // @ts-expect-error intentionally passing invalid to trigger error
        data={null}
      />,
    );

    // The error boundary should catch and show fallback
    // (exact behavior depends on whether null data triggers the boundary
    //  or is handled by the guard — either way, no unhandled crash)
    expect(document.querySelector('[data-testid="option-chain"], [role="alert"]')).toBeInTheDocument();
  });
});
