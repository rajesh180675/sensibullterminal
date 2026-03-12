import { useEffect, useState } from 'react';
import { normalizeWorkspacePath, type WorkspacePath } from './router';

export function useWorkspaceRoute() {
  const [path, setPath] = useState<WorkspacePath>(() => normalizeWorkspacePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPath(normalizeWorkspacePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextPath: WorkspacePath) => {
    if (nextPath === path) return;
    window.history.pushState({}, '', nextPath);
    setPath(nextPath);
  };

  return { path, navigate };
}
