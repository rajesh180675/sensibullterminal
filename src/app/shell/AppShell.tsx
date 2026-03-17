import React, { useEffect } from 'react';
import { ChevronUp } from 'lucide-react';
import { ConnectBrokerModal } from '../../components/ConnectBrokerModal';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useSessionStore } from '../../domains/session/sessionStore';
import { useSelectionStore } from '../../state/selections/selectionStore';
import { useLayoutStore } from '../../state/layout/layoutStore';
import { useTerminalUiStore } from '../../state/terminal/terminalUiStore';
import { CommandPalette } from './CommandPalette';
import { BottomDock } from './BottomDock';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceNav } from './WorkspaceNav';
import { WorkspaceSubnav } from './WorkspaceSubnav';
import { type WorkspacePath } from '../router';
import { MarketWorkspace } from '../workspaces/MarketWorkspace';
import { StrategyWorkspace } from '../workspaces/StrategyWorkspace';
import { JournalWorkspace } from '../workspaces/JournalWorkspace';
import { ExecutionWorkspace } from '../workspaces/ExecutionWorkspace';
import { PortfolioWorkspace } from '../workspaces/PortfolioWorkspace';
import { RiskWorkspace } from '../workspaces/RiskWorkspace';
import { AutomationWorkspace } from '../workspaces/AutomationWorkspace';
import { ConnectionsWorkspace } from '../workspaces/ConnectionsWorkspace';

export function AppShell({
  currentPath,
  onNavigate,
}: {
  currentPath: WorkspacePath;
  onNavigate: (path: WorkspacePath) => void;
}) {
  const { legs } = useExecutionStore();
  const { symbol, setSymbol, refreshMarket, lastUpdate, liveIndices, spotTruth, chainTruth, stream } = useMarketStore();
  const setLinkedSymbol = useSelectionStore((state) => state.setLinkedSymbol);
  const toggleCommandPalette = useTerminalUiStore((state) => state.toggleCommandPalette);
  const bottomDockOpen = useLayoutStore((state) => state.bottomDockOpen);
  const setBottomDockOpen = useLayoutStore((state) => state.setBottomDockOpen);
  const {
    session,
    showConnectionCenter,
    openConnectionCenter,
    closeConnectionCenter,
    connectSession,
  } = useSessionStore();

  useEffect(() => {
    setLinkedSymbol(symbol);
  }, [setLinkedSymbol, symbol]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggleCommandPalette();
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        onNavigate('/settings/connections');
        openConnectionCenter();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNavigate, openConnectionCenter, toggleCommandPalette]);

  let content: React.ReactNode;
  switch (currentPath) {
    case '/market':
      content = <MarketWorkspace onOpenStrategy={() => onNavigate('/strategy')} />;
      break;
    case '/strategy':
      content = <StrategyWorkspace />;
      break;
    case '/journal':
      content = <JournalWorkspace />;
      break;
    case '/execution':
      content = <ExecutionWorkspace onOpenStrategy={() => onNavigate('/strategy')} />;
      break;
    case '/portfolio':
      content = <PortfolioWorkspace onOpenStrategy={() => onNavigate('/strategy')} />;
      break;
    case '/risk':
      content = <RiskWorkspace />;
      break;
    case '/automation':
      content = <AutomationWorkspace />;
      break;
    case '/settings/connections':
      content = <ConnectionsWorkspace onOpenConnections={openConnectionCenter} />;
      break;
    default:
      content = <MarketWorkspace onOpenStrategy={() => onNavigate('/strategy')} />;
  }

  return (
    <div className="relative h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.08),transparent_20%),linear-gradient(180deg,#04090f,#07111b_34%,#06111a)] p-3 text-white">
      <div className="flex h-full gap-3">
        <WorkspaceNav
          currentPath={currentPath}
          onNavigate={onNavigate}
          strategyLegCount={legs.length}
          isLive={stream.mode !== 'simulated'}
          statusMessage={stream.detail}
          onOpenConnections={() => {
            onNavigate('/settings/connections');
            openConnectionCenter();
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,20,34,0.95),rgba(6,12,20,0.92))] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
          <div className="flex min-w-0 flex-1 flex-col">
            <WorkspaceHeader
              currentPath={currentPath}
              symbol={symbol}
              onSymbolChange={(nextSymbol) => {
                setSymbol(nextSymbol);
                setLinkedSymbol(nextSymbol);
              }}
              onOpenConnections={() => {
                onNavigate('/settings/connections');
                openConnectionCenter();
              }}
              onRefresh={() => void refreshMarket()}
              statusMessage={stream.detail}
              statusTruth={stream.truth}
              isLive={stream.mode === 'live'}
              streamLabel={stream.label}
              lastUpdate={lastUpdate}
              liveIndices={liveIndices}
              spotTruth={spotTruth}
              chainTruth={chainTruth}
            />
            <WorkspaceSubnav currentPath={currentPath} />
            <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-[linear-gradient(180deg,rgba(7,14,23,0.2),rgba(7,14,23,0.68))]">
              {content}
            </main>
          </div>
          {bottomDockOpen && <BottomDock />}
        </div>
      </div>

      {!bottomDockOpen && (
        <button
          onClick={() => setBottomDockOpen(true)}
          className="absolute bottom-5 right-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0b1421]/92 px-4 py-2 text-sm text-slate-200 shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition hover:bg-[#101b2b]"
        >
          <ChevronUp size={14} />
          Open dock
        </button>
      )}

      <CommandPalette
        currentPath={currentPath}
        onNavigate={onNavigate}
        onOpenConnections={() => {
          onNavigate('/settings/connections');
          openConnectionCenter();
        }}
      />

      {showConnectionCenter && (
        <ConnectBrokerModal
          onClose={closeConnectionCenter}
          onConnected={(nextSession) => void connectSession(nextSession)}
          session={session}
        />
      )}
    </div>
  );
}
