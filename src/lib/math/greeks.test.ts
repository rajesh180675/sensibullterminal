import { describe, it, expect } from 'vitest';
import { calculateGreeks, calculateIV } from './greeks';

describe('Option Greeks and IV Math Validation', () => {
  it('should accurately calculate Nifty At-The-Money Call Greeks', () => {
    // Standard inputs for an ATM call
    const S = 22000;
    const K = 22000;
    const T = 7 / 365; // 7 days to expiry
    const r = 0.10; // 10% risk-free rate
    const iv = 0.15; // 15% IV
    
    const greeks = calculateGreeks(S, K, T, r, iv, 'CE');
    
    // Delta should be near 0.5 for ATM Call
    expect(greeks.delta).toBeGreaterThan(0.48);
    expect(greeks.delta).toBeLessThan(0.60);
    
    // Gamma should be positive and identical for calls/puts
    expect(greeks.gamma).toBeGreaterThan(0);
    
    // Theta should be negative (time decay hurts buyer)
    expect(greeks.theta).toBeLessThan(0);
    
    // Vega should be positive (volatility helps buyer)
    expect(greeks.vega).toBeGreaterThan(0);
  });

  it('should calculate identical Gamma and Vega for identical Puts', () => {
    const S = 22000;
    const K = 22000;
    const T = 7 / 365;
    const r = 0.10;
    const iv = 0.15;
    
    const callGreeks = calculateGreeks(S, K, T, r, iv, 'CE');
    const putGreeks = calculateGreeks(S, K, T, r, iv, 'PE');
    
    // Gamma and Vega are identical regardless of call/put
    expect(callGreeks.gamma).toBeCloseTo(putGreeks.gamma, 4);
    expect(callGreeks.vega).toBeCloseTo(putGreeks.vega, 4);
    
    // Call Delta - Put Delta = 1 (approx, accounting for continuous dividends/rates)
    expect(Math.abs(callGreeks.delta - putGreeks.delta)).toBeCloseTo(1, 1);
  });

  it('should reliably calculate Implied Volatility using Newton-Raphson', () => {
    const S = 22000;
    const K = 22000;
    const T = 7 / 365;
    const r = 0.10;
    const marketPrice = 200; // Expected market price of option
    
    const iv = calculateIV(marketPrice, S, K, T, r, 'CE');
    
    // Re-plug IV back into greeks to find theoretical price
    const greeks = calculateGreeks(S, K, T, r, iv, 'CE');
    expect(greeks.theoreticalPrice).toBeCloseTo(marketPrice, 0);
  });
});
