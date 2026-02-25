// OptionChain.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { OptionChain } from './OptionChain';
import type { OptionRow, ExpiryDate, SymbolCode } from '../types/index';
import { useEffect, useState, useRef } from 'react';

function makeRow(strike: number, overrides: Partial<OptionRow> = {}): OptionRow {
  const ceLtp = Math.max(0.05, (22500 - strike) * 0.8 + Math.random() * 50);
  const peLtp = Math.max(0.05, (strike - 22500) * 0.8 + Math.random() * 50);
  return {
    strike, isATM: false,
    ce_oi: 10000 + Math.random() * 50000,
    ce_oiChg: (Math.random() - 0.4) * 5000,
    ce_volume: Math.random() * 20000,
    ce_iv: 12 + Math.random() * 10,
    ce_ltp: ceLtp,
    ce_delta: Math.max(0, Math.min(1, 0.5 + (22500 - strike) / 2000)),
    ce_theta: -(2 + Math.random() * 5),
    ce_gamma: 0.001 + Math.random() * 0.003,
    ce_vega: 5 + Math.random() * 10,
    ce_bid: Math.max(0, ceLtp - 0.5),      // required by OptionRow
    ce_ask: ceLtp + 0.5,                   // required by OptionRow
    pe_oi: 8000 + Math.random() * 40000,
    pe_oiChg: (Math.random() - 0.5) * 4000,
    pe_volume: Math.random() * 18000,
    pe_iv: 13 + Math.random() * 10,
    pe_ltp: peLtp,
    pe_delta: -Math.max(0, Math.min(1, 0.5 + (strike - 22500) / 2000)),
    pe_theta: -(2 + Math.random() * 5),
    pe_gamma: 0.001 + Math.random() * 0.003,
    pe_vega: 5 + Math.random() * 10,
    pe_bid: Math.max(0, peLtp - 0.5),     // required by OptionRow
    pe_ask: peLtp + 0.5,                  // required by OptionRow
    ...overrides,
  };
}

function buildChain(center = 22500, count = 40, step = 50): OptionRow[] {
  const start = center - Math.floor(count / 2) * step;
  return Array.from({ length: count }, (_, i) => {
    const strike = start + i * step;
    return makeRow(strike, { isATM: strike === center });
  });
}

const EXPIRY: ExpiryDate = {
  label: '29 May', breezeValue: '2025-05-29T06:00:00.000Z', daysToExpiry: 5,
};

const meta: Meta<typeof OptionChain> = {
  title: 'Trading/OptionChain',
  component: OptionChain,
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'dark', values: [{ name: 'dark', value: '#0a0c14' }] },
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof OptionChain>;

export const Default: Story = {
  args: {
    symbol: 'NIFTY' as SymbolCode,
    data: buildChain(),
    spotPrice: 22500,
    selectedExpiry: EXPIRY,
    highlightedStrikes: new Set([22400, 22600]),
    lastUpdate: new Date(),
    isLoading: false,
    isLive: false,
  },
};

export const Loading: Story = {
  args: {
    ...Default.args,
    data: [],
    isLoading: true,
    loadingMsg: 'Fetching NIFTY chain from Breeze...',
  },
};

export const Empty: Story = {
  args: {
    ...Default.args,
    data: [],
    isLoading: false,
  },
};

export const WithError: Story = {
  args: {
    ...Default.args,
    error: 'API rate limit exceeded. Please try again in 30 seconds.',
  },
};

export const LiveWithFlashes: Story = {
  render: (args) => {
    const [data, setData] = useState(() => buildChain());
    const intervalRef = useRef<ReturnType<typeof setInterval>>();

    useEffect(() => {
      intervalRef.current = setInterval(() => {
        setData(prev => prev.map(row => ({
          ...row,
          ce_ltp: row.ce_ltp + (Math.random() - 0.5) * 5,
          pe_ltp: row.pe_ltp + (Math.random() - 0.5) * 5,
          ce_oi: Math.max(0, row.ce_oi + (Math.random() - 0.4) * 500),
          pe_oi: Math.max(0, row.pe_oi + (Math.random() - 0.4) * 500),
        })));
      }, 1500);
      return () => clearInterval(intervalRef.current);
    }, []);

    return (
      <OptionChain
        {...args}
        data={data}
        isLive={true}
        lastUpdate={new Date()}
      />
    );
  },
  args: {
    ...Default.args,
    isLive: true,
  },
};

export const StaleData: Story = {
  args: {
    ...Default.args,
    lastUpdate: new Date(Date.now() - 180_000), // 3 min ago
  },
};

export const WithGreeks: Story = {
  args: Default.args,
  play: async ({ canvasElement }) => {
    const { getByText } = await import('@storybook/testing-library').then(m => m.within(canvasElement));
    const { userEvent } = await import('@storybook/testing-library');
    const greeksBtn = getByText('Δ Greeks');
    await userEvent.click(greeksBtn);
  },
};
