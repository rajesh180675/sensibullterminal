import { Bell, ChevronDown, Layers3, Logs } from 'lucide-react';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useLayoutStore } from '../../state/layout/layoutStore';
import { useNotificationStore } from '../../stores/notificationStore';

export function BottomDock() {
  const { legs } = useExecutionStore();
  const { items, dismiss } = useNotificationStore();
  const bottomDockHeight = useLayoutStore((state) => state.bottomDockHeight);
  const setBottomDockOpen = useLayoutStore((state) => state.setBottomDockOpen);
  const latest = items.slice(0, 3);

  return (
    <footer
      className="border-t border-white/8 bg-[#08111f]/95 px-6 py-3 backdrop-blur-xl"
      style={{ minHeight: `${bottomDockHeight}px` }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.26em] text-slate-500">Bottom Dock</div>
        <button
          onClick={() => setBottomDockOpen(false)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
        >
          <ChevronDown size={12} />
          Collapse
        </button>
      </div>
      <div className="grid gap-3 xl:grid-cols-[220px,220px,1fr]">
        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
            <Layers3 size={12} />
            Builder
          </div>
          <div className="mt-2 text-sm text-white">{legs.length} active strategy legs</div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
            <Logs size={12} />
            Workflow
          </div>
          <div className="mt-2 text-sm text-slate-300">Market -&gt; Strategy -&gt; Execution -&gt; Portfolio</div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
            <Bell size={12} />
            Notifications
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {latest.length === 0 && <span className="text-sm text-slate-500">No notifications yet.</span>}
            {latest.map((item) => (
              <button
                key={item.id}
                onClick={() => dismiss(item.id)}
                className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-left text-xs text-slate-300"
                title={item.message}
              >
                <div className="font-semibold text-white">{item.title}</div>
                <div className="mt-1 max-w-[320px] truncate">{item.message}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
