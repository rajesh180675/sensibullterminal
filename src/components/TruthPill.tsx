import { authorityLabel, freshnessLabel, freshnessTone, type TruthDescriptor } from '../lib/truth';

const toneClasses = {
  fresh: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  delayed: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  stale: 'border-red-500/30 bg-red-500/10 text-red-100',
  expired: 'border-slate-500/30 bg-slate-500/10 text-slate-200',
} as const;

export function TruthPill({
  descriptor,
  compact = false,
}: {
  descriptor: TruthDescriptor;
  compact?: boolean;
}) {
  const tone = freshnessTone(descriptor);

  return (
    <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs transition-colors duration-200 ${toneClasses[tone]}`}>
      <span>{authorityLabel(descriptor.authority)}</span>
      {!compact && <span className="text-white/60">{descriptor.source}</span>}
      <span className="text-white/60">{freshnessLabel(descriptor)}</span>
    </span>
  );
}
