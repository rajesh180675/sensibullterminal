import React, { useEffect, useState } from 'react';
import { ConnectBrokerModal } from '../../components/ConnectBrokerModal';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useSessionStore } from '../../domains/session/sessionStore';
import { CommandPalette } from './CommandPalette';
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
  const { symbol, setSymbol, refreshMarket, lastUpdate, liveIndices } = useMarketStore();
  const {
    session,
    showConnectionCenter,
    statusMessage,
    isLive,
    openConnectionCenter,
    closeConnectionCenter,
    connectSession,
  } = useSessionStore();
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        onNavigate('/settings/connections');
        openConnectionCenter();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNavigate, openConnectionCenter]);

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
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.08),transparent_20%),linear-gradient(180deg,#04090f,#07111b_34%,#06111a)] p-3 text-white">
      <div className="flex h-full gap-3">
        <WorkspaceNav
          currentPath={currentPath}
          onNavigate={onNavigate}
          strategyLegCount={legs.length}
          isLive={isLive}
          statusMessage={statusMessage}
          onOpenConnections={() => {
            onNavigate('/settings/connections');
            openConnectionCenter();
          }}
        />

        <div className="flex min-w-0 flex-1 overflow-hidden rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,20,34,0.95),rgba(6,12,20,0.92))] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
          <div className="flex min-w-0 flex-1 flex-col">
            <WorkspaceHeader
              currentPath={currentPath}
              symbol={symbol}
              onSymbolChange={setSymbol}
              onOpenConnections={() => {
                onNavigate('/settings/connections');
                openConnectionCenter();
              }}
              onRefresh={() => void refreshMarket()}
              statusMessage={statusMessage}
              isLive={isLive}
              lastUpdate={lastUpdate}
              liveIndices={liveIndices}
            />
            <WorkspaceSubnav currentPath={currentPath} />
            <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-[linear-gradient(180deg,rgba(7,14,23,0.2),rgba(7,14,23,0.68))]">
              {content}
            </main>
          </div>
        </div>
      </div>

      <CommandPalette
        open={commandOpen}
        currentPath={currentPath}
        onClose={() => setCommandOpen(false)}
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
