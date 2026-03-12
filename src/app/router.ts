export const WORKSPACE_ROUTES = [
  { path: '/market', label: 'Market', shortLabel: 'MKT' },
  { path: '/strategy', label: 'Strategy', shortLabel: 'STR' },
  { path: '/execution', label: 'Execution', shortLabel: 'EXE' },
  { path: '/portfolio', label: 'Portfolio', shortLabel: 'PFO' },
  { path: '/risk', label: 'Risk', shortLabel: 'RSK' },
  { path: '/automation', label: 'Automation', shortLabel: 'AUTO' },
  { path: '/settings/connections', label: 'Connections', shortLabel: 'SET' },
] as const;

export type WorkspacePath = typeof WORKSPACE_ROUTES[number]['path'];

const validPaths = new Set<string>(WORKSPACE_ROUTES.map((route) => route.path));

export function normalizeWorkspacePath(pathname: string): WorkspacePath {
  return validPaths.has(pathname) ? pathname as WorkspacePath : '/market';
}
