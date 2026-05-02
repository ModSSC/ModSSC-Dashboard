import { useEffect, useMemo, useState } from 'react';
import { getMethodFamily } from './methodFamilies';
import { getRunDatasetId, isRunVisibleInBenchmark } from './dataset';

export const REGIMES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
export const MODALITIES = ['tabular', 'text', 'vision', 'audio', 'graph'];
export const PARADIGMS = ['inductive', 'transductive'];

export const buildDataUrl = (relativePath) => {
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
  const cleanPath = String(relativePath || '').replace(/^\/+/, '');
  return `${baseUrl}/${cleanPath}`;
};

export const normalizeRegime = (value) => {
  const regime = String(value ?? '').trim().toUpperCase();
  return /^R\d+$/.test(regime) ? regime : null;
};

export const regimeOrder = (regime) => {
  const match = /^R(\d+)$/i.exec(regime || '');
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

export const isRunError = (run) => {
  if (!run) return false;
  if (run.error) return true;
  return String(run.status ?? '').trim().toUpperCase() === 'FAIL';
};

export const isSuccessfulRun = (run) => {
  if (!run || isRunError(run)) return false;
  const status = String(run.status ?? '').trim().toUpperCase();
  return !status || status === 'OK' || status === 'SUCCESS' || status === 'SUCCEEDED';
};

export const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const runAccuracy = (run) => toFiniteNumber(run?.test_accuracy);

export const decorateRun = (run) => ({
  ...run,
  family: getMethodFamily(run?.method_id),
  dataset_id: getRunDatasetId(run),
  target_regime: normalizeRegime(run?.target_regime) || run?.target_regime,
});

export const filterRuns = (runs, filters = {}) => {
  const {
    paradigms,
    modalities,
    regimes,
    families,
    datasets,
    methods,
  } = filters;

  return runs.filter((run) => {
    if (paradigms?.length && !paradigms.includes(run.paradigm)) return false;
    if (modalities?.length && !modalities.includes(run.modality)) return false;
    if (regimes?.length && !regimes.includes(run.target_regime)) return false;
    if (families?.length && !families.includes(run.family)) return false;
    if (datasets?.length && !datasets.includes(run.dataset_id)) return false;
    if (methods?.length && !methods.includes(run.method_id)) return false;
    return true;
  });
};

export const useBenchmarkData = () => {
  const [manifest, setManifest] = useState(null);
  const [allRuns, setAllRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState(null);

  useEffect(() => {
    let isCancelled = false;

    const loadData = async () => {
      setIsLoading(true);
      setDataError(null);

      try {
        const manifestResponse = await fetch(buildDataUrl('data/results-manifest.json'), { cache: 'no-store' });
        if (manifestResponse.ok) {
          const loadedManifest = await manifestResponse.json();
          const chunks = Array.isArray(loadedManifest?.chunks) ? loadedManifest.chunks : [];
          const chunkPayloads = await Promise.all(
            chunks.map(async (chunk) => {
              const response = await fetch(buildDataUrl(chunk.path), { cache: 'no-store' });
              if (!response.ok) throw new Error(`HTTP ${response.status} for ${chunk.path}`);
              const payload = await response.json();
              return Array.isArray(payload) ? payload : [];
            })
          );

          if (!isCancelled) {
            setManifest(loadedManifest);
            setAllRuns(chunkPayloads.flat().map(decorateRun));
            setIsLoading(false);
          }
          return;
        }
      } catch (err) {
        console.warn('Manifest load failed, trying legacy results.json', err);
      }

      try {
        const response = await fetch(buildDataUrl('data/results.json'), { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!isCancelled) {
          setManifest(null);
          setAllRuns((Array.isArray(payload) ? payload : []).map(decorateRun));
        }
      } catch (err) {
        console.error('Failed to load dashboard data', err);
        if (!isCancelled) {
          setManifest(null);
          setAllRuns([]);
          setDataError('Unable to load benchmark data.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadData();
    return () => {
      isCancelled = true;
    };
  }, []);

  const visibleRuns = useMemo(
    () => allRuns.filter((run) => isRunVisibleInBenchmark(run)),
    [allRuns]
  );

  const successfulVisibleRuns = useMemo(
    () => visibleRuns.filter(isSuccessfulRun),
    [visibleRuns]
  );

  return {
    manifest,
    allRuns,
    visibleRuns,
    successfulVisibleRuns,
    isLoading,
    dataError,
  };
};
