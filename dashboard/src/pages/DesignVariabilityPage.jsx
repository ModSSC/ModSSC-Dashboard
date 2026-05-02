import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, LoadingOrError, PageHeader, Panel, PanelHeader, SelectField } from '../components/AnalyticsLayout';
import { filterRuns, MODALITIES, PARADIGMS, toFiniteNumber } from '../lib/benchmarkData';
import { groupBy, uniqueSorted } from '../lib/analytics';

const axisFields = [
  { axis: 'run parameters', field: 'seed_count', label: 'seed_count' },
  { axis: 'dataset options', field: 'dataset_id', label: 'dataset.id' },
  { axis: 'dataset options', field: 'dataset.options.class_filter', label: 'dataset.options.class_filter' },
  { axis: 'sampling', field: 'sampling.split.kind', label: 'sampling.split.kind' },
  { axis: 'sampling', field: 'sampling.labeling.mode', label: 'sampling.labeling.mode' },
  { axis: 'sampling', field: 'sampling.labeling.value', label: 'sampling.labeling.value' },
  { axis: 'sampling', field: 'sampling.labeling.strategy', label: 'sampling.labeling.strategy' },
  { axis: 'preprocessing', field: 'preprocess.cache', label: 'preprocess.cache' },
  { axis: 'preprocessing', field: 'preprocess.fit_on', label: 'preprocess.fit_on' },
  { axis: 'preprocessing', field: 'preprocess.steps', label: 'preprocess.steps' },
  { axis: 'views', field: 'method.model.classifier_id', label: 'method.model.classifier_id' },
  { axis: 'graph', field: 'sampling.policy.use_official_graph_masks', label: 'sampling.policy.use_official_graph_masks' },
  { axis: 'augmentation', field: 'augmentation.enabled', label: 'augmentation.enabled' },
  { axis: 'augmentation', field: 'augmentation.weak.steps', label: 'augmentation.weak.steps' },
  { axis: 'augmentation', field: 'augmentation.strong.steps', label: 'augmentation.strong.steps' },
  { axis: 'evaluation', field: 'evaluation.metrics', label: 'evaluation.metrics' },
  { axis: 'evaluation', field: 'evaluation.report_splits', label: 'evaluation.report_splits' },
  { axis: 'limits', field: 'limits.profile', label: 'limits.profile' },
  { axis: 'search', field: 'run_kind', label: 'run_kind' },
];

const normalizeValue = (value) => {
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const valueDistribution = (runs, field) => {
  const counts = new Map();
  runs.forEach((run) => {
    const key = normalizeValue(run[field]);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const DesignVariabilityPage = ({ data }) => {
  const [modality, setModality] = useState('all');
  const [paradigm, setParadigm] = useState('all');
  const [dataset, setDataset] = useState('all');

  const datasetOptions = useMemo(
    () => uniqueSorted(data.successfulVisibleRuns.map((run) => run.dataset_id)),
    [data.successfulVisibleRuns]
  );

  const filteredRuns = useMemo(() => filterRuns(data.successfulVisibleRuns, {
    modalities: modality === 'all' ? null : [modality],
    paradigms: paradigm === 'all' ? null : [paradigm],
    datasets: dataset === 'all' ? null : [dataset],
  }), [data.successfulVisibleRuns, modality, paradigm, dataset]);

  const axisRows = useMemo(() => axisFields.map((axisField) => {
    const distribution = valueDistribution(filteredRuns, axisField.field);
    const values = distribution.map(([value]) => value);
    return {
      ...axisField,
      distinct: values.length,
      fixed: values.length <= 1,
      topValues: distribution.slice(0, 4),
    };
  }), [filteredRuns]);

  const labelBudgetData = useMemo(() => {
    const groups = groupBy(filteredRuns, (run) => {
      const labeled = toFiniteNumber(run.train_labeled_n) ?? toFiniteNumber(run['sampling.labeling.value']);
      return labeled === null ? null : String(labeled);
    });
    return [...groups.entries()]
      .map(([labelBudget, runs]) => ({ labelBudget, runs: runs.length }))
      .sort((a, b) => Number(a.labelBudget) - Number(b.labelBudget));
  }, [filteredRuns]);

  const classFilterData = useMemo(() => {
    const groups = groupBy(filteredRuns, (run) => normalizeValue(run['dataset.options.class_filter']));
    return [...groups.entries()]
      .map(([classFilter, runs]) => ({ classFilter, runs: runs.length }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 12);
  }, [filteredRuns]);

  return (
    <>
      <PageHeader
        title="Non-Method Variability"
        description="Benchmark design axes outside the method: dataset, sampling, preprocessing, views, graph construction, augmentation, evaluation, limits and search."
        meta={`${filteredRuns.length} runs`}
      />
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      <Panel className="mb-6 p-4">
        <div className="flex flex-wrap gap-4">
          <SelectField label="Modality" value={modality} onChange={setModality} options={MODALITIES} />
          <SelectField label="Paradigm" value={paradigm} onChange={setParadigm} options={PARADIGMS} />
          <SelectField label="Dataset" value={dataset} onChange={setDataset} options={datasetOptions} />
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title="Schema-Level Degrees Of Freedom" description="Fixed fields are constant under current filters; varying fields affect cross-run comparability." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="p-3 text-left font-semibold">Axis</th>
                <th className="p-3 text-left font-semibold">Field</th>
                <th className="p-3 text-right font-semibold">Distinct</th>
                <th className="p-3 text-left font-semibold">Status</th>
                <th className="p-3 text-left font-semibold">Observed values</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {axisRows.map((row) => (
                <tr key={row.field}>
                  <td className="p-3">{row.axis}</td>
                  <td className="p-3 font-mono text-xs">{row.label}</td>
                  <td className="p-3 text-right font-mono">{row.distinct}</td>
                  <td className="p-3">
                    <span className={row.fixed ? 'text-green-700' : 'text-amber-700'}>
                      {row.fixed ? 'effectively fixed' : 'varies'}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-zinc-600">
                    {row.topValues.length
                      ? row.topValues.map(([value, count]) => `${value} (${count})`).join(' · ')
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Label Budget Distribution" />
          {labelBudgetData.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="h-[300px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={labelBudgetData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="labelBudget" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="runs" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Class Filtering Distribution" />
          {classFilterData.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="h-[300px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={classFilterData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="classFilter" interval={0} angle={-20} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="runs" fill="#9333ea" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
};

export default DesignVariabilityPage;
