import React, { useEffect, useState } from 'react';
import ResultsTable from './components/ResultsTable';
import BenchmarkMatrix from './components/BenchmarkMatrix';
import FilterBar from './components/FilterBar';
import RunDetailsModal from './components/RunDetailsModal';
import { cn } from './lib/utils';
import { LayoutDashboard, Table as TableIcon, FlaskConical, Trophy } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './components/ui/card';

function App() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeTab, setActiveTab] = useState("benchmark");
  const [detailRun, setDetailRun] = useState(null);

  // Global Filters
  const [selectedParadigms, setSelectedParadigms] = useState(["inductive"]);
  const [selectedModalities, setSelectedModalities] = useState(["text", "audio", "vision", "graph", "tabular"]);
  const [selectedDataset, setSelectedDataset] = useState("all");

  useEffect(() => {
    // Correctly handle base path for GitHub Pages
    const dataUrl = `${import.meta.env.BASE_URL}data/results.json`.replace(/\/+/g, '/');
    fetch(dataUrl)
      .then(res => res.json())
      .then(data => {
        setRuns(data);
        setLoading(false);
        // Default select best 3 (prioritizing history presence)
        if (data.length > 0) {
          const hasHistory = data.filter(r => r.history && r.history.length > 0);
          const pool = hasHistory.length > 0 ? hasHistory : data;
          const sorted = [...pool].sort((a, b) => (b.test_accuracy || 0) - (a.test_accuracy || 0));
          setSelectedIds(sorted.slice(0, 3).map(r => r.run_id));
        }
      })
      .catch(err => {
        console.error("Failed to load data", err);
        setLoading(false);
      });
  }, []);

  // Compute available datasets dynamically
  const availableDatasets = React.useMemo(() => 
    Array.from(new Set(runs.map(r => r.dataset_id).filter(d => d))).sort(), 
  [runs]);

  // Filter runs based on global state
  const filteredRuns = runs.filter(r => {
    // Paradigm check
    const runParadigm = r.paradigm || "unknown";
    // If selectedParadigms is empty, show all? Or none? Let's assume show none if empty, but UI prevents empty.
    // Or if "unknown", maybe include if nothing strictly selected? 
    // Logic: check if runParadigm is in the selected list.
    const matchParadigm = selectedParadigms.includes(runParadigm);

    const runModality = r.modality || "unknown";
    const matchModality = selectedModalities.includes(runModality);
    
    const matchDataset = selectedDataset === "all" || r.dataset_id === selectedDataset;

    return matchParadigm && matchModality && matchDataset;
  });

  const selectedRuns = runs.filter(r => selectedIds.includes(r.run_id));

  // Compute stats
  const bestAcc = filteredRuns.length ? Math.max(...filteredRuns.map(r => r.test_accuracy || 0)) : 0;

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FlaskConical className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">ModSSC-Dashboard</h1>
              <p className="text-xs text-muted-foreground">Experiment Analysis</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground">Filtered Runs</span>
              <span className="font-mono font-bold">{filteredRuns.length} <span className="text-muted-foreground font-normal">/ {runs.length}</span></span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground">Best Accuracy (Filtered)</span>
              <span className="font-mono font-bold text-green-600">{(bestAcc * 100).toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">

        <FilterBar
          selectedParadigms={selectedParadigms}
          setSelectedParadigms={setSelectedParadigms}
          selectedModalities={selectedModalities}
          setSelectedModalities={setSelectedModalities}
          availableModalities={["text", "audio", "vision", "graph", "tabular"]}
          selectedDataset={selectedDataset}
          setSelectedDataset={setSelectedDataset}
          availableDatasets={availableDatasets}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex items-center justify-between">
            <TabsList className="grid w-full max-w-[400px] grid-cols-2">
              <TabsTrigger value="benchmark" className="flex gap-2">
                <Trophy className="w-4 h-4" /> Benchmark
              </TabsTrigger>
              <TabsTrigger value="explorer" className="flex gap-2">
                <TableIcon className="w-4 h-4" /> Explorer
              </TabsTrigger>
            </TabsList>
          </div>

          {/* TAB 0: BENCHMARK (Matrix) */}
          <TabsContent value="benchmark" className="space-y-4">
            <BenchmarkMatrix 
              runs={filteredRuns} 
              metric="test_accuracy" 
              onInspect={setDetailRun} 
            />
          </TabsContent>

          {/* TAB 1: EXPLORER (Table) */}
          <TabsContent value="explorer" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Experiment Results</CardTitle>
                <CardDescription>Full list of runs matching filters.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResultsTable 
                  runs={filteredRuns} 
                  selectedIds={selectedIds} 
                  onSelect={setSelectedIds} 
                  onInspect={setDetailRun}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <RunDetailsModal 
        run={detailRun} 
        isOpen={!!detailRun} 
        onClose={() => setDetailRun(null)} 
      />
    </div>
  );
}

export default App;
