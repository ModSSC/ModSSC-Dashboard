import React, { useMemo, useState } from 'react';
import BenchmarkMatrix from '../components/BenchmarkMatrix';
import FilterBar from '../components/FilterBar';
import RunDetailsModal from '../components/RunDetailsModal';
import { LoadingOrError } from '../components/AnalyticsLayout';
import { cn } from '../lib/utils';
import { getRunDatasetId, getRunLabeledCount } from '../lib/dataset';
import { normalizeRegime, regimeOrder, isRunError } from '../lib/benchmarkData';

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

const getModalityLabel = (modality) => (modality === 'vision' ? 'image' : modality);

const BenchmarkPage = ({ data }) => {
  const [detailRun, setDetailRun] = useState(null);
  const [selectedRegime, setSelectedRegime] = useState(null);
  const [selectedParadigms, setSelectedParadigms] = useState(['inductive', 'transductive']);
  const [selectedModalities, setSelectedModalities] = useState(['text', 'audio', 'vision', 'graph', 'tabular']);
  const [selectedDataset, setSelectedDataset] = useState('all');

  const regimeOptions = useMemo(
    () => deriveRegimeOptionsFromRuns(data.visibleRuns),
    [data.visibleRuns]
  );

  const effectiveRegime = useMemo(() => {
    if (regimeOptions.length === 0) return null;
    if (regimeOptions.some((option) => option.regime === selectedRegime)) return selectedRegime;
    const defaultRegime = normalizeRegime(data.manifest?.default_regime);
    if (regimeOptions.some((option) => option.regime === defaultRegime)) return defaultRegime;
    return regimeOptions[0].regime;
  }, [selectedRegime, regimeOptions, data.manifest]);

  const regimeRuns = useMemo(() => {
    if (!effectiveRegime) return [];
    return data.visibleRuns.filter((run) => normalizeRegime(run.target_regime) === effectiveRegime);
  }, [effectiveRegime, data.visibleRuns]);

  const methodsWithErrors = useMemo(() => {
    const methods = new Set();
    regimeRuns.forEach((run) => {
      if (isRunError(run) && run?.method_id) methods.add(run.method_id);
    });
    return methods;
  }, [regimeRuns]);

  // Preserve existing leaderboard behavior: a method is removed for the regime if any visible run failed.
  const errorFreeRegimeRuns = useMemo(
    () => regimeRuns.filter((run) => !methodsWithErrors.has(run?.method_id)),
    [regimeRuns, methodsWithErrors]
  );

  const availableDatasets = useMemo(
    () => Array.from(new Set(errorFreeRegimeRuns.map((run) => getRunDatasetId(run)).filter((d) => d))).sort(),
    [errorFreeRegimeRuns]
  );

  const effectiveDataset = selectedDataset === 'all' || availableDatasets.includes(selectedDataset)
    ? selectedDataset
    : 'all';

  const filteredRuns = useMemo(() => errorFreeRegimeRuns.filter((run) => {
    const matchParadigm = selectedParadigms.includes(run.paradigm || 'unknown');
    const matchModality = selectedModalities.includes(run.modality || 'unknown');
    const matchDataset = effectiveDataset === 'all' || getRunDatasetId(run) === effectiveDataset;
    return matchParadigm && matchModality && matchDataset;
  }), [errorFreeRegimeRuns, selectedParadigms, selectedModalities, effectiveDataset]);

  const singleSelectedModality = selectedModalities.length === 1 ? selectedModalities[0] : null;
  const singleModalityStats = useMemo(() => {
    if (!singleSelectedModality) return null;
    const uniqueDatasets = new Set();
    filteredRuns.forEach((run) => {
      if (run?.dataset_id) uniqueDatasets.add(run.dataset_id);
    });
    return {
      modality: singleSelectedModality,
      runCount: filteredRuns.length,
      datasetCount: uniqueDatasets.size,
    };
  }, [singleSelectedModality, filteredRuns]);

  return (
    <>
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      <div className="mb-4 flex justify-end gap-4">
        <div className="flex flex-col items-end">
          <span className="text-xs text-muted-foreground">Filtered Runs</span>
          <span className="font-mono font-bold">
            {filteredRuns.length}
            <span className="font-normal text-muted-foreground"> / {errorFreeRegimeRuns.length}</span>
          </span>
        </div>
        {singleModalityStats && (
          <div className="flex flex-col items-end">
            <span className="text-xs text-muted-foreground">
              Evaluation ({getModalityLabel(singleModalityStats.modality)})
            </span>
            <span className="font-mono font-bold">
              {singleModalityStats.datasetCount}
              <span className="font-normal text-muted-foreground">
                {' '}dataset{singleModalityStats.datasetCount > 1 ? 's' : ''}, {singleModalityStats.runCount} run{singleModalityStats.runCount > 1 ? 's' : ''}
              </span>
            </span>
          </div>
        )}
      </div>

      <FilterBar
        selectedParadigms={selectedParadigms}
        setSelectedParadigms={setSelectedParadigms}
        selectedModalities={selectedModalities}
        setSelectedModalities={setSelectedModalities}
        availableModalities={['text', 'audio', 'vision', 'graph', 'tabular']}
        selectedDataset={effectiveDataset}
        setSelectedDataset={setSelectedDataset}
        availableDatasets={availableDatasets}
      />

      <div className="mb-6 flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Regime cible
        </span>
        <div className="flex flex-wrap gap-2">
          {regimeOptions.map(({ regime, labelCount }) => (
            <button
              key={regime}
              type="button"
              onClick={() => setSelectedRegime(regime)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                effectiveRegime === regime
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-input bg-background text-foreground hover:bg-muted'
              )}
            >
              {labelCount === null ? regime : `${regime} (${labelCount} label${labelCount > 1 ? 's' : ''})`}
            </button>
          ))}
        </div>
      </div>

      <BenchmarkMatrix runs={filteredRuns} metric="test_accuracy" onInspect={setDetailRun} />

      <RunDetailsModal
        run={detailRun}
        isOpen={!!detailRun}
        onClose={() => setDetailRun(null)}
      />
    </>
  );
};

export default BenchmarkPage;
