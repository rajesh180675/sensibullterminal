import { BookCheck, BookOpenText, ClipboardCheck, Tags } from 'lucide-react';
import { useJournalStore } from '../../domains/journal/journalStore';
import { fmtPnL } from '../../utils/math';

export function JournalWorkspace() {
  const { entries, selectedEntry, summary, mistakeTagCatalog, selectEntry, updateEntry, toggleMistakeTag } = useJournalStore();

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[0.82fr,1.18fr]">
      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <BookOpenText size={13} />
          Review System
        </div>
        <h2 className="mt-3 text-xl text-white">Seller journal</h2>
        <p className="mt-3 text-sm text-slate-400">
          Capture trade rationale before execution, review playbook compliance after the trade, and tag repeatable mistakes.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Entries</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.totalEntries}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Compliance</div>
            <div className="mt-2 text-2xl font-semibold text-white">{Math.round(summary.complianceRate * 100)}%</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Reviewed</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.reviewedEntries}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Executed</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.executedEntries}</div>
          </div>
        </div>

        <div className="mt-5 rounded-3xl border border-white/8 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
            <Tags size={12} />
            Frequent mistake tags
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(summary.topMistakeTags.length > 0 ? summary.topMistakeTags : mistakeTagCatalog.slice(0, 4).map((tag) => ({ tag, count: 0 }))).map((item) => (
              <div key={item.tag} className="rounded-full border border-white/10 bg-black/15 px-3 py-2 text-xs text-slate-300">
                {item.tag} {item.count > 0 ? `· ${item.count}` : ''}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {entries.length === 0 && (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
              Capture an opportunity from the Strategy desk to start journaling.
            </div>
          )}
          {entries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => selectEntry(entry.id)}
              className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                selectedEntry?.id === entry.id ? 'border-orange-400/40 bg-orange-500/10' : 'border-white/8 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{entry.title}</div>
                  <div className="mt-1 text-xs text-slate-400">{entry.structure} · {entry.regimeLabel}</div>
                </div>
                <div className="text-right text-xs text-slate-300">
                  <div>{entry.status}</div>
                  <div className={entry.playbookCompliance === 'aligned' ? 'text-emerald-300' : entry.playbookCompliance === 'violates' ? 'text-red-300' : 'text-amber-300'}>
                    {entry.playbookCompliance}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span>Credit {fmtPnL(entry.expectedCredit)}</span>
                <span>Rules {entry.automationRuleIds.length}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        {selectedEntry ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
                  <ClipboardCheck size={13} />
                  Entry Review
                </div>
                <h2 className="mt-3 text-xl text-white">{selectedEntry.title}</h2>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => updateEntry(selectedEntry.id, { status: 'reviewed' })}
                  className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                >
                  Mark reviewed
                </button>
                <button
                  onClick={() => updateEntry(selectedEntry.id, { status: 'executed' })}
                  className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-400"
                >
                  Mark executed
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-white/5 px-3 py-3 text-xs text-slate-300">Seller score {selectedEntry.sellerScore}</div>
              <div className="rounded-2xl bg-white/5 px-3 py-3 text-xs text-slate-300">Credit {fmtPnL(selectedEntry.expectedCredit)}</div>
              <div className="rounded-2xl bg-white/5 px-3 py-3 text-xs text-slate-300">Margin {fmtPnL(-selectedEntry.marginEstimate)}</div>
              <div className="rounded-2xl bg-white/5 px-3 py-3 text-xs text-slate-300">Max loss {fmtPnL(selectedEntry.maxLossEstimate)}</div>
            </div>

            <div className="mt-5 grid gap-3">
              <label className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Rationale</div>
                <textarea
                  value={selectedEntry.rationale}
                  onChange={(event) => updateEntry(selectedEntry.id, { rationale: event.target.value })}
                  rows={4}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-[#08101d] px-3 py-3 text-white outline-none"
                />
              </label>

              <div className="grid gap-3 lg:grid-cols-2">
                <label className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Invalidation</div>
                  <textarea
                    value={selectedEntry.invalidation}
                    onChange={(event) => updateEntry(selectedEntry.id, { invalidation: event.target.value })}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-[#08101d] px-3 py-3 text-white outline-none"
                  />
                </label>
                <label className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Adjustment plan</div>
                  <textarea
                    value={selectedEntry.adjustmentPlan}
                    onChange={(event) => updateEntry(selectedEntry.id, { adjustmentPlan: event.target.value })}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-[#08101d] px-3 py-3 text-white outline-none"
                  />
                </label>
              </div>

              <label className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  <BookCheck size={12} />
                  Playbook and exposure review
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl bg-[#08101d] px-3 py-3 text-xs text-slate-300">
                    <div className="text-slate-500">Playbook</div>
                    <div className="mt-1 text-white">{selectedEntry.playbookName ?? 'No direct playbook match'}</div>
                    <div className={`mt-2 ${selectedEntry.playbookCompliance === 'aligned' ? 'text-emerald-300' : selectedEntry.playbookCompliance === 'violates' ? 'text-red-300' : 'text-amber-300'}`}>
                      {selectedEntry.playbookCompliance}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-[#08101d] px-3 py-3 text-xs text-slate-300">
                    <div className="text-slate-500">Exposure context</div>
                    <div className="mt-1 text-white">{selectedEntry.exposureContext}</div>
                    <div className="mt-2 text-slate-500">Linked automation rules {selectedEntry.automationRuleIds.length}</div>
                  </div>
                </div>
              </label>

              <label className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Mistake tags</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {mistakeTagCatalog.map((tag) => {
                    const active = selectedEntry.mistakeTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleMistakeTag(selectedEntry.id, tag)}
                        className={`rounded-full px-3 py-2 text-xs transition ${active ? 'bg-red-500/20 text-red-200' : 'border border-white/10 bg-[#08101d] text-slate-300 hover:bg-white/10'}`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </label>

              <label className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Review notes</div>
                <textarea
                  value={selectedEntry.notes}
                  onChange={(event) => updateEntry(selectedEntry.id, { notes: event.target.value })}
                  rows={5}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-[#08101d] px-3 py-3 text-white outline-none"
                />
              </label>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/5 text-center text-sm text-slate-400">
            No journal entry selected.
          </div>
        )}
      </section>
    </div>
  );
}
