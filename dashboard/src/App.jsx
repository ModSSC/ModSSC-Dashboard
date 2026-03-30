import React, { useEffect, useMemo, useState } from 'react';
import BenchmarkMatrix from './components/BenchmarkMatrix';
import FilterBar from './components/FilterBar';
import RunDetailsModal from './components/RunDetailsModal';
import { cn } from './lib/utils';
import { getRunLabeledCount } from './lib/dataset';
import logoImage from './assets/logo.jpeg';

const buildDataUrl = (relativePath) => {
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
  const cleanPath = String(relativePath || '').replace(/^\/+/, '');
  return `${baseUrl}/${cleanPath}`;
};

const normalizeRegime = (value) => {
  const regime = String(value ?? '').trim().toUpperCase();
  return regime || null;
};

const regimeOrder = (regime) => {
  const match = /^R(\d+)$/i.exec(regime || '');
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

const deriveRegimeOptionsFromRuns = (runs) => {
  const byRegime = new Map();

  runs.forEach((run) => {
    const regime = normalizeRegime(run.target_regime);
    if (!regime) return;

    if (!byRegime.has(regime)) {
      byRegime.set(regime, { runCount: 0, votes: new Map() });
    }

    const bucket = byRegime.get(regime);
    bucket.runCount += 1;

    const labeledCount = getRunLabeledCount(run);
    if (labeledCount === null) return;
    const key = String(Math.round(labeledCount));
    bucket.votes.set(key, (bucket.votes.get(key) || 0) + 1);
  });

  return [...byRegime.keys()]
    .sort((a, b) => {
      const aOrder = regimeOrder(a);
      const bOrder = regimeOrder(b);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    })
    .map((regime) => {
      const { runCount, votes } = byRegime.get(regime);
      let labelCount = null;
      let bestFreq = -1;

      votes.forEach((freq, key) => {
        const value = Number(key);
        if (freq > bestFreq || (freq === bestFreq && (labelCount === null || value < labelCount))) {
          bestFreq = freq;
          labelCount = value;
        }
      });

      return { regime, labelCount, runCount };
    });
};

function App() {
  const [manifest, setManifest] = useState(null);
  const [legacyRuns, setLegacyRuns] = useState([]);
  const [runsByRegime, setRunsByRegime] = useState({});
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [detailRun, setDetailRun] = useState(null);
  const [selectedRegime, setSelectedRegime] = useState(null);

  // Global Filters
  const [selectedParadigms, setSelectedParadigms] = useState(["inductive"]);
  const [selectedModalities, setSelectedModalities] = useState(["text", "audio", "vision", "graph", "tabular"]);
  const [selectedDataset, setSelectedDataset] = useState("all");

  useEffect(() => {
    let isCancelled = false;

    const loadData = async () => {
      setIsBootLoading(true);
      setDataError(null);

      try {
        const manifestResponse = await fetch(buildDataUrl('data/results-manifest.json'), { cache: 'no-store' });
        if (manifestResponse.ok) {
          const loadedManifest = await manifestResponse.json();
          if (!isCancelled) {
            setManifest(loadedManifest);
            setLegacyRuns([]);
            setRunsByRegime({});
          }
          return;
        }
      } catch (err) {
        console.warn('Manifest load failed, trying legacy results.json', err);
      }

      try {
        const legacyResponse = await fetch(buildDataUrl('data/results.json'), { cache: 'no-store' });
        if (!legacyResponse.ok) {
          throw new Error(`HTTP ${legacyResponse.status}`);
        }
        const loadedRuns = await legacyResponse.json();
        if (!isCancelled) {
          setManifest(null);
          setLegacyRuns(Array.isArray(loadedRuns) ? loadedRuns : []);
          setRunsByRegime({});
        }
      } catch (err) {
        console.error("Failed to load dashboard data", err);
        if (!isCancelled) {
          setManifest(null);
          setLegacyRuns([]);
          setRunsByRegime({});
          setDataError('Unable to load benchmark data.');
        }
      } finally {
        if (!isCancelled) {
          setIsBootLoading(false);
        }
      }
    };

    loadData();
    return () => {
      isCancelled = true;
    };
  }, []);

  const regimeOptions = useMemo(() => {
    const chunks = manifest?.chunks;
    if (Array.isArray(chunks) && chunks.length > 0) {
      return chunks
        .map((chunk) => ({
          regime: normalizeRegime(chunk?.regime),
          labelCount: Number.isFinite(Number(chunk?.label_count)) ? Number(chunk.label_count) : null,
          runCount: Number.isFinite(Number(chunk?.run_count)) ? Number(chunk.run_count) : 0,
        }))
        .filter((option) => option.regime)
        .sort((a, b) => {
          const aOrder = regimeOrder(a.regime);
          const bOrder = regimeOrder(b.regime);
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.regime.localeCompare(b.regime);
        });
    }
    return deriveRegimeOptionsFromRuns(legacyRuns);
  }, [manifest, legacyRuns]);

  useEffect(() => {
    if (regimeOptions.length === 0) {
      if (selectedRegime !== null) {
        setSelectedRegime(null);
      }
      return;
    }

    const hasSelectedRegime = regimeOptions.some((option) => option.regime === selectedRegime);
    if (!hasSelectedRegime) {
      const defaultRegime = normalizeRegime(manifest?.default_regime);
      const fallback = regimeOptions[0].regime;
      const nextRegime = regimeOptions.some((option) => option.regime === defaultRegime)
        ? defaultRegime
        : fallback;
      setSelectedRegime(nextRegime);
    }
  }, [selectedRegime, regimeOptions, manifest]);

  useEffect(() => {
    if (!manifest || !selectedRegime || runsByRegime[selectedRegime]) {
      return;
    }

    const chunk = (manifest.chunks || []).find(
      (entry) => normalizeRegime(entry?.regime) === selectedRegime
    );
    if (!chunk?.path) {
      setRunsByRegime((prev) => ({ ...prev, [selectedRegime]: [] }));
      return;
    }

    let isCancelled = false;
    const loadChunk = async () => {
      try {
        const response = await fetch(buildDataUrl(chunk.path), { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (!isCancelled) {
          setRunsByRegime((prev) => ({
            ...prev,
            [selectedRegime]: Array.isArray(payload) ? payload : [],
          }));
        }
      } catch (err) {
        console.error(`Failed to load chunk for ${selectedRegime}`, err);
        if (!isCancelled) {
          setRunsByRegime((prev) => ({ ...prev, [selectedRegime]: [] }));
          setDataError(`Unable to load data for ${selectedRegime}.`);
        }
      }
    };

    loadChunk();
    return () => {
      isCancelled = true;
    };
  }, [manifest, selectedRegime, runsByRegime]);

  const regimeRuns = useMemo(() => {
    if (!selectedRegime) return [];
    if (manifest) return runsByRegime[selectedRegime] || [];
    return legacyRuns.filter((run) => normalizeRegime(run.target_regime) === selectedRegime);
  }, [selectedRegime, manifest, runsByRegime, legacyRuns]);

  const selectedRegimeMeta = useMemo(
    () => regimeOptions.find((option) => option.regime === selectedRegime) || null,
    [regimeOptions, selectedRegime]
  );
  const regimeTotalRuns = selectedRegimeMeta?.runCount ?? regimeRuns.length;

  // Compute available datasets dynamically
  const availableDatasets = useMemo(
    () => Array.from(new Set(regimeRuns.map((r) => r.dataset_id).filter((d) => d))).sort(),
    [regimeRuns]
  );

  // Filter runs based on global state
  const runsAfterMainFilters = useMemo(() => regimeRuns.filter(r => {
    // Paradigm check
    const runParadigm = r.paradigm || "unknown";
    const matchParadigm = selectedParadigms.includes(runParadigm);

    const runModality = r.modality || "unknown";
    const matchModality = selectedModalities.includes(runModality);
    
    const matchDataset = selectedDataset === "all" || r.dataset_id === selectedDataset;

    return matchParadigm && matchModality && matchDataset;
  }), [regimeRuns, selectedParadigms, selectedModalities, selectedDataset]);

  const filteredRuns = runsAfterMainFilters;
  const isChunkLoading = Boolean(manifest && selectedRegime && !runsByRegime[selectedRegime]);
  const isLoading = isBootLoading || isChunkLoading;

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <img src={logoImage} alt="ModSSC" className="h-6 w-6 rounded object-cover" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">ModSSC-Dashboard</h1>
              <p className="text-xs text-muted-foreground">Experiment Analysis</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground">Filtered Runs</span>
              <span className="font-mono font-bold">{filteredRuns.length} <span className="text-muted-foreground font-normal">/ {regimeTotalRuns}</span></span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {isLoading && (
          <div className="mb-4 text-sm text-muted-foreground">Loading benchmark data...</div>
        )}
        {dataError && (
          <div className="mb-4 text-sm text-red-600">{dataError}</div>
        )}

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

        <div className="flex flex-col gap-2 p-4 border rounded-xl bg-card text-card-foreground shadow-sm mb-6">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Régime cible
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {regimeOptions.map(({ regime, labelCount }) => (
              <button
                key={regime}
                type="button"
                onClick={() => setSelectedRegime(regime)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md border transition-colors",
                  selectedRegime === regime
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-input hover:bg-muted"
                )}
              >
                {labelCount === null
                  ? regime
                  : `${regime} (${labelCount} label${labelCount > 1 ? 's' : ''})`}
              </button>
            ))}
          </div>
        </div>

        <BenchmarkMatrix 
          runs={filteredRuns} 
          metric="test_accuracy" 
          onInspect={setDetailRun} 
        />
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
