import React, { useEffect, useState } from 'react';
import { ConnectBrokerModal } from '../../components/ConnectBrokerModal';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useSessionStore } from '../../domains/session/sessionStore';
import { BottomDock } from './BottomDock';
import { CommandPalette } from './CommandPalette';
import { RightDrawer } from './RightDrawer';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceNav } from './WorkspaceNav';
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
    <div className="flex h-screen bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.08),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.08),transparent_24%),#050a12] text-white">
      <WorkspaceNav currentPath={currentPath} onNavigate={onNavigate} strategyLegCount={legs.length} />

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

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-hidden">{content}</main>
          <RightDrawer />
        </div>

        <BottomDock />
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
