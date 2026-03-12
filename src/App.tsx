import { AppProviders } from './app/AppProviders';
import { AppShell } from './app/shell/AppShell';
import { useWorkspaceRoute } from './app/useWorkspaceRoute';

function AppRoot() {
  const { path, navigate } = useWorkspaceRoute();
  return <AppShell currentPath={path} onNavigate={navigate} />;
}

export function App() {
  return (
    <AppProviders>
      <AppRoot />
    </AppProviders>
  );
}
