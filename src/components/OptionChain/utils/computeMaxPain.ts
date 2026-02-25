// components/OptionChain/utils/computeMaxPain.ts

import type { OptionRow } from '../../../types/index';

/**
 * SPEC-B1: Correct Max Pain Calculation
 *
 * Computes the true max pain strike — the settlement price at which
 * total intrinsic value loss to ALL option holders is MAXIMIZED
 * (equivalently, the price where option writers profit most).
 *
 * Algorithm:
 *   For each candidate settlement price S (every strike in the chain):
 *     totalPain(S) = Σ over all strikes K of:
 *       CE_OI(K) × max(0, S - K)    // calls expire ITM when S > K
 *       + PE_OI(K) × max(0, K - S)  // puts expire ITM when K > S
 *
 *   maxPain = argmin_S { totalPain(S) }
 *
 * Wait — the naming convention in finance is confusing.
 * "Max pain" = the price where option BUYERS experience MAX pain.
 * This is the price where the LEAST total intrinsic value is paid out.
 * So we find the S that MINIMIZES total payout to option holders.
 *
 * Complexity: O(n²) where n = number of strikes.
 * For n≈80, ~6400 additions — trivial inside useMemo.
 *
 * @param data - Full option chain rows
 * @returns The max pain strike price. Returns 0 if data is empty.
 */
export function computeMaxPain(data: ReadonlyArray<OptionRow>): number {
  if (data.length === 0) return 0;

  let minTotalPayout = Infinity;
  let maxPainStrike = data[0].strike;

  for (const candidate of data) {
    const S = candidate.strike;
    let totalPayout = 0;

    for (const row of data) {
      const K = row.strike;

      // If settlement is at S:
      // - CE at strike K is worth max(0, S - K) per contract
      // - PE at strike K is worth max(0, K - S) per contract
      // Multiply by OI (number of contracts)
      if (S > K) {
        totalPayout += row.ce_oi * (S - K);
      } else if (K > S) {
        totalPayout += row.pe_oi * (K - S);
      }
      // When S === K, both CE and PE expire worthless → 0 payout
    }

    if (totalPayout < minTotalPayout) {
      minTotalPayout = totalPayout;
      maxPainStrike = S;
    }
  }

  return maxPainStrike;
}
