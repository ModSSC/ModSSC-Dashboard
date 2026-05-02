import React, { useMemo, useState } from 'react';
import { CheckboxPills, EmptyState, LoadingOrError, PageHeader, Panel, PanelHeader, SelectField } from '../components/AnalyticsLayout';
import { filterRuns, MODALITIES, REGIMES } from '../lib/benchmarkData';
import { formatPct, getSeedStd, hasMultipleSeeds, mean, quantile } from '../lib/analytics';
import { METHOD_FAMILIES, familyColor } from '../lib/methodFamilies';

const families = METHOD_FAMILIES.filter((family) => !['Other'].includes(family));

const BoxPlot = ({ groups }) => {
  const width = Math.max(720, groups.length * 96);
  const height = 320;
  const margin = { top: 24, right: 24, bottom: 72, left: 54 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(0.01, ...groups.map((group) => group.max || 0));
  const y = (value) => margin.top + plotHeight - (value / maxValue) * plotHeight;

  return (
    <div className="overflow-x-auto p-4">
      <svg width={width} height={height} role="img" aria-label="Seed variability box plot">
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#d4d4d8" />
        <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="#d4d4d8" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = maxValue * tick;
          return (
            <g key={tick}>
              <line x1={margin.left - 4} y1={y(value)} x2={margin.left + plotWidth} y2={y(value)} stroke="#f4f4f5" />
              <text x={margin.left - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="#71717a">
                {(value * 100).toFixed(1)}
              </text>
            </g>
          );
        })}
        {groups.map((group, index) => {
          const x = margin.left + (index + 0.5) * (plotWidth / groups.length);
          const boxWidth = Math.min(48, plotWidth / groups.length - 18);
          const color = familyColor(group.family || group.label);
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
              <text x={x} y={height - 42} textAnchor="end" transform={`rotate(-35 ${x} ${height - 42})`} fontSize="11" fill="#3f3f46">
                {group.label}
              </text>
              <text x={x} y={height - 14} textAnchor="middle" fontSize="10" fill="#71717a">
                n={group.count}
              </text>
            </g>
          );
        })}
        <text x={18} y={margin.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 18 ${margin.top + plotHeight / 2})`} fontSize="12" fill="#52525b">
          std. dev. of test accuracy (pp)
        </text>
      </svg>
    </div>
  );
};

const summarizeGroups = (runs, groupBy) => {
  const groups = new Map();
  runs.forEach((run) => {
    const std = getSeedStd(run);
    if (std === null) return;
    const key = groupBy === 'method' ? run.method_id : run.family;
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(std);
  });

  return [...groups.entries()]
    .map(([label, values]) => ({
      label,
      family: groupBy === 'method' ? runs.find((run) => run.method_id === label)?.family : label,
      count: values.length,
      min: Math.min(...values),
      q1: quantile(values, 0.25),
      median: quantile(values, 0.5),
      q3: quantile(values, 0.75),
      max: Math.max(...values),
      mean: mean(values),
    }))
    .sort((a, b) => (b.mean || 0) - (a.mean || 0));
};

const VariabilityPage = ({ data }) => {
  const [selectedFamilies, setSelectedFamilies] = useState(families);
  const [selectedRegimes, setSelectedRegimes] = useState(REGIMES);
  const [modality, setModality] = useState('all');
  const [groupBy, setGroupBy] = useState('family');

  const filteredRuns = useMemo(() => filterRuns(
    data.successfulVisibleRuns.filter(hasMultipleSeeds),
    {
      families: selectedFamilies,
      regimes: selectedRegimes,
      modalities: modality === 'all' ? null : [modality],
    }
  ), [data.successfulVisibleRuns, selectedFamilies, selectedRegimes, modality]);

  const groups = useMemo(() => summarizeGroups(filteredRuns, groupBy), [filteredRuns, groupBy]);

  return (
    <>
      <PageHeader
        title="Seed Variability"
        description="Distribution of seed-level test accuracy standard deviations. Higher boxes indicate less stable outcomes across seeds."
        meta={`${filteredRuns.length} multi-seed sweeps`}
      />
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      <Panel className="mb-6 p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <CheckboxPills label="Family" values={families} selected={selectedFamilies} onChange={setSelectedFamilies} />
          <CheckboxPills label="Regime" values={REGIMES} selected={selectedRegimes} onChange={setSelectedRegimes} />
          <SelectField label="Modality" value={modality} onChange={setModality} options={MODALITIES} />
          <SelectField label="Group boxes by" value={groupBy} onChange={setGroupBy} allLabel={null} options={[
            { value: 'family', label: 'Family' },
            { value: 'method', label: 'Method' },
          ]} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Variability Box Plot" description="Boxes show q1, median, q3; whiskers show min/max; dots show mean." />
        {groups.length === 0 ? <EmptyState /> : <BoxPlot groups={groups} />}
      </Panel>

      <Panel className="mt-6 overflow-hidden">
        <PanelHeader title="Most Variable Groups" description="Mean standard deviation of test accuracy across available sweeps." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="p-3 text-left font-semibold">Group</th>
                <th className="p-3 text-right font-semibold">n</th>
                <th className="p-3 text-right font-semibold">Mean std</th>
                <th className="p-3 text-right font-semibold">Median std</th>
                <th className="p-3 text-right font-semibold">Max std</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {groups.slice(0, 20).map((group) => (
                <tr key={group.label}>
                  <td className="p-3 font-medium">{group.label}</td>
                  <td className="p-3 text-right font-mono">{group.count}</td>
                  <td className="p-3 text-right font-mono">{formatPct(group.mean)}</td>
                  <td className="p-3 text-right font-mono">{formatPct(group.median)}</td>
                  <td className="p-3 text-right font-mono">{formatPct(group.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
};

export default VariabilityPage;
