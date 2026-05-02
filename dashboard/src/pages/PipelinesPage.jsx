import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { LoadingOrError, PageHeader, Panel, PanelHeader, SelectField } from '../components/AnalyticsLayout';
import { MODALITIES, PARADIGMS, filterRuns } from '../lib/benchmarkData';
import { groupBy } from '../lib/analytics';

const canonicalPipelines = {
  tabular: {
    inductive: ['labels.encode', 'labels.to_torch', 'tabular.impute', 'tabular.scale', 'core.to_torch'],
    transductive: ['labels.encode', 'tabular.impute', 'tabular.scale', 'graph.knn', 'graph.normalize', 'core.to_torch'],
    augmentation: ['tabular.gaussian_noise', 'tabular.feature_dropout'],
    callout: 'Tabular comparisons vary mostly through dataset.id and label budget; class filtering is uncommon.',
  },
  text: {
    inductive: ['labels.encode', 'text.vocab_tokenizer(vocab_size=20k, max_length=256)', 'text.embedding', 'core.to_torch'],
    transductive: ['labels.encode', 'text.vocab_tokenizer', 'text.embedding', 'graph.knn/cosine', 'graph.normalize'],
    augmentation: ['text.token_dropout', 'text.word_mask', 'text.backtranslation-style strong view'],
    callout: 'Some transductive text presets use class_filter=[0,1] to align binary graph protocols.',
  },
  vision: {
    inductive: ['labels.encode', 'vision.resize', 'vision.normalize', 'core.to_torch'],
    transductive: ['labels.encode', 'vision.embedding', 'pca', 'graph.knn', 'graph.normalize'],
    augmentation: ['vision.crop_flip', 'vision.color_jitter', 'vision.cutout/randaugment'],
    callout: 'Some vision graph-style presets use class_filter=[0,1] for binary transductive comparisons.',
  },
  audio: {
    inductive: ['labels.encode', 'audio.load_waveform(target_sample_rate=16k)', 'core.to_torch'],
    transductive: ['labels.encode', 'audio.load_waveform', 'audio.embedding', 'graph.knn', 'graph.normalize'],
    augmentation: ['audio.add_noise', 'audio.time_shift'],
    callout: 'Audio experiments use waveform loading with weak and strong perturbations for hybrid methods.',
  },
  graph: {
    inductive: ['labels.encode', 'graph.node_features', 'sampling.masks', 'core.to_torch'],
    transductive: ['labels.encode', 'graph.load_or_construct', 'graph.normalize', 'mask evaluation'],
    augmentation: ['feature_dropout', 'edge_dropout where supported'],
    callout: 'Graph datasets often respect official graph masks when available.',
  },
};

const specialCases = [
  {
    name: 'co_training / setred',
    detail: 'Two-view wrappers use separate weak learners or view-specific feature projections before agreement/pseudo-label selection.',
  },
  {
    name: 'lazy_random_walk',
    detail: 'Uses a synthetic graph-style transductive protocol built from features when the source dataset is not natively a graph.',
  },
  {
    name: 'hybrid inductive methods',
    detail: 'Methods such as FixMatch, AdaMatch, FreeMatch and SoftMatch consume weak/strong augmented views and share the same evaluation protocol.',
  },
];

const StepFlow = ({ steps }) => (
  <div className="flex flex-wrap items-center gap-2">
    {steps.map((step, index) => (
      <React.Fragment key={`${step}-${index}`}>
        <span className="rounded-md border bg-white px-2 py-1 font-mono text-xs">{step}</span>
        {index < steps.length - 1 && <ArrowRight className="h-3 w-3 text-zinc-400" />}
      </React.Fragment>
    ))}
  </div>
);

const PipelinesPage = ({ data }) => {
  const [modality, setModality] = useState('all');
  const [paradigm, setParadigm] = useState('all');

  const filteredRuns = useMemo(() => filterRuns(data.successfulVisibleRuns, {
    modalities: modality === 'all' ? null : [modality],
    paradigms: paradigm === 'all' ? null : [paradigm],
  }), [data.successfulVisibleRuns, modality, paradigm]);

  const observed = useMemo(() => {
    const groups = groupBy(filteredRuns, (run) => `${run.modality}|${run.paradigm}`);
    return [...groups.entries()].map(([key, runs]) => {
      const [runModality, runParadigm] = key.split('|');
      const preprocessSteps = new Set();
      const weakSteps = new Set();
      const strongSteps = new Set();
      const classFilters = new Set();
      runs.forEach((run) => {
        (Array.isArray(run['preprocess.steps']) ? run['preprocess.steps'] : []).forEach((step) => preprocessSteps.add(step));
        (Array.isArray(run['augmentation.weak.steps']) ? run['augmentation.weak.steps'] : []).forEach((step) => weakSteps.add(step));
        (Array.isArray(run['augmentation.strong.steps']) ? run['augmentation.strong.steps'] : []).forEach((step) => strongSteps.add(step));
        const classFilter = run['dataset.options.class_filter'];
        if (Array.isArray(classFilter)) classFilters.add(classFilter.join(','));
      });
      return {
        modality: runModality,
        paradigm: runParadigm,
        runs: runs.length,
        preprocessSteps: [...preprocessSteps].sort(),
        weakSteps: [...weakSteps].sort(),
        strongSteps: [...strongSteps].sort(),
        classFilters: [...classFilters].sort(),
      };
    }).sort((a, b) => `${a.modality}-${a.paradigm}`.localeCompare(`${b.modality}-${b.paradigm}`));
  }, [filteredRuns]);

  const modalityList = modality === 'all' ? MODALITIES : [modality];
  const paradigmList = paradigm === 'all' ? PARADIGMS : [paradigm];

  return (
    <>
      <PageHeader
        title="Pipelines / Protocols"
        description="Canonical preprocessing, graph construction and augmentation patterns inferred from ModSSC best presets. Static summaries are paired with observed public-run steps when present."
        meta={`${filteredRuns.length} runs`}
      />
      <LoadingOrError isLoading={data.isLoading} error={data.dataError} />

      <Panel className="mb-6 p-4">
        <div className="flex flex-wrap gap-4">
          <SelectField label="Modality" value={modality} onChange={setModality} options={MODALITIES} />
          <SelectField label="Paradigm" value={paradigm} onChange={setParadigm} options={PARADIGMS} />
        </div>
      </Panel>

      <div className="grid gap-6">
        {modalityList.flatMap((currentModality) => paradigmList.map((currentParadigm) => {
          const pipeline = canonicalPipelines[currentModality]?.[currentParadigm];
          if (!pipeline) return null;
          const observedRow = observed.find((row) => row.modality === currentModality && row.paradigm === currentParadigm);
          return (
            <Panel key={`${currentModality}-${currentParadigm}`}>
              <PanelHeader
                title={`${currentParadigm} / ${currentModality}`}
                description={`${observedRow?.runs || 0} successful visible runs under current filters.`}
              />
              <div className="space-y-4 p-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Canonical flow</div>
                  <StepFlow steps={pipeline} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Augmentation / views</div>
                  <StepFlow steps={canonicalPipelines[currentModality].augmentation} />
                </div>
                {observedRow?.preprocessSteps?.length > 0 && (
                  <div className="rounded-md bg-zinc-50 p-3 text-xs">
                    <span className="font-semibold">Observed preprocess steps: </span>
                    {observedRow.preprocessSteps.join(' -> ')}
                  </div>
                )}
                {(observedRow?.weakSteps?.length > 0 || observedRow?.strongSteps?.length > 0) && (
                  <div className="rounded-md bg-zinc-50 p-3 text-xs">
                    <div><span className="font-semibold">Weak: </span>{observedRow.weakSteps.join(', ') || '-'}</div>
                    <div><span className="font-semibold">Strong: </span>{observedRow.strongSteps.join(', ') || '-'}</div>
                  </div>
                )}
                <div className="rounded-md border-l-4 border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700">
                  {canonicalPipelines[currentModality].callout}
                  {observedRow?.classFilters?.length > 0 && ` Observed class_filter values: ${observedRow.classFilters.join(' | ')}.`}
                </div>
              </div>
            </Panel>
          );
        }))}
      </div>

      <Panel className="mt-6">
        <PanelHeader title="Special Cases" description="Protocol details that affect comparability and chart interpretation." />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {specialCases.map((item) => (
            <div key={item.name} className="rounded-md border p-3">
              <div className="font-semibold">{item.name}</div>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
};

export default PipelinesPage;
