export type TruthAuthority = 'broker' | 'normalized' | 'analytical';

export interface TruthDescriptor {
  authority: TruthAuthority;
  source: string;
  asOf: number;
}

export type FreshnessTone = 'fresh' | 'delayed' | 'stale' | 'expired';

export function truthDescriptor(
  authority: TruthAuthority,
  source: string,
  asOf = Date.now(),
): TruthDescriptor {
  return { authority, source, asOf };
}

export function freshnessAgeMs(descriptor: TruthDescriptor, now = Date.now()): number {
  return Math.max(0, now - descriptor.asOf);
}

export function freshnessTone(descriptor: TruthDescriptor, now = Date.now()): FreshnessTone {
  const age = freshnessAgeMs(descriptor, now);
  if (age <= 5_000) return 'fresh';
  if (age <= 30_000) return 'delayed';
  if (age <= 120_000) return 'stale';
  return 'expired';
}

export function freshnessLabel(descriptor: TruthDescriptor, now = Date.now()): string {
  const ageSeconds = Math.floor(freshnessAgeMs(descriptor, now) / 1000);
  if (ageSeconds < 1) return 'now';
  if (ageSeconds < 60) return `${ageSeconds}s ago`;

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes}m ago`;

  const ageHours = Math.floor(ageMinutes / 60);
  return `${ageHours}h ago`;
}

export function authorityLabel(authority: TruthAuthority): string {
  if (authority === 'broker') return 'Broker truth';
  if (authority === 'normalized') return 'Normalized truth';
  return 'Analytical';
}
