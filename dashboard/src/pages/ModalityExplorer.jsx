import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckboxPills, EmptyState, LoadingOrError, PageHeader, Panel, PanelHeader, SelectField } from '../components/AnalyticsLayout';
import { MODALITIES, REGIMES, filterRuns, runAccuracy } from '../lib/benchmarkData';
import { aggregateBy, computeRankedRuns, formatNumber, formatPct, getSeedStd, mean, uniqueSorted } from '../lib/analytics';
import { METHOD_FAMILIES, familyColor } from '../lib/methodFamilies';

const modalityLabels = {
  tabular: 'Tabular',
  text: 'Text',
  vision: 'Vision',
  audio: 'Audio',
  graph: 'Graph',
};

const families = METHOD_FAMILIES.filter((family) => family !== 'Other');

const ModalityExplorer = ({ data }) => {
  const [modality, setModality] = useState('tabular');
  const [selectedRegimes, setSelectedRegimes] = useState(REGIMES);
  const [selectedFamilies, setSelectedFamilies] = useState(families);
  const [chartMode, setChartMode] = useState('family');
  const [comparisonMethod, setComparisonMethod] = useState('all');
  const [showExperimental, setShowExperimental] = useState(false);

  const rankedRuns = useMemo(() => computeRankedRuns(data.successfulVisibleRuns), [data.successfulVisibleRuns]);

  const modalityRuns = useMemo(() => filterRuns(rankedRuns, {
    modalities: [modality],
    regimes: selectedRegimes,
    families: selectedFamilies,
  }), [rankedRuns, modality, selectedRegimes, selectedFamilies]);

  const methodRows = useMemo(() => aggregateBy(
    modalityRuns,
    (run) => run.method_id,
    runAccuracy
  ).map((group) => {
    const rows = group.rows;
    const rankValues = rows.map((run) => run.normalized_rank).filter((value) => Number.isFinite(value));
    const seedStdValues = rows.map(getSeedStd).filter((value) => value !== null);
    return {
      method: group.key,
      family: rows[0]?.family,
      datasets: new Set(rows.map((run) => run.dataset_id)).size,
      avgAccuracy: group.mean,
      meanRank: mean(rankValues),
      seedStd: mean(seedStdValues),
      runs: rows.length,
    };
  }).sort((a, b) => {
    if (a.family !== b.family) return String(a.family).localeCompare(String(b.family));
    return (a.meanRank ?? 1) - (b.meanRank ?? 1);
  }), [modalityRuns]);

  const datasets = useMemo(() => uniqueSorted(modalityRuns.map((run) => run.dataset_id)), [modalityRuns]);
  const topMethods = useMemo(() => methodRows.slice(0, 8).map((row) => row.method), [methodRows]);
  const series = chartMode === 'family'
    ? selectedFamilies.filter((family) => modalityRuns.some((run) => run.family === family))
    : topMethods;

  const datasetChartData = useMemo(() => datasets.map((dataset) => {
    const row = { dataset };
    series.forEach((serie) => {
      const rows = modalityRuns.filter((run) => run.dataset_id === dataset && (
        chartMode === 'family' ? run.family === serie : run.method_id === serie
      ));
      row[serie] = mean(rows.map(runAccuracy).filter((value) => value !== null));
    });
    return row;
  }), [datasets, series, modalityRuns, chartMode]);

  const comparisonMethods = useMemo(() => uniqueSorted(data.successfulVisibleRuns.map((run) => run.method_id)), [data.successfulVisibleRuns]);
  const radarData = useMemo(() => {
    if (comparisonMethod === 'all') return [];
    return MODALITIES.map((currentModality) => {
      const runs = data.successfulVisibleRuns.filter((run) => run.method_id === comparisonMethod && run.modality === currentModality);
      return {
        modality: modalityLabels[currentModality] || currentModality,
        accuracy: mean(runs.map(runAccuracy).filter((value) => value !== null)) || 0,
        runs: runs.length,
      };
    }).filter((row) => row.runs > 0);
  }, [comparisonMethod, data.successfulVisibleRuns]);

  const experimentalRows = useMemo(() => methodRows
    .filter((row) => row.datasets <= 1 || row.runs < 6)
    .slice(0, 25), [methodRows]);

  return (
    <>
      <PageHeader
        title="Modality Explorer"
        description="Inspect method compatibility and performance patterns within a selected modality, then compare one method across modalities."
        meta={`${modalityRuns.length} runs`}
      />
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      <Panel className="mb-6 p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modality</span>
            <div className="flex flex-wrap gap-2">
              {MODALITIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setModality(item)}
                  className={item === modality
                    ? 'rounded-md border border-foreground bg-foreground px-3 py-1.5 text-sm text-background'
                    : 'rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted'}
                >
                  {modalityLabels[item]}
                </button>
              ))}
            </div>
          </div>
          <SelectField label="Dataset chart view" value={chartMode} onChange={setChartMode} allLabel={null} options={[
            { value: 'family', label: 'Per-family' },
            { value: 'method', label: 'Per-method' },
          ]} />
          <CheckboxPills label="Regime" values={REGIMES} selected={selectedRegimes} onChange={setSelectedRegimes} />
          <CheckboxPills label="Family" values={families} selected={selectedFamilies} onChange={setSelectedFamilies} />
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title={`${modalityLabels[modality]} Methods`} description="Methods compatible with the selected modality, grouped by analytical family." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="p-3 text-left font-semibold">Family</th>
                <th className="p-3 text-left font-semibold">Method</th>
                <th className="p-3 text-right font-semibold">Datasets</th>
                <th className="p-3 text-right font-semibold">Runs</th>
                <th className="p-3 text-right font-semibold">Avg acc.</th>
                <th className="p-3 text-right font-semibold">Mean rank</th>
                <th className="p-3 text-right font-semibold">Seed std</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {methodRows.map((row) => (
                <tr key={row.method}>
                  <td className="p-3" style={{ color: familyColor(row.family) }}>{row.family}</td>
                  <td className="p-3 font-medium">{row.method}</td>
                  <td className="p-3 text-right font-mono">{row.datasets}</td>
                  <td className="p-3 text-right font-mono">{row.runs}</td>
                  <td className="p-3 text-right font-mono">{formatPct(row.avgAccuracy)}</td>
                  <td className="p-3 text-right font-mono">{formatNumber(row.meanRank, 3)}</td>
                  <td className="p-3 text-right font-mono">{row.seedStd === null ? '-' : formatPct(row.seedStd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="Dataset Performance" description={`Series are ${chartMode === 'family' ? 'families' : 'top methods'} within ${modalityLabels[modality]}.`} />
        {datasetChartData.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="h-[420px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={datasetChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="dataset" interval={0} angle={-20} textAnchor="end" height={72} />
                <YAxis domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                <Tooltip formatter={(value) => formatPct(value)} />
                {series.map((serie) => (
                  <Bar key={serie} dataKey={serie} fill={chartMode === 'family' ? familyColor(serie) : '#2563eb'} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelHeader
          title="Cross-Modality Comparison"
          description="Choose one method to see where it has successful visible runs."
          actions={<SelectField label="Method" value={comparisonMethod} onChange={setComparisonMethod} options={comparisonMethods} />}
        />
        {radarData.length === 0 ? (
          <EmptyState>Choose a method with cross-modality coverage.</EmptyState>
        ) : (
          <div className="h-[360px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="modality" />
                <PolarRadiusAxis domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                <Tooltip formatter={(value, name, props) => [formatPct(value), `${name} (${props.payload.runs} runs)`]} />
                <Radar dataKey="accuracy" name={comparisonMethod} fill="#2563eb" stroke="#2563eb" fillOpacity={0.22} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel className="mt-6 overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between border-b px-4 py-3 text-left"
          onClick={() => setShowExperimental((value) => !value)}
        >
          <span>
            <span className="font-semibold">Experimental</span>
            <span className="ml-2 text-xs text-amber-700">Preliminary low-coverage method/modality combinations</span>
          </span>
          <span className="text-sm text-muted-foreground">{showExperimental ? 'Hide' : 'Show'}</span>
        </button>
        {showExperimental && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {experimentalRows.map((row) => (
                  <tr key={row.method}>
                    <td className="p-3 font-medium">{row.method}</td>
                    <td className="p-3">{row.family}</td>
                    <td className="p-3 text-right font-mono">{row.datasets} dataset{row.datasets > 1 ? 's' : ''}</td>
                    <td className="p-3 text-right font-mono">{row.runs} run{row.runs > 1 ? 's' : ''}</td>
                    <td className="p-3 text-right font-mono">{formatPct(row.avgAccuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
};

export default ModalityExplorer;
