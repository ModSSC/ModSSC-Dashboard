import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, LoadingOrError, PageHeader, Panel, PanelHeader, SelectField } from '../components/AnalyticsLayout';
import { REGIMES, runAccuracy, toFiniteNumber } from '../lib/benchmarkData';
import { formatPct, groupBy, mean, uniqueSorted } from '../lib/analytics';
import { METHOD_FAMILIES, familyColor } from '../lib/methodFamilies';

const preferredDatasets = ['adult', 'ag_news', 'cifar10', 'imdb', 'mnist', 'cora'];

const CaseStudiesPage = ({ data }) => {
  const availableDatasets = useMemo(() => {
    const existing = uniqueSorted(data.successfulVisibleRuns.map((run) => run.dataset_id));
    const preferred = preferredDatasets.filter((dataset) => existing.includes(dataset));
    const extras = existing.filter((dataset) => !preferred.includes(dataset));
    return [...preferred, ...extras];
  }, [data.successfulVisibleRuns]);

  const [dataset, setDataset] = useState(preferredDatasets[0]);
  const [view, setView] = useState('family');
  const [highlight, setHighlight] = useState('all');

  React.useEffect(() => {
    if (!availableDatasets.length) return;
    if (!availableDatasets.includes(dataset)) setDataset(availableDatasets[0]);
  }, [availableDatasets, dataset]);

  const datasetRuns = useMemo(
    () => data.successfulVisibleRuns.filter((run) => run.dataset_id === dataset),
    [data.successfulVisibleRuns, dataset]
  );

  const topMethods = useMemo(() => {
    const methodGroups = groupBy(datasetRuns, (run) => run.method_id);
    return [...methodGroups.entries()]
      .map(([method, runs]) => ({ method, score: mean(runs.map(runAccuracy).filter((value) => value !== null)) }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => entry.method);
  }, [datasetRuns]);

  const series = view === 'family'
    ? METHOD_FAMILIES.filter((family) => !['Other'].includes(family))
    : topMethods;

  const chartData = useMemo(() => REGIMES.map((regime) => {
    const row = { regime };
    series.forEach((serie) => {
      const rows = datasetRuns.filter((run) => run.target_regime === regime && (
        view === 'family' ? run.family === serie : run.method_id === serie
      ));
      row[serie] = mean(rows.map(runAccuracy).filter((value) => value !== null));
      row[`${serie}__n`] = rows.length;
    });
    return row;
  }), [datasetRuns, series, view]);

  const protocolRows = useMemo(() => datasetRuns
    .map((run) => ({
      regime: run.target_regime,
      paradigm: run.paradigm,
      method: run.method_id,
      family: run.family,
      labeled: toFiniteNumber(run.train_labeled_n),
      labelingValue: run['sampling.labeling.value'],
      classFilter: Array.isArray(run['dataset.options.class_filter'])
        ? run['dataset.options.class_filter'].join(', ')
        : run['dataset.options.class_filter'],
      accuracy: runAccuracy(run),
    }))
    .sort((a, b) => {
      if (a.regime !== b.regime) return a.regime.localeCompare(b.regime);
      return (b.accuracy || 0) - (a.accuracy || 0);
    })
    .slice(0, 40), [datasetRuns]);

  const highlightOptions = ['all', ...series].map((item) => ({ value: item, label: item === 'all' ? 'All series' : item }));

  return (
    <>
      <PageHeader
        title="Case Studies"
        description="Representative datasets tracked across label regimes. The chart compares families or top methods for one selected dataset."
        meta={`${datasetRuns.length} runs`}
      />
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      <Panel className="mb-6 p-4">
        <div className="flex flex-wrap gap-4">
          <SelectField label="Dataset" value={dataset} onChange={setDataset} allLabel={null} options={availableDatasets} />
          <SelectField label="View" value={view} onChange={setView} allLabel={null} options={[
            { value: 'family', label: 'Family' },
            { value: 'method', label: 'Top methods' },
          ]} />
          <SelectField label="Highlight" value={highlight} onChange={setHighlight} allLabel={null} options={highlightOptions} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={`Accuracy Across Regimes: ${dataset}`} description="Y-axis is test accuracy. Missing points indicate no successful visible run." />
        {datasetRuns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="h-[440px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="regime" />
                <YAxis domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                <Tooltip formatter={(value, name, props) => [formatPct(value), `${name} (${props.payload[`${name}__n`] || 0} runs)`]} />
                <Legend />
                {series.map((serie) => {
                  const dim = highlight !== 'all' && highlight !== serie;
                  return (
                    <Line
                      key={serie}
                      type="monotone"
                      dataKey={serie}
                      stroke={view === 'family' ? familyColor(serie) : '#2563eb'}
                      strokeWidth={dim ? 1 : 2.5}
                      strokeOpacity={dim ? 0.25 : 1}
                      dot={{ r: dim ? 2 : 3 }}
                      connectNulls={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel className="mt-6 overflow-hidden">
        <PanelHeader title="Protocol Details" description="Compact protocol fields from the public run summaries." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="p-3 text-left font-semibold">Regime</th>
                <th className="p-3 text-left font-semibold">Paradigm</th>
                <th className="p-3 text-left font-semibold">Method</th>
                <th className="p-3 text-left font-semibold">Family</th>
                <th className="p-3 text-right font-semibold">Labels</th>
                <th className="p-3 text-right font-semibold">Label value</th>
                <th className="p-3 text-left font-semibold">Class filter</th>
                <th className="p-3 text-right font-semibold">Accuracy</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {protocolRows.map((row, index) => (
                <tr key={`${row.regime}-${row.method}-${index}`}>
                  <td className="p-3 font-mono">{row.regime}</td>
                  <td className="p-3">{row.paradigm}</td>
                  <td className="p-3 font-medium">{row.method}</td>
                  <td className="p-3">{row.family}</td>
                  <td className="p-3 text-right font-mono">{row.labeled ?? '-'}</td>
                  <td className="p-3 text-right font-mono">{row.labelingValue ?? '-'}</td>
                  <td className="p-3">{row.classFilter || '-'}</td>
                  <td className="p-3 text-right font-mono">{formatPct(row.accuracy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
};

export default CaseStudiesPage;
