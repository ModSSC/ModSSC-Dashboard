import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckboxPills, EmptyState, LoadingOrError, PageHeader, Panel, PanelHeader, SelectField } from '../components/AnalyticsLayout';
import { buildDataUrl, filterRuns, MODALITIES, REGIMES, toFiniteNumber } from '../lib/benchmarkData';
import { mean, quantile } from '../lib/analytics';
import { METHOD_FAMILIES, familyColor } from '../lib/methodFamilies';

const benchmarkFamilies = METHOD_FAMILIES.filter((family) => !['Baseline', 'Other'].includes(family));

const runtimeSeconds = (run) => toFiniteNumber(
  run?.run_time_seconds ??
  run?.run_time_seconds_mean ??
  run?.duration_s
);

const formatDuration = (value) => {
  const seconds = toFiniteNumber(value);
  if (seconds === null) return '-';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
};

const hardwareOptionsForRuns = (runs) => {
  const gpuDevices = new Set();
  const profiles = new Set();

  runs.forEach((run) => {
    if (run.gpu_device) gpuDevices.add(run.gpu_device);
    if (run.hardware_profile || run['limits.profile']) {
      profiles.add(run.hardware_profile || run['limits.profile']);
    }
  });

  return [
    ...[...gpuDevices].sort().map((device) => ({
      value: `gpu:${device}`,
      label: `GPU: ${device}`,
    })),
    ...[...profiles].sort().map((profile) => ({
      value: `profile:${profile}`,
      label: `Profile: ${profile}`,
    })),
  ];
};

const matchesHardware = (run, hardware) => {
  if (hardware === 'all') return true;
  const [kind, ...rest] = hardware.split(':');
  const value = rest.join(':');
  if (kind === 'gpu') return run.gpu_device === value;
  if (kind === 'profile') return (run.hardware_profile || run['limits.profile']) === value;
  return true;
};

const RuntimeTooltip = ({ active, payload, label }) => {
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
                {formatDuration(entry.value)}
                {' '}({entry.payload[`${entry.dataKey}__n`] || 0} runs)
              </span>
            </div>
          ))}
      </div>
    </div>
  );
};

const RuntimeBoxPlot = ({ groups }) => {
  const width = Math.max(760, groups.length * 92);
  const height = 340;
  const margin = { top: 24, right: 24, bottom: 86, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...groups.map((group) => group.max || 0));
  const y = (value) => margin.top + plotHeight - (value / maxValue) * plotHeight;

  return (
    <div className="overflow-x-auto p-4">
      <svg width={width} height={height} role="img" aria-label="Runtime distribution box plot">
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#d4d4d8" />
        <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="#d4d4d8" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = maxValue * tick;
          return (
            <g key={tick}>
              <line x1={margin.left - 4} y1={y(value)} x2={margin.left + plotWidth} y2={y(value)} stroke="#f4f4f5" />
              <text x={margin.left - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="#71717a">
                {formatDuration(value)}
              </text>
            </g>
          );
        })}
        {groups.map((group, index) => {
          const x = margin.left + (index + 0.5) * (plotWidth / groups.length);
          const boxWidth = Math.min(44, plotWidth / groups.length - 18);
          const color = familyColor(group.family);
          return (
            <g key={group.label}>
              <line x1={x} y1={y(group.min)} x2={x} y2={y(group.max)} stroke={color} strokeWidth="2" />
              <line x1={x - boxWidth / 3} y1={y(group.min)} x2={x + boxWidth / 3} y2={y(group.min)} stroke={color} strokeWidth="2" />
              <line x1={x - boxWidth / 3} y1={y(group.max)} x2={x + boxWidth / 3} y2={y(group.max)} stroke={color} strokeWidth="2" />
              <rect
                x={x - boxWidth / 2}
                y={y(group.q3)}
                width={boxWidth}
                height={Math.max(1, y(group.q1) - y(group.q3))}
                fill={color}
                fillOpacity="0.16"
                stroke={color}
              />
              <line x1={x - boxWidth / 2} y1={y(group.median)} x2={x + boxWidth / 2} y2={y(group.median)} stroke={color} strokeWidth="2" />
              <circle cx={x} cy={y(group.mean)} r="3" fill={color} />
              <text x={x} y={height - 52} textAnchor="end" transform={`rotate(-35 ${x} ${height - 52})`} fontSize="11" fill="#3f3f46">
                {group.label}
              </text>
              <text x={x} y={height - 14} textAnchor="middle" fontSize="10" fill="#71717a">
                n={group.count}
              </text>
            </g>
          );
        })}
        <text x={18} y={margin.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 18 ${margin.top + plotHeight / 2})`} fontSize="12" fill="#52525b">
          runtime
        </text>
      </svg>
    </div>
  );
};

const summarizeRuntimeGroups = (runs) => {
  const groups = new Map();
  runs.forEach((run) => {
    const runtime = runtimeSeconds(run);
    if (runtime === null || !run.method_id) return;
    if (!groups.has(run.method_id)) groups.set(run.method_id, { family: run.family, values: [] });
    groups.get(run.method_id).values.push(runtime);
  });

  return [...groups.entries()]
    .map(([label, group]) => ({
      label,
      family: group.family,
      count: group.values.length,
      min: Math.min(...group.values),
      q1: quantile(group.values, 0.25),
      median: quantile(group.values, 0.5),
      q3: quantile(group.values, 0.75),
      max: Math.max(...group.values),
      mean: mean(group.values),
    }))
    .sort((a, b) => {
      const familyCmp = String(a.family).localeCompare(String(b.family));
      if (familyCmp !== 0) return familyCmp;
      return (b.mean || 0) - (a.mean || 0);
    });
};

const PerformancePage = ({ data }) => {
  const [selectedFamilies, setSelectedFamilies] = useState(benchmarkFamilies);
  const [selectedRegimes, setSelectedRegimes] = useState(REGIMES);
  const [modality, setModality] = useState('all');
  const [hardware, setHardware] = useState('all');
  const [excludeMismatches, setExcludeMismatches] = useState(true);

  const runtimeRuns = useMemo(
    () => data.successfulVisibleRuns.filter((run) => runtimeSeconds(run) !== null),
    [data.successfulVisibleRuns]
  );

  const mismatchRuns = useMemo(
    () => runtimeRuns.filter((run) => run.hardware_mismatch === true),
    [runtimeRuns]
  );

  const hardwareOptions = useMemo(() => hardwareOptionsForRuns(runtimeRuns), [runtimeRuns]);

  const filteredRuns = useMemo(() => {
    const comparableRuns = excludeMismatches
      ? runtimeRuns.filter((run) => run.hardware_mismatch !== true)
      : runtimeRuns;

    return filterRuns(comparableRuns, {
      families: selectedFamilies,
      regimes: selectedRegimes,
      modalities: modality === 'all' ? null : [modality],
    }).filter((run) => matchesHardware(run, hardware));
  }, [runtimeRuns, selectedFamilies, selectedRegimes, modality, hardware, excludeMismatches]);

  const chartData = useMemo(() => REGIMES.map((regime) => {
    const row = { regime };
    benchmarkFamilies.forEach((family) => {
      const values = filteredRuns
        .filter((run) => run.target_regime === regime && run.family === family)
        .map(runtimeSeconds)
        .filter((value) => value !== null);
      row[family] = values.length ? mean(values) : null;
      row[`${family}__n`] = values.length;
    });
    return row;
  }), [filteredRuns]);

  const boxGroups = useMemo(() => summarizeRuntimeGroups(filteredRuns), [filteredRuns]);

  return (
    <>
      <PageHeader
        title="Performance & Hardware"
        description="Runtime and hardware metadata for successful visible runs. Runtime is wall-clock seconds from run_info, or derived from started_at/finished_at when needed."
        meta={`${filteredRuns.length} comparable runs`}
      />
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      {mismatchRuns.length > 0 && (
        <Panel className="mb-6 border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-col gap-1">
            <div className="font-semibold text-amber-900">{mismatchRuns.length} hardware mismatches flagged</div>
            <p className="text-sm text-amber-900/80">
              These runs remain inspectable below and are excluded from charts while "Exclude mismatches" is enabled.
            </p>
          </div>
        </Panel>
      )}

      <Panel className="mb-6 p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <CheckboxPills label="Family" values={benchmarkFamilies} selected={selectedFamilies} onChange={setSelectedFamilies} />
          <CheckboxPills label="Regime" values={REGIMES} selected={selectedRegimes} onChange={setSelectedRegimes} />
          <SelectField label="Modality" value={modality} onChange={setModality} options={MODALITIES} />
          <SelectField label="Hardware" value={hardware} onChange={setHardware} options={hardwareOptions} allLabel="All hardware" />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={excludeMismatches}
              onChange={(event) => setExcludeMismatches(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Exclude hardware mismatches
          </label>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Mean Runtime By Family"
          description="Mean wall-clock runtime per regime. Bars are coloured by analytical family; tooltips include contributing run counts."
        />
        {filteredRuns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="h-[460px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="regime" />
                <YAxis tickFormatter={formatDuration} width={64} />
                <Tooltip content={<RuntimeTooltip />} />
                <Legend />
                {benchmarkFamilies.map((family) => (
                  <Bar key={family} dataKey={family} fill={familyColor(family)} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelHeader
          title="Runtime Distribution By Method"
          description="Boxes show q1, median, q3; whiskers show min/max; dots show mean. Methods are grouped by family colour."
        />
        {boxGroups.length === 0 ? <EmptyState /> : <RuntimeBoxPlot groups={boxGroups} />}
      </Panel>

      <Panel className="mt-6 overflow-hidden">
        <PanelHeader
          title="Hardware Mismatch Review"
          description="Mismatch is true when a specific limits.profile is inconsistent with the detected GPU, or when cuda resolves to CPU."
        />
        {mismatchRuns.length === 0 ? (
          <EmptyState>No successful visible runs are flagged for hardware mismatch.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-zinc-50">
                <tr>
                  <th className="p-3 text-left font-semibold">Run</th>
                  <th className="p-3 text-left font-semibold">Method</th>
                  <th className="p-3 text-left font-semibold">Dataset</th>
                  <th className="p-3 text-left font-semibold">Regime</th>
                  <th className="p-3 text-left font-semibold">GPU</th>
                  <th className="p-3 text-left font-semibold">Profile</th>
                  <th className="p-3 text-left font-semibold">Resolved</th>
                  <th className="p-3 text-left font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {mismatchRuns.slice(0, 50).map((run) => (
                  <tr key={run.run_id}>
                    <td className="p-3 font-mono text-xs">
                      {run.raw_data_urls?.run ? (
                        <a className="underline" href={buildDataUrl(run.raw_data_urls.run)} target="_blank" rel="noreferrer">
                          {run.run_id}
                        </a>
                      ) : run.run_id}
                    </td>
                    <td className="p-3">{run.method_id}</td>
                    <td className="p-3">{run.dataset_id}</td>
                    <td className="p-3">{run.target_regime}</td>
                    <td className="p-3">{run.gpu_device || '-'}</td>
                    <td className="p-3">{run.hardware_profile || run['limits.profile'] || '-'}</td>
                    <td className="p-3">{run.method_device_resolved || '-'}</td>
                    <td className="max-w-[360px] p-3 text-xs text-muted-foreground">{run.hardware_mismatch_reason || '-'}</td>
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

export default PerformancePage;
