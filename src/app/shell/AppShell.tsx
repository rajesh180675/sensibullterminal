import React, { Suspense, lazy, useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { ConnectBrokerModal } from '../../components/ConnectBrokerModal';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useSessionStore } from '../../domains/session/sessionStore';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { useLayoutStore } from '../../state/layout/layoutStore';
import { useTerminalStore } from '../../state/terminal/terminalStore';
import { CommandPalette } from './CommandPalette';
import { BottomDock } from './BottomDock';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceNav } from './WorkspaceNav';
import { WorkspaceSubnav } from './WorkspaceSubnav';
import { normalizeWorkspacePath, type WorkspacePath } from '../router';
import type { SymbolCode } from '../../types/index';

const MarketWorkspace = lazy(() => import('../workspaces/MarketWorkspace').then((module) => ({ default: module.MarketWorkspace })));
const StrategyWorkspace = lazy(() => import('../workspaces/StrategyWorkspace').then((module) => ({ default: module.StrategyWorkspace })));
const JournalWorkspace = lazy(() => import('../workspaces/JournalWorkspace').then((module) => ({ default: module.JournalWorkspace })));
const ExecutionWorkspace = lazy(() => import('../workspaces/ExecutionWorkspace').then((module) => ({ default: module.ExecutionWorkspace })));
const PortfolioWorkspace = lazy(() => import('../workspaces/PortfolioWorkspace').then((module) => ({ default: module.PortfolioWorkspace })));
const RiskWorkspace = lazy(() => import('../workspaces/RiskWorkspace').then((module) => ({ default: module.RiskWorkspace })));
const AutomationWorkspace = lazy(() => import('../workspaces/AutomationWorkspace').then((module) => ({ default: module.AutomationWorkspace })));
const ConnectionsWorkspace = lazy(() => import('../workspaces/ConnectionsWorkspace').then((module) => ({ default: module.ConnectionsWorkspace })));

const SHELL_LAYOUT_ID = 'shell-default';
const SHELL_WORKSPACE_ID = 'terminal-shell';
const SHELL_LAYOUT_NAME = 'Terminal Shell';

export function AppShell({
  currentPath,
  onNavigate,
}: {
  currentPath: WorkspacePath;
  onNavigate: (path: WorkspacePath) => void;
}) {
  const { legs } = useExecutionStore();
  const { symbol, setSymbol, refreshMarket, lastUpdate, liveIndices, spotTruth, chainTruth, stream } = useMarketStore();
  const activePath = useTerminalStore((state) => state.activePath);
  const activeSectionByPath = useTerminalStore((state) => state.activeSectionByPath);
  const linkedSymbol = useTerminalStore((state) => state.linkedSymbol);
  const stagedSourceId = useTerminalStore((state) => state.stagedSourceId);
  const setLinkedSymbol = useTerminalStore((state) => state.setLinkedSymbol);
  const hydrateWorkspaceState = useTerminalStore((state) => state.hydrateWorkspaceState);
  const snapshotWorkspaceState = useTerminalStore((state) => state.snapshotWorkspaceState);
  const commandPaletteOpen = useTerminalStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useTerminalStore((state) => state.setCommandPaletteOpen);
  const setKeyboardMode = useTerminalStore((state) => state.setKeyboardMode);
  const toggleCommandPalette = useTerminalStore((state) => state.toggleCommandPalette);
  const bottomDockOpen = useLayoutStore((state) => state.bottomDockOpen);
  const bottomDockHeight = useLayoutStore((state) => state.bottomDockHeight);
  const rightDrawerOpen = useLayoutStore((state) => state.rightDrawerOpen);
  const setBottomDockOpen = useLayoutStore((state) => state.setBottomDockOpen);
  const hydrateLayout = useLayoutStore((state) => state.hydrate);
  const snapshotLayout = useLayoutStore((state) => state.snapshot);
  const {
    session,
    showConnectionCenter,
    openConnectionCenter,
    closeConnectionCenter,
    connectSession,
  } = useSessionStore();
  const [layoutHydrated, setLayoutHydrated] = useState(false);

  const applyPersistedPanels = (panels: Record<string, unknown>) => {
    const nestedLayout = typeof panels.layout === 'object' && panels.layout && !Array.isArray(panels.layout)
      ? panels.layout as Record<string, unknown>
      : panels;
    hydrateLayout(nestedLayout);

    const nestedTerminal = typeof panels.terminal === 'object' && panels.terminal && !Array.isArray(panels.terminal)
      ? panels.terminal as Record<string, unknown>
      : panels;
    const nextPath = typeof nestedTerminal.activePath === 'string'
      ? normalizeWorkspacePath(nestedTerminal.activePath)
      : undefined;
    const nextSymbol = typeof nestedTerminal.linkedSymbol === 'string'
      ? nestedTerminal.linkedSymbol as SymbolCode
      : undefined;
    hydrateWorkspaceState({
      activePath: nextPath,
      activeSectionByPath: typeof nestedTerminal.activeSectionByPath === 'object' && nestedTerminal.activeSectionByPath && !Array.isArray(nestedTerminal.activeSectionByPath)
        ? nestedTerminal.activeSectionByPath as Record<WorkspacePath, string>
        : undefined,
      linkedSymbol: nextSymbol,
      stagedSourceId: typeof nestedTerminal.stagedSourceId === 'string' || nestedTerminal.stagedSourceId === null
        ? nestedTerminal.stagedSourceId as string | null
        : undefined,
    });
    if (nextSymbol) {
      setSymbol(nextSymbol);
      setLinkedSymbol(nextSymbol);
    }
    if (nextPath && nextPath !== currentPath) {
      onNavigate(nextPath);
    }
  };

  useEffect(() => {
    setLinkedSymbol(symbol);
  }, [setLinkedSymbol, symbol]);

  useEffect(() => {
    let cancelled = false;
    setLayoutHydrated(false);

    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) {
      setLayoutHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const result = await brokerGatewayClient.layout.fetch(session, SHELL_LAYOUT_ID);
      if (cancelled) return;
      if (result.ok && result.layout && !Array.isArray(result.layout.panels)) {
        applyPersistedPanels(result.layout.panels as Record<string, unknown>);
      }
      setLayoutHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateLayout, session]);

  useEffect(() => {
    if (!layoutHydrated || !session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) {
      return;
    }
    const timer = window.setTimeout(() => {
      const panels = snapshotLayout();
      const terminal = snapshotWorkspaceState();
      void brokerGatewayClient.layout.save(session, SHELL_LAYOUT_ID, {
        workspace_id: SHELL_WORKSPACE_ID,
        name: SHELL_LAYOUT_NAME,
        panels: {
          layout: panels as unknown as Record<string, unknown>,
          terminal,
        },
        is_default: true,
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    activePath,
    activeSectionByPath,
    bottomDockHeight,
    bottomDockOpen,
    layoutHydrated,
    linkedSymbol,
    rightDrawerOpen,
    session,
    snapshotLayout,
    snapshotWorkspaceState,
    stagedSourceId,
  ]);

  useEffect(() => {
    if (commandPaletteOpen) return;
    if (currentPath === '/market') {
      setKeyboardMode('chain');
      return;
    }
    if (currentPath === '/strategy' || currentPath === '/execution') {
      setKeyboardMode('ticket');
      return;
    }
    setKeyboardMode('normal');
  }, [commandPaletteOpen, currentPath, setKeyboardMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggleCommandPalette();
      }
      if (event.key === 'Escape' && commandPaletteOpen) {
        event.preventDefault();
        setCommandPaletteOpen(false);
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        onNavigate('/settings/connections');
        openConnectionCenter();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandPaletteOpen, onNavigate, openConnectionCenter, setCommandPaletteOpen, toggleCommandPalette]);

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

  const workspaceContent = (
    <Suspense
      fallback={(
        <div className="flex h-full items-center justify-center px-6 text-sm text-slate-400">
          Loading workspace...
        </div>
      )}
    >
      {content}
    </Suspense>
  );

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
              {workspaceContent}
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
