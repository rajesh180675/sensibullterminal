import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useTerminalStore } from '../../state/terminal/terminalStore';
import { WORKSPACE_ROUTES, type WorkspacePath } from '../router';

export function CommandPalette({
  currentPath,
  onNavigate,
  onOpenConnections,
}: {
  currentPath: WorkspacePath;
  onNavigate: (path: WorkspacePath) => void;
  onOpenConnections: () => void;
}) {
  const open = useTerminalStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useTerminalStore((state) => state.setCommandPaletteOpen);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const commands = useMemo(() => {
    const base = WORKSPACE_ROUTES.map((route) => ({
      id: route.path,
      label: route.label,
      action: () => onNavigate(route.path),
    }));

    const connectionCommand = {
      id: 'connection-center',
      label: 'Open Connection Center',
      action: onOpenConnections,
    };

    return [...base, connectionCommand].filter((command) =>
      command.label.toLowerCase().includes(query.toLowerCase())
    );
  }, [query, onNavigate, onOpenConnections]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-24 backdrop-blur-sm" onClick={() => setCommandPaletteOpen(false)}>
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0b1321] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
          <Search size={16} className="text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to market, strategy, execution, portfolio..."
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>

        <div className="mt-3 space-y-2">
          {commands.map((command) => (
            <button
              key={command.id}
              onClick={() => {
                command.action();
                setCommandPaletteOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                command.id === currentPath ? 'bg-orange-500 text-white' : 'bg-white/5 text-slate-200 hover:bg-white/10'
              }`}
            >
              <span>{command.label}</span>
              <span className="text-xs opacity-60">enter</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
