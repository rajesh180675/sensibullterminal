import { useEffect } from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { AppProviders } from './app/AppProviders';
import { normalizeWorkspacePath } from './app/router';
import { AppShell } from './app/shell/AppShell';
import { useTerminalStore } from './state/terminal/terminalStore';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';

function AppRoot() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = normalizeWorkspacePath(location.pathname);
  const setActivePath = useTerminalStore((state) => state.setActivePath);

  useGlobalKeyboard();

  useEffect(() => {
    setActivePath(currentPath);
  }, [currentPath, setActivePath]);

  useEffect(() => {
    if (location.pathname !== currentPath) {
      navigate(`${currentPath}${location.hash}`, { replace: true });
    }
  }, [currentPath, location.hash, location.pathname, navigate]);

  return <AppShell currentPath={currentPath} onNavigate={(path) => navigate(path)} />;
}

export function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoot />
      </AppProviders>
    </BrowserRouter>
  );
}
