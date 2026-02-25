// components/OptionChain/utils/exportToCSV.ts

import type { OptionRow } from '../../../types/index';

/**
 * Build & trigger a CSV download for the option chain.
 *
 * Features:
 *   - UTF-8 BOM for Excel compatibility
 *   - RFC 4180 compliant field escaping
 *   - Metadata comment row
 *   - Automatic blob cleanup via rAF
 *
 * SPEC-F9: Supports exporting filtered OR full chain via the
 * `data` parameter — caller decides what to pass.
 *
 * @param data - Rows to export (can be filtered or full)
 * @param symbol - Symbol name for filename
 * @param expiry - Expiry string for filename
 * @param spotPrice - Spot price for metadata row
 * @param isFiltered - If true, notes "filtered" in metadata
 */
export function exportToCSV(
  data: ReadonlyArray<OptionRow>,
  symbol: string,
  expiry: string,
  spotPrice: number,
  isFiltered: boolean = false,
): void {
  if (data.length === 0) return;

  const headers = [
    'CE_OI', 'CE_OI_Chg', 'CE_Volume', 'CE_IV', 'CE_Delta', 'CE_Theta',
    'CE_Gamma', 'CE_Vega', 'CE_LTP',
    'Strike', 'Is_ATM',
    'PE_LTP', 'PE_IV', 'PE_Delta', 'PE_Theta',
    'PE_Gamma', 'PE_Vega', 'PE_Volume', 'PE_OI_Chg', 'PE_OI',
  ];

  const escapeField = (v: unknown): string => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const rows = data.map((r) =>
    [
      r.ce_oi, r.ce_oiChg, r.ce_volume, r.ce_iv, r.ce_delta, r.ce_theta,
      r.ce_gamma, r.ce_vega, r.ce_ltp,
      r.strike, r.isATM ? 'Y' : '',
      r.pe_ltp, r.pe_iv, r.pe_delta, r.pe_theta,
      r.pe_gamma, r.pe_vega, r.pe_volume, r.pe_oiChg, r.pe_oi,
    ]
      .map(escapeField)
      .join(','),
  );

  const filterNote = isFiltered ? ' (filtered)' : '';
  const meta = [
    `# ${symbol} Option Chain${filterNote}`,
    `Expiry: ${expiry}`,
    `Spot: ${spotPrice}`,
    `Rows: ${data.length}`,
    `Exported: ${new Date().toISOString()}`,
  ].join(' | ');

  const csv = [meta, headers.join(','), ...rows].join('\n');

  const blob = new Blob(['\uFEFF' + csv], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${symbol}_chain_${expiry.replace(/\s+/g, '_')}_${Date.now()}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  requestAnimationFrame(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  });
}
