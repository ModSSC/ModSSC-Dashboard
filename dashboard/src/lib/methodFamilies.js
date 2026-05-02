export const METHOD_FAMILIES = [
  'Baseline',
  'Wrappers',
  'Consistency',
  'Hybrid',
  'Margin-based inductive',
  'Classical transductive',
  'PDE/Variational',
  'GNN',
  'Other',
];

export const METHOD_FAMILY = {
  supervised: 'Baseline',

  self_training: 'Wrappers',
  pseudo_label: 'Wrappers',
  co_training: 'Wrappers',
  deep_co_training: 'Wrappers',
  democratic_co_learning: 'Wrappers',
  tri_training: 'Wrappers',
  trinet: 'Wrappers',
  setred: 'Wrappers',

  pi_model: 'Consistency',
  temporal_ensembling: 'Consistency',
  mean_teacher: 'Consistency',
  vat: 'Consistency',

  adamatch: 'Hybrid',
  comatch: 'Hybrid',
  daso: 'Hybrid',
  defixmatch: 'Hybrid',
  fixmatch: 'Hybrid',
  flexmatch: 'Hybrid',
  free_match: 'Hybrid',
  meta_pseudo_labels: 'Hybrid',
  mixmatch: 'Hybrid',
  noisy_student: 'Hybrid',
  simclr_v2: 'Hybrid',
  softmatch: 'Hybrid',
  uda: 'Hybrid',

  adsh: 'Margin-based inductive',
  s4vm: 'Margin-based inductive',
  tsvm: 'Margin-based inductive',

  dynamic_label_propagation: 'Classical transductive',
  graph_mincuts: 'Classical transductive',
  graphhop: 'Classical transductive',
  label_propagation: 'Classical transductive',
  label_spreading: 'Classical transductive',
  lazy_random_walk: 'Classical transductive',

  laplace_learning: 'PDE/Variational',
  p_laplace_learning: 'PDE/Variational',
  poisson_learning: 'PDE/Variational',
  poisson_mbo: 'PDE/Variational',

  appnp: 'GNN',
  chebnet: 'GNN',
  gat: 'GNN',
  gcn: 'GNN',
  gcnii: 'GNN',
  grafn: 'GNN',
  grand: 'GNN',
  graphsage: 'GNN',
  h_gcn: 'GNN',
  n_gcn: 'GNN',
  planetoid: 'GNN',
  sgc: 'GNN',
};

export const getMethodFamily = (methodId) => METHOD_FAMILY[methodId] || 'Other';

export const familyColor = (family) => ({
  Baseline: '#111827',
  Wrappers: '#2563eb',
  Consistency: '#16a34a',
  Hybrid: '#d97706',
  'Margin-based inductive': '#9333ea',
  'Classical transductive': '#0891b2',
  'PDE/Variational': '#dc2626',
  GNN: '#4f46e5',
  Other: '#6b7280',
}[family] || '#6b7280');
