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
import { filterRuns, MODALITIES, PARADIGMS, REGIMES } from '../lib/benchmarkData';
import { computeRankedRuns, formatNumber, mean } from '../lib/analytics';
import { METHOD_FAMILIES, familyColor } from '../lib/methodFamilies';

const families = METHOD_FAMILIES.filter((family) => !['Baseline', 'Other'].includes(family));

const FamiliesTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-white p-3 text-xs shadow-lg">
      <div className="mb-2 font-semibold">{label}</div>
      <div className="space-y-1">
        {payload
          .filter((entry) => entry.value !== null && entry.value !== undefined)
          .map((entry) => (
            <div key={entry.dataKey} className="flex items-center justify-between gap-4">
              <span style={{ color: entry.color }}>{entry.dataKey}</span>
              <span className="font-mono">
                {formatNumber(entry.value, 3)}
                {' '}({entry.payload[`${entry.dataKey}__n`] || 0} slices)
              </span>
            </div>
          ))}
      </div>
    </div>
  );
};

const FamiliesPage = ({ data }) => {
  const [modality, setModality] = useState('all');
  const [paradigm, setParadigm] = useState('all');

  const rankedRuns = useMemo(() => computeRankedRuns(data.successfulVisibleRuns), [data.successfulVisibleRuns]);

  const filteredRuns = useMemo(() => filterRuns(rankedRuns, {
    modalities: modality === 'all' ? null : [modality],
    paradigms: paradigm === 'all' ? null : [paradigm],
  }), [rankedRuns, modality, paradigm]);

  const chartData = useMemo(() => REGIMES.map((regime) => {
    const row = { regime };
    families.forEach((family) => {
      const rows = filteredRuns.filter((run) => run.target_regime === regime && run.family === family);
      const values = rows.map((run) => run.normalized_rank).filter((value) => Number.isFinite(value));
      row[family] = values.length ? mean(values) : null;
      row[`${family}__n`] = new Set(rows.map((run) => run.slice_key)).size;
    });
    return row;
  }), [filteredRuns]);

  return (
    <>
      <PageHeader
        title="Family & Regime Performance"
        description="Mean normalized rank by analytical family. Ranks are computed within dataset × regime × paradigm × modality slices; lower is better."
        meta={`${filteredRuns.length} ranked runs`}
      />
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      <Panel className="mb-6 p-4">
        <div className="flex flex-wrap gap-4">
          <SelectField label="Modality" value={modality} onChange={setModality} options={MODALITIES} />
          <SelectField label="Paradigm" value={paradigm} onChange={setParadigm} options={PARADIGMS} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Normalized Rank By Regime"
          description="Missing segments mean no successful visible coverage for that family under the selected filters."
        />
        {filteredRuns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="h-[460px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="regime" />
                <YAxis domain={[0, 1]} tickFormatter={(value) => value.toFixed(1)} />
                <Tooltip content={<FamiliesTooltip />} />
                <Legend />
                {families.map((family) => (
                  <Line
                    key={family}
                    type="monotone"
                    dataKey={family}
                    stroke={familyColor(family)}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </>
  );
};

export default FamiliesPage;
