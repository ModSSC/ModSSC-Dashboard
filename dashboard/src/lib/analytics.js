import { runAccuracy, toFiniteNumber } from './benchmarkData';

export const mean = (values) => {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((acc, value) => acc + value, 0) / clean.length;
};

export const sampleStd = (values) => {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return 0;
  const m = mean(clean);
  const variance = clean.reduce((acc, value) => acc + (value - m) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(variance);
};

export const quantile = (values, q) => {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const pos = (clean.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (clean[base + 1] !== undefined) {
    return clean[base] + rest * (clean[base + 1] - clean[base]);
  }
  return clean[base];
};

export const groupBy = (items, keyFn) => {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (key === null || key === undefined || key === '') return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
};

export const uniqueSorted = (items) => [...new Set(items.filter(Boolean))].sort();

export const formatPct = (value, digits = 2) => {
  const n = toFiniteNumber(value);
  return n === null ? '-' : `${(n * 100).toFixed(digits)}%`;
};

export const formatNumber = (value, digits = 2) => {
  const n = toFiniteNumber(value);
  return n === null ? '-' : n.toFixed(digits);
};

export const computeRankedRuns = (runs) => {
  const slices = groupBy(
    runs.filter((run) => runAccuracy(run) !== null),
    (run) => [run.dataset_id, run.target_regime, run.paradigm, run.modality].join('|')
  );

  const ranked = [];
  slices.forEach((sliceRuns, sliceKey) => {
    const sorted = [...sliceRuns].sort((a, b) => runAccuracy(b) - runAccuracy(a));
    const denominator = Math.max(sorted.length - 1, 1);
    sorted.forEach((run, index) => {
      ranked.push({
        ...run,
        slice_key: sliceKey,
        rank: index + 1,
        normalized_rank: sorted.length > 1 ? index / denominator : 0,
        slice_size: sorted.length,
      });
    });
  });

  return ranked;
};

export const aggregateBy = (items, keyFn, valueFn) => {
  const groups = groupBy(items, keyFn);
  return [...groups.entries()].map(([key, group]) => {
    const values = group.map(valueFn).filter((value) => Number.isFinite(value));
    return {
      key,
      count: values.length,
      mean: mean(values),
      std: sampleStd(values),
      values,
      rows: group,
    };
  });
};

export const getSeedStd = (run) => {
  const direct = toFiniteNumber(run?.test_accuracy_std);
  if (direct !== null) return direct;
  const values = Array.isArray(run?.seed_runs)
    ? run.seed_runs.map((seedRun) => runAccuracy(seedRun)).filter((value) => value !== null)
    : [];
  return values.length > 1 ? sampleStd(values) : null;
};

export const hasMultipleSeeds = (run) => {
  const count = toFiniteNumber(run?.seed_count);
  if (count && count > 1) return true;
  return Array.isArray(run?.seed_runs) && run.seed_runs.length > 1;
};
