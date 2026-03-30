const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const getRunLabeledCount = (run) => {
  return toFiniteNumber(
    run?.train_labeled_n ??
    run?.['sampling.stats.train_labeled.n'] ??
    run?.['artifacts.sampling.stats.train_labeled.n'] ??
    run?.['sampling.stats.labeled'] ??
    run?.['artifacts.sampling.stats.labeled'] ??
    run?.['sampling.stats.labeled_class_dist.n'] ??
    run?.['artifacts.sampling.stats.labeled_class_dist.n']
  );
};

export const getRunLabeledFraction = (run) => {
  const labeledCount = getRunLabeledCount(run);
  const trainCount = toFiniteNumber(
    run?.train_n ??
    run?.['sampling.stats.train.n'] ??
    run?.['artifacts.sampling.stats.train.n'] ??
    run?.['sampling.stats.train'] ??
    run?.['artifacts.sampling.stats.train']
  );

  if (labeledCount !== null && trainCount && trainCount > 0) {
    return labeledCount / trainCount;
  }

  return null;
};

export const formatFractionPercent = (fraction) => {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0) {
    return null;
  }
  const pct = fraction * 100;
  if (Math.abs(pct - Math.round(pct)) < 1e-6) {
    return `${Math.round(pct)}%`;
  }
  return `${pct.toFixed(2)}%`;
};

export const formatDatasetLabel = (datasetId, fraction) => {
  if (!datasetId) return '-';
  const pct = formatFractionPercent(fraction);
  if (!pct) return datasetId;
  return `${datasetId} (${pct})`;
};

export const getDatasetFractionMap = (runs) => {
  const byDataset = new Map();

  runs.forEach((run) => {
    const dataset = run?.dataset_id;
    if (!dataset) return;
    const fraction = getRunLabeledFraction(run);
    if (fraction === null) return;

    if (!byDataset.has(dataset)) {
      byDataset.set(dataset, new Map());
    }
    const votes = byDataset.get(dataset);
    const key = fraction.toFixed(6);
    votes.set(key, (votes.get(key) || 0) + 1);
  });

  const out = {};
  byDataset.forEach((votes, dataset) => {
    let bestKey = null;
    let bestCount = -1;
    votes.forEach((count, key) => {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    });
    out[dataset] = bestKey === null ? null : Number(bestKey);
  });

  return out;
};
