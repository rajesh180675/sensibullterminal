import { useEffect, useState } from 'react';
import { PanelsTopLeft } from 'lucide-react';
import { WORKSPACE_ROUTE_BY_PATH, type WorkspacePath } from '../router';

function readHash() {
  return window.location.hash.replace(/^#/, '');
}

export function WorkspaceSubnav({ currentPath }: { currentPath: WorkspacePath }) {
  const route = WORKSPACE_ROUTE_BY_PATH[currentPath];
  const sections = route.sections;
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    const syncFromHash = () => {
      const hash = readHash();
      setActiveSection(hash || sections[0]?.id || '');
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [currentPath, sections]);

  if (sections.length === 0) {
    return null;
  }

  const navigateToSection = (id: string) => {
    setActiveSection(id);
    const nextUrl = `${window.location.pathname}#${id}`;
    window.history.replaceState({}, '', nextUrl);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="border-b border-white/8 bg-[#0a1421]/90 px-5 py-3 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-[0.24em] text-slate-400">
          <PanelsTopLeft size={12} />
          Submenu
        </div>
        {sections.map((section) => {
          const active = activeSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => navigateToSection(section.id)}
              className={`rounded-full px-4 py-2 text-sm transition ${
                active
                  ? 'bg-orange-500 text-white shadow-[0_10px_30px_rgba(249,115,22,0.28)]'
                  : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
