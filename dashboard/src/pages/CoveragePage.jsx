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
import { CheckboxPills, EmptyState, LoadingOrError, PageHeader, Panel, PanelHeader } from '../components/AnalyticsLayout';
import { filterRuns, MODALITIES, PARADIGMS, REGIMES } from '../lib/benchmarkData';
import { METHOD_FAMILIES, familyColor } from '../lib/methodFamilies';

const CoverageTooltip = ({ active, payload, label, matrix }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-white p-3 text-xs shadow-lg">
      <div className="mb-2 font-semibold">{label}</div>
      <div className="space-y-2">
        {payload.map((entry) => {
          const cell = matrix.get(`${entry.name}|${label}`);
          if (!cell) return null;
          return (
            <div key={entry.name}>
              <div className="font-medium" style={{ color: entry.color }}>{entry.name}</div>
              <div>{cell.datasets.size} dataset{cell.datasets.size > 1 ? 's' : ''}</div>
              <div>{cell.methods.size} method{cell.methods.size > 1 ? 's' : ''}</div>
              <div className="mt-1 max-w-[260px] text-zinc-500">{[...cell.datasets].sort().join(', ')}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const modalityColors = {
  tabular: '#2563eb',
  text: '#16a34a',
  vision: '#d97706',
  audio: '#9333ea',
  graph: '#0891b2',
};

const CoveragePage = ({ data }) => {
  const [paradigms, setParadigms] = useState(PARADIGMS);
  const [families, setFamilies] = useState(METHOD_FAMILIES.filter((family) => family !== 'Other'));
  const [regimes, setRegimes] = useState(REGIMES);

  const filteredRuns = useMemo(
    () => filterRuns(data.successfulVisibleRuns, { paradigms, families, regimes }),
    [data.successfulVisibleRuns, paradigms, families, regimes]
  );

  const { chartData, matrix } = useMemo(() => {
    const coverage = new Map();
    filteredRuns.forEach((run) => {
      const key = `${run.modality}|${run.target_regime}`;
      if (!coverage.has(key)) coverage.set(key, { datasets: new Set(), methods: new Set(), runs: 0 });
      const cell = coverage.get(key);
      if (run.dataset_id) cell.datasets.add(run.dataset_id);
      if (run.method_id) cell.methods.add(run.method_id);
      cell.runs += 1;
    });

    const rows = regimes.map((regime) => {
      const row = { regime };
      MODALITIES.forEach((modality) => {
        row[modality] = coverage.get(`${modality}|${regime}`)?.datasets.size || 0;
      });
      return row;
    });

    return { chartData: rows, matrix: coverage };
  }, [filteredRuns, regimes]);

  return (
    <>
      <PageHeader
        title="Benchmark Coverage"
        description="Successful visible runs aggregated by modality and label regime. Bar height counts datasets; tooltip also shows method coverage."
        meta={`${filteredRuns.length} runs`}
      />
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      <div className="mb-6 grid gap-4">
        <Panel className="p-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <CheckboxPills label="Paradigm" values={PARADIGMS} selected={paradigms} onChange={setParadigms} />
            <CheckboxPills label="Regime" values={REGIMES} selected={regimes} onChange={setRegimes} />
            <CheckboxPills label="Family" values={METHOD_FAMILIES.filter((family) => family !== 'Other')} selected={families} onChange={setFamilies} />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Dataset Coverage By Regime" description="Stacked bars show how many visible datasets are represented for each modality." />
        {filteredRuns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="h-[420px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="regime" />
                <YAxis allowDecimals={false} />
                <Tooltip content={<CoverageTooltip matrix={matrix} />} />
                {MODALITIES.map((modality) => (
                  <Bar key={modality} dataKey={modality} stackId="coverage" fill={modalityColors[modality] || familyColor(modality)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel className="mt-6 overflow-hidden">
        <PanelHeader title="Coverage Matrix" description="Each cell reports dataset count / method count." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="p-3 text-left font-semibold">Modality</th>
                {regimes.map((regime) => <th key={regime} className="p-3 text-right font-semibold">{regime}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {MODALITIES.map((modality) => (
                <tr key={modality}>
                  <td className="p-3 font-medium">{modality}</td>
                  {regimes.map((regime) => {
                    const cell = matrix.get(`${modality}|${regime}`);
                    return (
                      <td key={regime} className="p-3 text-right font-mono">
                        {cell ? `${cell.datasets.size} / ${cell.methods.size}` : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
};

export default CoveragePage;
