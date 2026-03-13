export type WorkspaceGroup = 'Trade Desk' | 'Book and Controls' | 'System';

export const WORKSPACE_ROUTES = [
  {
    path: '/market',
    label: 'Market',
    shortLabel: 'MKT',
    group: 'Trade Desk',
    title: 'Market Terminal',
    subtitle: 'Option chain first. Quotes, depth, candles, and seller context in one market canvas.',
    sections: [
      { id: 'market-overview', label: 'Overview' },
      { id: 'market-chain', label: 'Option Chain' },
      { id: 'market-depth', label: 'Depth' },
      { id: 'market-ideas', label: 'Seller Ideas' },
    ],
  },
  {
    path: '/strategy',
    label: 'Strategy',
    shortLabel: 'STR',
    group: 'Trade Desk',
    title: 'Strategy Lab',
    subtitle: 'Seller opportunities, builder templates, and playbook-guided staging.',
    sections: [
      { id: 'strategy-regime', label: 'Regime' },
      { id: 'strategy-ideas', label: 'Ideas' },
      { id: 'strategy-builder', label: 'Builder' },
      { id: 'strategy-playbooks', label: 'Playbooks' },
    ],
  },
  {
    path: '/execution',
    label: 'Execution',
    shortLabel: 'EXE',
    group: 'Trade Desk',
    title: 'Execution Desk',
    subtitle: 'Preview, fees, slippage, and broker-routed order handling for staged structures.',
    sections: [],
  },
  {
    path: '/portfolio',
    label: 'Portfolio',
    shortLabel: 'PFO',
    group: 'Book and Controls',
    title: 'Portfolio Cockpit',
    subtitle: 'Linked positions, orders, trades, and funds across the active seller book.',
    sections: [],
  },
  {
    path: '/risk',
    label: 'Risk',
    shortLabel: 'RSK',
    group: 'Book and Controls',
    title: 'Risk Console',
    subtitle: 'Margin, Greeks, repair ideas, and scenario pressure on open seller positions.',
    sections: [],
  },
  {
    path: '/automation',
    label: 'Automation',
    shortLabel: 'AUTO',
    group: 'Book and Controls',
    title: 'Automation Center',
    subtitle: 'Rules, callbacks, trigger evaluation, and disciplined seller automation workflows.',
    sections: [],
  },
  {
    path: '/journal',
    label: 'Journal',
    shortLabel: 'JNL',
    group: 'Book and Controls',
    title: 'Journal and Review',
    subtitle: 'Rationale capture, playbook compliance, and post-trade seller analytics.',
    sections: [],
  },
  {
    path: '/settings/connections',
    label: 'Connections',
    shortLabel: 'SET',
    group: 'System',
    title: 'Connection Center',
    subtitle: 'Broker session health, backend diagnostics, and capability visibility.',
    sections: [],
  },
] as const;

export type WorkspacePath = typeof WORKSPACE_ROUTES[number]['path'];
export type WorkspaceRoute = typeof WORKSPACE_ROUTES[number];

const validPaths = new Set<string>(WORKSPACE_ROUTES.map((route) => route.path));

export const WORKSPACE_ROUTE_BY_PATH = Object.fromEntries(
  WORKSPACE_ROUTES.map((route) => [route.path, route]),
) as Record<WorkspacePath, WorkspaceRoute>;

export const WORKSPACE_GROUPS = (['Trade Desk', 'Book and Controls', 'System'] as const).map((group) => ({
  group,
  routes: WORKSPACE_ROUTES.filter((route) => route.group === group),
}));

export function normalizeWorkspacePath(pathname: string): WorkspacePath {
  return validPaths.has(pathname) ? pathname as WorkspacePath : '/market';
}
