export interface GreeksInput {
  spot: number;
  strike: number;
  daysToExpiry: number;
  iv: number;
  right: 'CE' | 'PE';
  riskFreeRate?: number;
}

export interface GreeksOutput {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const scaled = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * scaled);
  const poly = ((((a5 * t + a4) * t) + a3) * t + a2) * t + a1;
  const y = 1 - poly * t * Math.exp(-scaled * scaled);
  return 0.5 * (1 + sign * y);
}

function normalizeIv(iv: number): number | null {
  if (!Number.isFinite(iv) || iv <= 0) return null;
  if (iv < 1) return iv;
  return iv / 100;
}

function intrinsicDelta(spot: number, strike: number, right: 'CE' | 'PE'): number {
  if (right === 'CE') {
    if (spot > strike) return 1;
    if (spot < strike) return 0;
    return 0.5;
  }

  if (spot < strike) return -1;
  if (spot > strike) return 0;
  return -0.5;
}

export function computeGreeks(input: GreeksInput): GreeksOutput | null {
  const { spot, strike, daysToExpiry, right } = input;
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || spot <= 0 || strike <= 0) {
    return null;
  }

  const sigma = normalizeIv(input.iv);
  if (sigma == null) return null;

  const timeToExpiry = Math.max(daysToExpiry, 0) / 365;
  if (timeToExpiry <= 0) {
    return {
      delta: intrinsicDelta(spot, strike, right),
      gamma: 0,
      theta: 0,
      vega: 0,
    };
  }

  const riskFreeRate = input.riskFreeRate ?? 0;
  const sqrtT = Math.sqrt(timeToExpiry);
  const variance = sigma * sigma;
  const d1 = (Math.log(spot / strike) + (riskFreeRate + variance / 2) * timeToExpiry) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normalPdf(d1);
  const discountedStrike = strike * Math.exp(-riskFreeRate * timeToExpiry);
  const callTheta = -((spot * pdf * sigma) / (2 * sqrtT)) - riskFreeRate * discountedStrike * normalCdf(d2);
  const putTheta = -((spot * pdf * sigma) / (2 * sqrtT)) + riskFreeRate * discountedStrike * normalCdf(-d2);

  return {
    delta: right === 'CE' ? normalCdf(d1) : normalCdf(d1) - 1,
    gamma: pdf / (spot * sigma * sqrtT),
    theta: (right === 'CE' ? callTheta : putTheta) / 365,
    vega: (spot * pdf * sqrtT) / 100,
  };
}
