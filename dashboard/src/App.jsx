import React from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import BenchmarkPage from './pages/BenchmarkPage';
import CoveragePage from './pages/CoveragePage';
import FamiliesPage from './pages/FamiliesPage';
import VariabilityPage from './pages/VariabilityPage';
import CaseStudiesPage from './pages/CaseStudiesPage';
import PipelinesPage from './pages/PipelinesPage';
import DesignVariabilityPage from './pages/DesignVariabilityPage';
import ModalityExplorer from './pages/ModalityExplorer';
import PerformancePage from './pages/PerformancePage';
import { useBenchmarkData } from './lib/benchmarkData';
import { cn } from './lib/utils';
import logoImage from './assets/logo.jpeg';

const navItems = [
  { to: '/', label: 'Matrix', end: true },
  { to: '/coverage', label: 'Coverage' },
  { to: '/families', label: 'Families' },
  { to: '/variability', label: 'Seed Variability' },
  { to: '/performance', label: 'Performance & Hardware' },
  { to: '/case-studies', label: 'Case Studies' },
  { to: '/pipelines', label: 'Pipelines' },
  { to: '/variability-design', label: 'Design Variability' },
  { to: '/modality', label: 'Modality Explorer' },
];

const appBasename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

function AppShell() {
  const data = useBenchmarkData();

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="border-b bg-card">
        <div className="container mx-auto flex flex-col gap-4 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <img src={logoImage} alt="ModSSC" className="h-6 w-6 rounded object-cover" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">ModSSC-Dashboard</h1>
                <p className="text-xs text-muted-foreground">Experiment Analysis</p>
              </div>
            </div>
            <div className="hidden flex-col items-end sm:flex">
              <span className="text-xs text-muted-foreground">Successful Visible Runs</span>
              <span className="font-mono font-bold">
                {data.successfulVisibleRuns.length}
                <span className="font-normal text-muted-foreground"> / {data.allRuns.length}</span>
              </span>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Dashboard sections">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn(
                  'whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input bg-background text-foreground hover:bg-muted'
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<BenchmarkPage data={data} />} />
          <Route path="/coverage" element={<CoveragePage data={data} />} />
          <Route path="/families" element={<FamiliesPage data={data} />} />
          <Route path="/variability" element={<VariabilityPage data={data} />} />
          <Route path="/performance" element={<PerformancePage data={data} />} />
          <Route path="/case-studies" element={<CaseStudiesPage data={data} />} />
          <Route path="/pipelines" element={<PipelinesPage data={data} />} />
          <Route path="/variability-design" element={<DesignVariabilityPage data={data} />} />
          <Route path="/modality" element={<ModalityExplorer data={data} />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter basename={appBasename}>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
