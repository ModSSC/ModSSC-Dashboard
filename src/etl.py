import ast
import csv
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

import yaml

NUMERIC_PAIR_RE = re.compile(r"([A-Za-z_]\w*)=([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)")
EPOCH_RE = re.compile(r"\bepoch=(\d+)\b")
ITER_RE = re.compile(r"\biter(?:ation)?=(\d+)\b")
STEP_RE = re.compile(r"\bstep=(\d+)\b")
EVAL_METRICS_RE = re.compile(r"split=(val|test)\b.*metrics=({.*})")
RUN_SUMMARY_RE = re.compile(r"Run summary written:\s+(\S+)\s+status=")
AGGREGATE_RE = re.compile(r"Seed sweep aggregate written:\s+(\S+)\s+status=")
CONFIG_LINE_RE = re.compile(r"\bCONFIG=(\S+)")
DURATION_RE = re.compile(r"\bduration_s=([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)")
EXIT_CODE_RE = re.compile(r"\bEXIT_CODE=(-?\d+)\b")
SEED_RE = re.compile(r"\bseed=(\d+)\b")
EXCEPTION_RE = re.compile(r"([A-Za-z_]\w*(?:Error|Exception)):\s*(.+)")
GPU_DEVICE_RE = re.compile(r"Preprocess GPU device:\s+device=(\S+)\s+model=(.+)$")
RUN_ID_REGIME_RE = re.compile(r"^(R\d+)_")
TOKEN_REGIME_RE = re.compile(r"(?:^|[_-])(R\d+)(?:[_-]|$)", re.IGNORECASE)
REGIME_ONLY_RE = re.compile(r"^R(\d+)$", re.IGNORECASE)

METHOD_FAMILY = {
    'supervised': 'Baseline',
    'self_training': 'Wrappers',
    'pseudo_label': 'Wrappers',
    'co_training': 'Wrappers',
    'deep_co_training': 'Wrappers',
    'democratic_co_learning': 'Wrappers',
    'tri_training': 'Wrappers',
    'trinet': 'Wrappers',
    'setred': 'Wrappers',
    'pi_model': 'Consistency',
    'temporal_ensembling': 'Consistency',
    'mean_teacher': 'Consistency',
    'vat': 'Consistency',
    'adamatch': 'Hybrid',
    'comatch': 'Hybrid',
    'daso': 'Hybrid',
    'defixmatch': 'Hybrid',
    'fixmatch': 'Hybrid',
    'flexmatch': 'Hybrid',
    'free_match': 'Hybrid',
    'meta_pseudo_labels': 'Hybrid',
    'mixmatch': 'Hybrid',
    'noisy_student': 'Hybrid',
    'simclr_v2': 'Hybrid',
    'softmatch': 'Hybrid',
    'uda': 'Hybrid',
    'adsh': 'Margin-based inductive',
    's4vm': 'Margin-based inductive',
    'tsvm': 'Margin-based inductive',
    'dynamic_label_propagation': 'Classical transductive',
    'graph_mincuts': 'Classical transductive',
    'graphhop': 'Classical transductive',
    'label_propagation': 'Classical transductive',
    'label_spreading': 'Classical transductive',
    'lazy_random_walk': 'Classical transductive',
    'laplace_learning': 'PDE/Variational',
    'p_laplace_learning': 'PDE/Variational',
    'poisson_learning': 'PDE/Variational',
    'poisson_mbo': 'PDE/Variational',
    'appnp': 'GNN',
    'chebnet': 'GNN',
    'gat': 'GNN',
    'gcn': 'GNN',
    'gcnii': 'GNN',
    'grafn': 'GNN',
    'grand': 'GNN',
    'graphsage': 'GNN',
    'h_gcn': 'GNN',
    'n_gcn': 'GNN',
    'planetoid': 'GNN',
    'sgc': 'GNN',
}

HIDDEN_BENCHMARK_DATASET_IDS = {
    'speechcommands',
    'amazon_polarity',
    'amazon_reviews_multi_en',
    'dbpedia_14',
    'stl10',
    'svhn',
    'toy',
    'yesno',
    'yelp_polarity',
    'yelp_review_full',
}


def to_float(value):
    try:
        n = float(value)
        return n
    except (TypeError, ValueError):
        return None


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_datetime(value):
    if not value:
        return None

    text = str(value).strip()
    if not text:
        return None

    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None


def sample_std(values):
    clean = [value for value in values if value is not None]
    if len(clean) < 2:
        return 0.0 if clean else None
    avg = sum(clean) / len(clean)
    variance = sum((value - avg) ** 2 for value in clean) / (len(clean) - 1)
    return variance ** 0.5


def summarize_numeric(values):
    clean = [value for value in values if value is not None]
    if not clean:
        return {}
    return {
        'mean': sum(clean) / len(clean),
        'std': sample_std(clean),
        'min': min(clean),
        'max': max(clean),
        'count': len(clean),
        'values': clean,
    }


def flatten_dict(d, parent_key='', sep='.'):
    items = []
    for k, v in d.items():
        new_key = parent_key + sep + k if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep=sep).items())
        else:
            items.append((new_key, v))
    return dict(items)


def parse_python_dict(text):
    try:
        parsed = ast.literal_eval(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return None


def extract_dict_after_marker(line, marker):
    if marker not in line:
        return None
    fragment = line.split(marker, 1)[1].strip()
    start = fragment.find('{')
    end = fragment.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return None
    return parse_python_dict(fragment[start:end + 1])


def parse_history_entry_from_line(line):
    # Generic key=value lines with epoch/iter/step
    index_kind = None
    index_value = None

    epoch_match = EPOCH_RE.search(line)
    if epoch_match:
        index_kind = 'epoch'
        index_value = to_int(epoch_match.group(1))
    else:
        iter_match = ITER_RE.search(line)
        if iter_match:
            index_kind = 'iter'
            index_value = to_int(iter_match.group(1))
        else:
            step_match = STEP_RE.search(line)
            if step_match:
                index_kind = 'step'
                index_value = to_int(step_match.group(1))

    if index_value is None:
        return None

    entry = {'epoch': index_value}
    if index_kind != 'epoch':
        entry[index_kind] = index_value

    has_metric = False
    for key, value in NUMERIC_PAIR_RE.findall(line):
        if key in {'epoch', 'iter', 'iteration', 'step'}:
            continue
        n = to_float(value)
        if n is None:
            continue
        entry[key] = n
        has_metric = True

    return entry if has_metric else None


def parse_log_file(log_path):
    """
    Parse a log file and return training history entries.
    Supports current bench key=value epoch/iter/step logs.
    """
    history = []

    try:
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                entry = parse_history_entry_from_line(line)
                if entry:
                    history.append(entry)
    except Exception as e:
        print(f"Error parsing log {log_path}: {e}")

    return history


def parse_bench_log_summary(log_path):
    """
    Parse a bench log (new structure) and extract:
    - history
    - val/test metrics
    - duration
    - seed (if unique)
    - method params
    - sampling stats
    - exit_code and error hint
    """
    history = []
    eval_metrics = {}

    method_params = None
    sampling_stats = None
    output_run_json = None
    output_aggregate_json = None
    log_config_path = None

    seeds = set()
    aggregate_duration = None
    method_duration = None
    exit_code = None
    traceback_seen = False
    last_exception = None
    gpu_devices = set()

    try:
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.rstrip('\n')

                entry = parse_history_entry_from_line(line)
                if entry:
                    history.append(entry)

                eval_match = EVAL_METRICS_RE.search(line)
                if eval_match:
                    split = eval_match.group(1)
                    metrics = parse_python_dict(eval_match.group(2))
                    if metrics:
                        eval_metrics[split] = metrics

                if 'method params:' in line:
                    maybe_params = extract_dict_after_marker(line, 'method params:')
                    if maybe_params:
                        method_params = maybe_params

                if 'Sampling stats:' in line:
                    maybe_stats = extract_dict_after_marker(line, 'Sampling stats:')
                    if maybe_stats:
                        sampling_stats = maybe_stats

                if 'Seed sweep aggregate written:' in line:
                    duration_match = DURATION_RE.search(line)
                    if duration_match:
                        aggregate_duration = to_float(duration_match.group(1))

                if 'method done:' in line and 'duration_s=' in line:
                    duration_match = DURATION_RE.search(line)
                    if duration_match:
                        method_duration = to_float(duration_match.group(1))

                gpu_match = GPU_DEVICE_RE.search(line)
                if gpu_match:
                    model_name = gpu_match.group(2).strip()
                    if model_name:
                        gpu_devices.add(model_name)

                exit_match = EXIT_CODE_RE.search(line)
                if exit_match:
                    exit_code = to_int(exit_match.group(1))

                if 'Traceback (most recent call last):' in line:
                    traceback_seen = True

                exc_match = EXCEPTION_RE.search(line)
                if exc_match:
                    last_exception = f"{exc_match.group(1)}: {exc_match.group(2).strip()}"

                if 'Sampling start:' in line or 'method start:' in line:
                    seed_match = SEED_RE.search(line)
                    if seed_match:
                        seed = to_int(seed_match.group(1))
                        if seed is not None:
                            seeds.add(seed)

                run_summary_match = RUN_SUMMARY_RE.search(line)
                if run_summary_match:
                    output_run_json = run_summary_match.group(1).strip()

                aggregate_match = AGGREGATE_RE.search(line)
                if aggregate_match:
                    output_aggregate_json = aggregate_match.group(1).strip()

                config_line_match = CONFIG_LINE_RE.search(line)
                if config_line_match:
                    log_config_path = config_line_match.group(1).strip()

    except Exception as e:
        print(f"Error parsing bench log summary {log_path}: {e}")

    results = {
        'history': history,
        'test_accuracy': None,
        'test_macro_f1': None,
        'val.accuracy': None,
        'val.macro_f1': None,
        'duration_s': aggregate_duration if aggregate_duration is not None else method_duration,
        'seed': next(iter(seeds)) if len(seeds) == 1 else None,
        'exit_code': exit_code,
        'error': None,
    }

    if gpu_devices:
        ordered_devices = sorted(gpu_devices)
        results['gpu_device'] = ordered_devices[0] if len(ordered_devices) == 1 else ', '.join(ordered_devices)
        results['gpu_devices'] = ordered_devices

    if 'test' in eval_metrics:
        results['test_accuracy'] = to_float(eval_metrics['test'].get('accuracy'))
        results['test_macro_f1'] = to_float(eval_metrics['test'].get('macro_f1'))

    if 'val' in eval_metrics:
        results['val.accuracy'] = to_float(eval_metrics['val'].get('accuracy'))
        results['val.macro_f1'] = to_float(eval_metrics['val'].get('macro_f1'))

    if method_params:
        for k, v in flatten_dict(method_params, parent_key='params').items():
            results[k] = v

    if sampling_stats:
        for k, v in flatten_dict(sampling_stats, parent_key='sampling.stats').items():
            results[k] = v

    if exit_code is not None and exit_code != 0:
        results['error'] = last_exception or f"exit_code={exit_code}"
    elif traceback_seen and last_exception:
        # Defensive fallback in case EXIT_CODE is absent in malformed logs.
        results['error'] = last_exception

    if output_run_json:
        results['_output_run_json'] = output_run_json
    if output_aggregate_json:
        results['_output_aggregate_json'] = output_aggregate_json
    if log_config_path:
        results['_log_config_path'] = log_config_path

    return results


def resolve_local_log_path(path_str):
    if not path_str:
        return None

    path_str = str(path_str).strip()
    if not path_str:
        return None

    candidate = Path(path_str)
    if candidate.exists():
        return candidate

    normalized = path_str.replace('\\', '/')

    if '/logs/' in normalized:
        rel = normalized.split('/logs/', 1)[1]
        candidate = Path('logs') / rel
        if candidate.exists():
            return candidate

    if normalized.startswith('logs/'):
        candidate = Path(normalized)
        if candidate.exists():
            return candidate

    return None


def resolve_local_config_path(path_str):
    if not path_str:
        return None

    path_str = str(path_str).strip()
    if not path_str:
        return None

    candidate = Path(path_str)
    if candidate.exists():
        return candidate

    normalized = path_str.replace('\\', '/')

    if '/bench/configs/' in normalized:
        rel = normalized.split('/bench/configs/', 1)[1]
        candidate = Path('bench/configs') / rel
        if candidate.exists():
            return candidate

    if normalized.startswith('bench/configs/'):
        candidate = Path(normalized)
        if candidate.exists():
            return candidate

    return None


def resolve_local_output_path(path_str):
    if not path_str:
        return None

    path_str = str(path_str).strip()
    if not path_str:
        return None

    candidate = Path(path_str)
    if candidate.exists():
        return candidate

    normalized = path_str.replace('\\', '/')

    if '/outputs/' in normalized:
        rel = normalized.split('/outputs/', 1)[1]
        candidate = Path('outputs') / rel
        if candidate.exists():
            return candidate

    if normalized.startswith('outputs/'):
        candidate = Path(normalized)
        if candidate.exists():
            return candidate

    return None


def extract_metadata_from_bench_log_path(log_path):
    parts = log_path.parts
    metadata = {}

    if 'bench' not in parts:
        return metadata

    i = parts.index('bench')
    # Expected: logs/bench/{dataset}/{R?}/{paradigm}/{method}/{modality}/{file.log}
    if len(parts) > i + 5:
        metadata['dataset_id'] = parts[i + 1]
        metadata['target_regime'] = parts[i + 2]
        metadata['paradigm'] = parts[i + 3]
        metadata['method_id'] = parts[i + 4]
        metadata['modality'] = parts[i + 5]

    return metadata


def parse_config_file_into_results(config_path, results, artifacts_dir, run_id):
    if not config_path or not config_path.exists():
        return False

    try:
        shutil.copy(config_path, artifacts_dir / 'config.yaml')
        results['raw_data_urls']['config'] = f"data/artifacts/{run_id}/config.yaml"
    except Exception as e:
        print(f"Error copying config {config_path}: {e}")

    try:
        with open(config_path, 'r', encoding='utf-8', errors='ignore') as f:
            config = yaml.safe_load(f)

        if not isinstance(config, dict):
            return

        if not results.get('method_id'):
            results['method_id'] = config.get('method', {}).get('id')

        if results.get('run_kind') != 'seed_sweep' and results.get('seed') is None:
            results['seed'] = config.get('run', {}).get('seed')

        params = config.get('method', {}).get('params', {})
        if isinstance(params, dict):
            for k, v in flatten_dict(params, parent_key='params').items():
                # Keep params from logs if already available.
                results.setdefault(k, v)

        dataset_options = config.get('dataset', {}).get('options', {})
        if isinstance(dataset_options, dict):
            for k, v in flatten_dict(dataset_options, parent_key='dataset.options').items():
                results.setdefault(k, v)

        sampling_plan = config.get('sampling', {}).get('plan', {})
        if isinstance(sampling_plan, dict):
            for section in ('split', 'labeling', 'imbalance', 'policy'):
                section_values = sampling_plan.get(section)
                if isinstance(section_values, dict):
                    for k, v in flatten_dict(section_values, parent_key=f'sampling.{section}').items():
                        results.setdefault(k, v)

        preprocess = config.get('preprocess', {})
        if isinstance(preprocess, dict):
            for field in ('fit_on', 'cache'):
                if field in preprocess:
                    results.setdefault(f'preprocess.{field}', preprocess.get(field))
            steps = get_nested(preprocess, ('plan', 'steps'), default=[])
            if isinstance(steps, list):
                step_ids = [step.get('id') for step in steps if isinstance(step, dict) and step.get('id')]
                if step_ids:
                    results.setdefault('preprocess.steps', step_ids)

        augmentation = config.get('augmentation', {})
        if isinstance(augmentation, dict):
            for field in ('enabled', 'mode', 'modality'):
                if field in augmentation:
                    results.setdefault(f'augmentation.{field}', augmentation.get(field))
            for view in ('weak', 'strong'):
                steps = get_nested(augmentation, (view, 'steps'), default=[])
                if isinstance(steps, list):
                    step_ids = [step.get('id') for step in steps if isinstance(step, dict) and step.get('id')]
                    if step_ids:
                        results.setdefault(f'augmentation.{view}.steps', step_ids)

        method = config.get('method', {})
        if isinstance(method, dict):
            model = method.get('model', {})
            if isinstance(model, dict):
                for field in ('classifier_id', 'classifier_backend'):
                    if field in model:
                        results.setdefault(f'method.model.{field}', model.get(field))
            device = method.get('device', {})
            if isinstance(device, dict):
                requested = first_present(device.get('device'), device.get('requested'))
                resolved = first_present(device.get('resolved_device'), device.get('resolved'))
                if requested is not None:
                    results.setdefault('method_device_requested', requested)
                if resolved is not None:
                    results.setdefault('method_device_resolved', resolved)
                if device.get('dtype') is not None:
                    results.setdefault('method_device_dtype', device.get('dtype'))

        limits = config.get('limits', {})
        if isinstance(limits, dict) and limits.get('profile') is not None:
            results.setdefault('limits.profile', limits.get('profile'))
            results.setdefault('hardware_profile', limits.get('profile'))

        evaluation = config.get('evaluation', {})
        if isinstance(evaluation, dict):
            for field in ('split_for_model_selection', 'report_splits', 'metrics'):
                if field in evaluation:
                    results.setdefault(f'evaluation.{field}', evaluation.get(field))

        return True

    except Exception as e:
        print(f"Error reading config {config_path}: {e}")
        return False


def resolve_run_json_from_aggregate(aggregate_path):
    if not aggregate_path or not aggregate_path.exists():
        return None

    try:
        with open(aggregate_path, 'r', encoding='utf-8', errors='ignore') as f:
            payload = json.load(f)
    except Exception:
        return None

    runs = payload.get('runs')
    if not isinstance(runs, list):
        return None

    for run_info in runs:
        if not isinstance(run_info, dict):
            continue
        run_json = resolve_local_output_path(run_info.get('run_json'))
        if run_json and run_json.exists():
            return run_json

    return None


def metric_stats_from_aggregate(metrics, split, metric_name):
    data = get_nested(metrics, (split, metric_name))
    if not isinstance(data, dict):
        return {}

    return {
        'mean': to_float(data.get('mean')),
        'std': to_float(data.get('std')),
        'min': to_float(data.get('min')),
        'max': to_float(data.get('max')),
        'count': to_int(data.get('count')),
        'values': data.get('values') if isinstance(data.get('values'), list) else None,
    }


def set_sweep_metric_fields(results, metrics, split, metric_name):
    stats = metric_stats_from_aggregate(metrics, split, metric_name)
    if not stats:
        return

    if split == 'val' and metric_name == 'accuracy':
        base_key = 'val.accuracy'
        stat_prefix = 'val_accuracy'
    elif split == 'val':
        base_key = f'val.{metric_name}'
        stat_prefix = f'val_{metric_name}'
    else:
        base_key = f'{split}_{metric_name}'
        stat_prefix = base_key

    if stats.get('mean') is not None:
        results[base_key] = stats['mean']
        results[f'{stat_prefix}_mean'] = stats['mean']

    for stat_name in ('std', 'min', 'max', 'count'):
        if stats.get(stat_name) is not None:
            results[f'{stat_prefix}_{stat_name}'] = stats[stat_name]

    if stats.get('values') is not None:
        results[f'{stat_prefix}_values'] = stats['values']


def build_seed_entry_from_aggregate_run(run_info, payload=None, fallback=None):
    seed_metrics = run_info.get('metrics') if isinstance(run_info, dict) else {}
    if not isinstance(seed_metrics, dict):
        seed_metrics = {}

    entry = {
        'seed': to_int(run_info.get('seed')),
        'run_id': run_info.get('run_id'),
        'status': normalize_status(run_info.get('status')),
        'test_accuracy': to_float(get_nested(seed_metrics, ('test', 'accuracy'))),
        'test_macro_f1': to_float(get_nested(seed_metrics, ('test', 'macro_f1'))),
        'val.accuracy': to_float(get_nested(seed_metrics, ('val', 'accuracy'))),
        'val.macro_f1': to_float(get_nested(seed_metrics, ('val', 'macro_f1'))),
    }

    hardware_info = extract_runtime_hardware_info(payload or {}, fallback or {})
    for key in (
        'run_time_seconds',
        'gpu_device',
        'hardware_profile',
        'method_device_requested',
        'method_device_resolved',
        'hardware_mismatch',
        'hardware_mismatch_reason',
    ):
        if key in hardware_info:
            entry[key] = hardware_info[key]

    return prune_empty(entry)


def build_seed_sweep_results(log_path, summary, source_row=None):
    output_aggregate = resolve_local_output_path(summary.get('_output_aggregate_json'))
    if not output_aggregate or not output_aggregate.exists():
        return None

    try:
        with open(output_aggregate, 'r', encoding='utf-8', errors='ignore') as f:
            aggregate_payload = json.load(f)
    except Exception as e:
        print(f"Error reading aggregate {output_aggregate}: {e}")
        return None

    runs = aggregate_payload.get('runs', [])
    if not isinstance(runs, list) or not runs:
        return None

    run_id = output_aggregate.parent.name or Path(log_path).stem
    artifacts_dir = Path(f'dashboard/public/data/artifacts/{run_id}')
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    results = {
        'run_id': run_id,
        'run_kind': 'seed_sweep',
        'raw_data_urls': {},
        'history': summary.get('history', []),
        'seed_runs': [],
    }
    results.update(extract_metadata_from_bench_log_path(log_path))

    for k, v in summary.items():
        if k in {
            'history',
            'run_id',
            'seed',
            'test_accuracy',
            'test_macro_f1',
            'val.accuracy',
            'val.macro_f1',
            'status',
            'exit_code',
            'error',
        }:
            continue
        if not k.startswith('_'):
            results[k] = v

    sweep_metrics = aggregate_payload.get('metrics', {})
    if not isinstance(sweep_metrics, dict):
        sweep_metrics = {}

    for split in ('test', 'val'):
        for metric_name in ('accuracy', 'macro_f1'):
            set_sweep_metric_fields(results, sweep_metrics, split, metric_name)

    seed_entries = []
    first_seed_payload = None
    for run_info in runs:
        if not isinstance(run_info, dict):
            continue
        seed_payload = read_json_payload(resolve_local_output_path(run_info.get('run_json')))
        if first_seed_payload is None and seed_payload:
            first_seed_payload = seed_payload
        seed_fallback = {
            'gpu_device': summary.get('gpu_device'),
            'duration_s': summary.get('duration_s'),
        }
        seed_entry = build_seed_entry_from_aggregate_run(
            run_info,
            payload=seed_payload,
            fallback=seed_fallback,
        )
        if seed_payload and seed_entry.get('run_id'):
            write_annotated_run_payload(
                seed_entry.get('run_id'),
                seed_payload,
                extract_runtime_hardware_info(seed_payload, seed_fallback),
            )
        if seed_entry:
            seed_entries.append(seed_entry)

    seed_entries.sort(key=lambda item: (
        item.get('seed') is None,
        item.get('seed') if item.get('seed') is not None else 0,
        str(item.get('run_id') or ''),
    ))
    results['seed_runs'] = seed_entries
    results['seeds'] = [entry['seed'] for entry in seed_entries if entry.get('seed') is not None]
    results['seed_count'] = len(seed_entries)

    runtime_stats = summarize_numeric([entry.get('run_time_seconds') for entry in seed_entries])
    if runtime_stats:
        results['run_time_seconds'] = runtime_stats['mean']
        results['duration_s'] = runtime_stats['mean']
        for stat_name in ('mean', 'std', 'min', 'max', 'count', 'values'):
            results[f'run_time_seconds_{stat_name}'] = runtime_stats.get(stat_name)

    seed_devices = sorted({entry.get('gpu_device') for entry in seed_entries if entry.get('gpu_device')})
    if seed_devices:
        results['gpu_device'] = seed_devices[0] if len(seed_devices) == 1 else 'Mixed'
        results['gpu_devices'] = seed_devices

    seed_profiles = sorted({entry.get('hardware_profile') for entry in seed_entries if entry.get('hardware_profile')})
    if seed_profiles:
        results['hardware_profile'] = seed_profiles[0] if len(seed_profiles) == 1 else 'Mixed'

    mismatch_count = sum(1 for entry in seed_entries if entry.get('hardware_mismatch') is True)
    if seed_entries:
        results['hardware_mismatch'] = mismatch_count > 0
        results['hardware_mismatch_count'] = mismatch_count

    seed_statuses = [entry.get('status') for entry in seed_entries if entry.get('status')]
    if seed_statuses and all(status == 'OK' for status in seed_statuses):
        results['status'] = 'OK'
    elif any(status == 'FAIL' for status in seed_statuses):
        results['status'] = 'FAIL'
    else:
        results['status'] = normalize_status(source_row.get('status') if source_row else None) or normalize_status('OK')

    row_exit_code = to_int(source_row.get('exit_code')) if source_row else None
    if row_exit_code is not None:
        results['exit_code'] = row_exit_code
    elif summary.get('exit_code') is not None:
        results['exit_code'] = summary.get('exit_code')

    if results.get('status') == 'FAIL':
        results['error'] = summary.get('error') or 'one or more seeds failed'

    first_seed_run_id = next(
        (entry.get('run_id') for entry in seed_entries if entry.get('run_id')),
        None,
    )
    first_seed_artifacts_dir = (
        Path('dashboard/public/data/artifacts') / first_seed_run_id
        if first_seed_run_id
        else None
    )

    existing_seed_log = first_seed_artifacts_dir / 'run.log' if first_seed_artifacts_dir else None
    if existing_seed_log and existing_seed_log.exists():
        results['raw_data_urls']['log'] = f"data/artifacts/{first_seed_run_id}/run.log"
    else:
        try:
            shutil.copy(log_path, artifacts_dir / 'run.log')
            results['raw_data_urls']['log'] = f"data/artifacts/{run_id}/run.log"
        except Exception as e:
            print(f"Error copying sweep log {log_path}: {e}")

    existing_seed_config = first_seed_artifacts_dir / 'config.yaml' if first_seed_artifacts_dir else None
    if existing_seed_config and existing_seed_config.exists():
        parse_config_file_into_results(existing_seed_config, results, artifacts_dir, run_id)

    try:
        aggregate_copy = dict(aggregate_payload)
        aggregate_copy = annotate_payload_with_run_info(
            aggregate_copy,
            extract_runtime_hardware_info({}, results),
        )
        with open(artifacts_dir / 'aggregate.json', 'w', encoding='utf-8') as f:
            json.dump(aggregate_copy, f, indent=2)
        aggregate_url = f"data/artifacts/{run_id}/aggregate.json"
        results['raw_data_urls']['aggregate'] = aggregate_url
        results['raw_data_urls']['run'] = aggregate_url
    except Exception as e:
        print(f"Error copying aggregate json {output_aggregate}: {e}")

    first_run_json = None
    for run_info in runs:
        if not isinstance(run_info, dict):
            continue
        first_run_json = resolve_local_output_path(run_info.get('run_json'))
        if first_run_json and first_run_json.exists():
            break

    hydrate_config_from_available_sources(
        results,
        artifacts_dir,
        run_id,
        source_row=source_row,
        output_run_json_path=first_run_json,
    )
    merge_runtime_hardware_into_results(results, first_seed_payload)
    ensure_fallback_artifacts(results, artifacts_dir, run_id, source_row=source_row)

    return prune_empty(results)


def copy_output_run_json_into_artifacts(results, artifacts_dir, run_id):
    output_run = resolve_local_output_path(results.pop('_output_run_json', None))
    output_aggregate = resolve_local_output_path(results.pop('_output_aggregate_json', None))

    run_source = output_run
    if not run_source:
        run_source = resolve_run_json_from_aggregate(output_aggregate)
    if not run_source and output_aggregate and output_aggregate.exists():
        run_source = output_aggregate

    if run_source and run_source.exists():
        try:
            payload = read_json_payload(run_source)
            info = merge_runtime_hardware_into_results(results, payload)
            if payload:
                payload = annotate_payload_with_run_info(payload, info)
                with open(artifacts_dir / 'run.json', 'w', encoding='utf-8') as f:
                    json.dump(payload, f, indent=2)
            else:
                shutil.copy(run_source, artifacts_dir / 'run.json')
            results['raw_data_urls']['run'] = f"data/artifacts/{run_id}/run.json"
        except Exception as e:
            print(f"Error copying output run json {run_source}: {e}")

    return run_source


def hydrate_config_from_available_sources(results, artifacts_dir, run_id, source_row=None, output_run_json_path=None):
    if results['raw_data_urls'].get('config'):
        return

    config_candidates = []

    if source_row:
        config_candidates.append(resolve_local_config_path(source_row.get('config')))

    config_candidates.append(resolve_local_config_path(results.pop('_log_config_path', None)))

    if output_run_json_path:
        config_candidates.append(output_run_json_path.parent / 'config.yaml')

    tried = set()
    for candidate in config_candidates:
        if not candidate:
            continue
        key = str(candidate)
        if key in tried:
            continue
        tried.add(key)

        if parse_config_file_into_results(candidate, results, artifacts_dir, run_id):
            break


def set_nested_value(target, parts, value):
    cursor = target
    for part in parts[:-1]:
        if part not in cursor or not isinstance(cursor[part], dict):
            cursor[part] = {}
        cursor = cursor[part]
    cursor[parts[-1]] = value


def collect_prefixed_values(source, prefix):
    nested = {}
    for key, value in source.items():
        if not key.startswith(prefix):
            continue
        rel = key[len(prefix):]
        if not rel:
            continue
        set_nested_value(nested, rel.split('.'), value)
    return nested


def prune_empty(value):
    if isinstance(value, dict):
        pruned = {}
        for k, v in value.items():
            sub = prune_empty(v)
            if sub is None:
                continue
            if isinstance(sub, dict) and not sub:
                continue
            if isinstance(sub, list) and not sub:
                continue
            pruned[k] = sub
        return pruned

    if isinstance(value, list):
        out = []
        for item in value:
            sub = prune_empty(item)
            if sub is None:
                continue
            out.append(sub)
        return out

    if value is None:
        return None

    return value


def ensure_fallback_artifacts(results, artifacts_dir, run_id, source_row=None):
    params = collect_prefixed_values(results, 'params.')
    sampling_stats = collect_prefixed_values(results, 'sampling.stats.')

    if not results['raw_data_urls'].get('config'):
        config_payload = {
            'method': {
                'id': results.get('method_id'),
                'params': params,
            },
            'run': {
                'seed': results.get('seed'),
            },
            'dataset': {
                'id': results.get('dataset_id'),
            },
            'target_regime': results.get('target_regime'),
            'paradigm': results.get('paradigm'),
            'modality': results.get('modality'),
            'source': {
                'config_path': source_row.get('config') if source_row else None,
            },
        }
        config_payload = prune_empty(config_payload)
        config_path = artifacts_dir / 'config.yaml'
        try:
            with open(config_path, 'w', encoding='utf-8') as f:
                yaml.safe_dump(config_payload, f, sort_keys=False, allow_unicode=False)
            results['raw_data_urls']['config'] = f"data/artifacts/{run_id}/config.yaml"
        except Exception as e:
            print(f"Error writing fallback config {config_path}: {e}")

    if not results['raw_data_urls'].get('run'):
        run_payload = {
            'run': {
                'id': run_id,
                'status': results.get('status'),
                'exit_code': results.get('exit_code'),
                'seed': results.get('seed'),
                'duration_s': results.get('duration_s'),
                'target_regime': results.get('target_regime'),
                'paradigm': results.get('paradigm'),
                'modality': results.get('modality'),
            },
            'run_info': {
                'run_time_seconds': results.get('run_time_seconds'),
                'gpu_device': results.get('gpu_device'),
                'hardware_profile': results.get('hardware_profile') or results.get('limits.profile'),
                'hardware_mismatch': results.get('hardware_mismatch'),
                'hardware_mismatch_reason': results.get('hardware_mismatch_reason'),
            },
            'method': {
                'id': results.get('method_id'),
                'params': params,
            },
            'metrics': {
                'val': {
                    'accuracy': results.get('val.accuracy'),
                    'macro_f1': results.get('val.macro_f1'),
                },
                'test': {
                    'accuracy': results.get('test_accuracy'),
                    'macro_f1': results.get('test_macro_f1'),
                },
            },
            'error': results.get('error'),
            'artifacts': {
                'method': {
                    'device': {
                        'requested': results.get('method_device_requested'),
                        'resolved': results.get('method_device_resolved'),
                        'dtype': results.get('method_device_dtype'),
                    },
                },
                'dataset': {
                    'id': results.get('dataset_id'),
                },
                'sampling': {
                    'stats': sampling_stats,
                },
            },
            'source': {
                'status_row': {
                    'status': source_row.get('status') if source_row else None,
                    'exit_code': source_row.get('exit_code') if source_row else None,
                    'config': source_row.get('config') if source_row else None,
                    'log_file': source_row.get('log_file') if source_row else None,
                },
            },
        }
        run_payload = prune_empty(run_payload)
        run_path = artifacts_dir / 'run.json'
        try:
            with open(run_path, 'w', encoding='utf-8') as f:
                json.dump(run_payload, f, indent=2)
            results['raw_data_urls']['run'] = f"data/artifacts/{run_id}/run.json"
        except Exception as e:
            print(f"Error writing fallback run json {run_path}: {e}")


def extract_run_data_from_status_row(row):
    log_path = resolve_local_log_path(row.get('log_file'))
    if not log_path:
        return None

    run_id = log_path.stem
    summary = parse_bench_log_summary(log_path)

    sweep_results = build_seed_sweep_results(log_path, summary, source_row=row)
    if sweep_results:
        return sweep_results

    # Fallback to single run processing if no aggregate or error
    artifacts_dir = Path(f'dashboard/public/data/artifacts/{run_id}')
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    results = {
        'run_id': run_id,
        'raw_data_urls': {},
        'history': [],
    }

    results.update(extract_metadata_from_bench_log_path(log_path))

    status = str(row.get('status') or '').strip().upper()
    row_exit_code = to_int(row.get('exit_code'))
    if status:
        results['status'] = status
    if row_exit_code is not None:
        results['exit_code'] = row_exit_code

    try:
        shutil.copy(log_path, artifacts_dir / 'run.log')
        results['raw_data_urls']['log'] = f"data/artifacts/{run_id}/run.log"
    except Exception as e:
        print(f"Error copying log {log_path}: {e}")

    results.update(summary)

    # Prefer status-file exit_code when available.
    if row_exit_code is not None:
        results['exit_code'] = row_exit_code

    # Keep explicit status failure if parser did not find an exception.
    if status and status != 'OK' and not results.get('error'):
        if row_exit_code is not None:
            results['error'] = f"status={status} exit_code={row_exit_code}"
        else:
            results['error'] = f"status={status}"

    output_run_json_path = copy_output_run_json_into_artifacts(results, artifacts_dir, run_id)
    hydrate_config_from_available_sources(
        results,
        artifacts_dir,
        run_id,
        source_row=row,
        output_run_json_path=output_run_json_path,
    )
    merge_runtime_hardware_into_results(results)

    ensure_fallback_artifacts(results, artifacts_dir, run_id, source_row=row)

    return results


def iter_status_rows(status_dir):
    for tsv_file in sorted(Path(status_dir).glob('*.tsv')):
        try:
            with open(tsv_file, 'r', encoding='utf-8', errors='ignore') as f:
                reader = csv.DictReader(f, delimiter='\t')
                for row in reader:
                    if not row:
                        continue
                    if not (row.get('log_file') or '').strip():
                        continue
                    yield row
        except Exception as e:
            print(f"Error reading status file {tsv_file}: {e}")


def extract_run_data_from_bench_log(log_path):
    """Fallback when status TSV files are absent."""
    log_path = Path(log_path)
    run_id = log_path.stem

    summary = parse_bench_log_summary(log_path)

    sweep_results = build_seed_sweep_results(log_path, summary, source_row=None)
    if sweep_results:
        return sweep_results

    # Fallback to single run
    artifacts_dir = Path(f'dashboard/public/data/artifacts/{run_id}')
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    results = {
        'run_id': run_id,
        'raw_data_urls': {},
    }

    results.update(extract_metadata_from_bench_log_path(log_path))

    try:
        shutil.copy(log_path, artifacts_dir / 'run.log')
        results['raw_data_urls']['log'] = f"data/artifacts/{run_id}/run.log"
    except Exception as e:
        print(f"Error copying log {log_path}: {e}")

    results.update(summary)

    output_run_json_path = copy_output_run_json_into_artifacts(results, artifacts_dir, run_id)
    hydrate_config_from_available_sources(
        results,
        artifacts_dir,
        run_id,
        source_row=None,
        output_run_json_path=output_run_json_path,
    )
    merge_runtime_hardware_into_results(results)

    ensure_fallback_artifacts(results, artifacts_dir, run_id, source_row=None)

    return results


def get_nested(mapping, path, default=None):
    cursor = mapping
    for key in path:
        if not isinstance(cursor, dict):
            return default
        cursor = cursor.get(key)
        if cursor is None:
            return default
    return cursor


def read_json_payload(path):
    if not path or not Path(path).exists():
        return None
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def first_present(*values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def normalize_hardware_profile(value):
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get('profile') or value.get('id') or value.get('name')
    text = str(value).strip()
    return text or None


def normalize_device_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def extract_runtime_seconds(payload):
    direct = pick_numeric(
        get_nested(payload, ('run_info', 'run_time_seconds')),
        get_nested(payload, ('run_info', 'run_time_seconds', 'mean')),
        get_nested(payload, ('run', 'run_time_seconds')),
        get_nested(payload, ('run', 'duration_s')),
        get_nested(payload, ('duration_s',)),
    )
    if direct is not None:
        return direct

    started_at = parse_datetime(get_nested(payload, ('run', 'started_at')))
    finished_at = parse_datetime(get_nested(payload, ('run', 'finished_at')))
    if started_at and finished_at:
        return max(0.0, (finished_at - started_at).total_seconds())

    return None


def extract_runtime_hardware_info(payload, fallback=None):
    fallback = fallback or {}
    runtime_seconds = first_present(
        pick_numeric(fallback.get('run_time_seconds')),
        extract_runtime_seconds(payload),
        pick_numeric(fallback.get('duration_s')),
    )

    requested_device = normalize_device_text(first_present(
        get_nested(payload, ('artifacts', 'method', 'device', 'requested')),
        get_nested(payload, ('config', 'method', 'device', 'device')),
        get_nested(payload, ('config', 'method', 'device', 'requested')),
        fallback.get('method_device_requested'),
    ))
    resolved_device = normalize_device_text(first_present(
        get_nested(payload, ('artifacts', 'method', 'device', 'resolved')),
        get_nested(payload, ('config', 'method', 'device', 'resolved_device')),
        fallback.get('method_device_resolved'),
    ))
    hardware_profile = normalize_hardware_profile(first_present(
        get_nested(payload, ('run_info', 'hardware_profile')),
        get_nested(payload, ('config', 'limits', 'profile')),
        fallback.get('limits.profile'),
        fallback.get('hardware_profile'),
    ))

    gpu_device = normalize_device_text(first_present(
        get_nested(payload, ('run_info', 'gpu_device')),
        get_nested(payload, ('hardware', 'gpu_device')),
        fallback.get('gpu_device'),
    ))

    resolved_lower = (resolved_device or '').lower()
    if not gpu_device:
        if resolved_lower.startswith('cpu'):
            gpu_device = 'CPU'
        elif resolved_lower.startswith('cuda'):
            gpu_device = 'Unknown'
        else:
            gpu_device = 'Unknown'

    profile_lower = (hardware_profile or '').lower()
    gpu_lower = gpu_device.lower()
    mismatch = False
    reasons = []

    if resolved_lower.startswith('cuda') and gpu_lower == 'cpu':
        mismatch = True
        reasons.append('resolved device is cuda but detected GPU is CPU')

    if profile_lower and profile_lower not in {'auto', 'none', 'default', 'unknown', 'cpu', 'cuda'}:
        if gpu_lower == 'unknown':
            reasons.append('specific hardware profile requested but GPU name is unavailable')
        elif profile_lower not in gpu_lower:
            mismatch = True
            reasons.append(f'profile {hardware_profile} not found in detected GPU {gpu_device}')

    explicit_mismatch = first_present(
        get_nested(payload, ('run_info', 'hardware_mismatch')),
        fallback.get('hardware_mismatch'),
    )
    if explicit_mismatch is True:
        mismatch = True
    elif explicit_mismatch is False and not mismatch:
        mismatch = False

    return prune_empty({
        'run_time_seconds': runtime_seconds,
        'gpu_device': gpu_device,
        'hardware_profile': hardware_profile,
        'method_device_requested': requested_device,
        'method_device_resolved': resolved_device,
        'hardware_mismatch': mismatch,
        'hardware_mismatch_reason': '; '.join(reasons) if reasons else None,
    })


def merge_runtime_hardware_into_results(results, payload=None, fallback=None):
    payload = payload if isinstance(payload, dict) else {}
    fallback_values = dict(fallback or {})
    fallback_values.update(results)
    info = extract_runtime_hardware_info(payload, fallback_values)

    for key, value in info.items():
        if key == 'hardware_mismatch':
            results[key] = bool(value)
        else:
            results[key] = value

    if info.get('run_time_seconds') is not None:
        results['duration_s'] = info['run_time_seconds']

    if info.get('hardware_profile') is not None:
        results.setdefault('limits.profile', info['hardware_profile'])

    return info


def annotate_payload_with_run_info(payload, info):
    if not isinstance(payload, dict) or not info:
        return payload

    run_info = payload.get('run_info')
    if not isinstance(run_info, dict):
        run_info = {}

    for source_key, target_key in (
        ('run_time_seconds', 'run_time_seconds'),
        ('gpu_device', 'gpu_device'),
        ('hardware_profile', 'hardware_profile'),
        ('hardware_mismatch', 'hardware_mismatch'),
        ('hardware_mismatch_reason', 'hardware_mismatch_reason'),
    ):
        if info.get(source_key) is not None:
            run_info[target_key] = info[source_key]

    payload['run_info'] = run_info
    payload['hardware_mismatch'] = bool(info.get('hardware_mismatch'))
    if info.get('hardware_mismatch_reason'):
        payload['hardware_mismatch_reason'] = info['hardware_mismatch_reason']

    return payload


def write_annotated_run_payload(run_id, payload, info):
    if not run_id or not isinstance(payload, dict):
        return

    artifact_dir = Path('dashboard/public/data/artifacts') / str(run_id)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    try:
        with open(artifact_dir / 'run.json', 'w', encoding='utf-8') as f:
            json.dump(annotate_payload_with_run_info(payload, info), f, indent=2)
    except Exception as e:
        print(f"Error writing annotated run json for {run_id}: {e}")


def normalize_status(value):
    if value is None:
        return None
    status = str(value).strip().upper()
    if not status:
        return None
    if status in {'SUCCESS', 'SUCCEEDED', 'OK'}:
        return 'OK'
    if status in {'FAIL', 'FAILED', 'ERROR'}:
        return 'FAIL'
    return status


def infer_target_regime(run_id, run_payload):
    if run_id:
        direct = RUN_ID_REGIME_RE.match(run_id)
        if direct:
            return direct.group(1).upper()

    for candidate in (
        get_nested(run_payload, ('config', 'target_regime')),
        get_nested(run_payload, ('run', 'target_regime')),
        get_nested(run_payload, ('run', 'name')),
    ):
        if not candidate:
            continue
        match = TOKEN_REGIME_RE.search(str(candidate))
        if match:
            return match.group(1).upper()

    return None


def normalize_target_regime(value):
    if value is None:
        return None
    regime = str(value).strip().upper()
    if REGIME_ONLY_RE.match(regime):
        return regime
    return None


def regime_sort_key(value):
    regime = normalize_target_regime(value)
    if not regime:
        return (1, str(value or ''))
    return (0, int(REGIME_ONLY_RE.match(regime).group(1)))


def pick_numeric(*values):
    for value in values:
        n = to_float(value)
        if n is not None:
            return n
    return None


def extract_labeled_count(run):
    return pick_numeric(
        run.get('train_labeled_n'),
        run.get('sampling.stats.train_labeled.n'),
        run.get('artifacts.sampling.stats.train_labeled.n'),
        run.get('sampling.stats.labeled'),
        run.get('artifacts.sampling.stats.labeled'),
        run.get('sampling.stats.labeled_class_dist.n'),
        run.get('artifacts.sampling.stats.labeled_class_dist.n'),
    )


def extract_train_count(run):
    return pick_numeric(
        run.get('train_n'),
        run.get('sampling.stats.train.n'),
        run.get('artifacts.sampling.stats.train.n'),
        run.get('sampling.stats.train'),
        run.get('artifacts.sampling.stats.train'),
    )


def build_run_summary(run):
    summary_fields = [
        'run_id',
        'run_kind',
        'method_id',
        'dataset_id',
        'paradigm',
        'modality',
        'target_regime',
        'test_accuracy',
        'test_macro_f1',
        'val.accuracy',
        'val.macro_f1',
        'test_accuracy_mean',
        'test_accuracy_std',
        'test_accuracy_min',
        'test_accuracy_max',
        'test_accuracy_count',
        'test_accuracy_values',
        'test_macro_f1_mean',
        'test_macro_f1_std',
        'test_macro_f1_min',
        'test_macro_f1_max',
        'test_macro_f1_count',
        'test_macro_f1_values',
        'val_accuracy_mean',
        'val_accuracy_std',
        'val_accuracy_min',
        'val_accuracy_max',
        'val_accuracy_count',
        'val_accuracy_values',
        'val_macro_f1_mean',
        'val_macro_f1_std',
        'val_macro_f1_min',
        'val_macro_f1_max',
        'val_macro_f1_count',
        'val_macro_f1_values',
        'duration_s',
        'run_time_seconds',
        'run_time_seconds_mean',
        'run_time_seconds_std',
        'run_time_seconds_min',
        'run_time_seconds_max',
        'run_time_seconds_count',
        'run_time_seconds_values',
        'gpu_device',
        'gpu_devices',
        'hardware_profile',
        'hardware_mismatch',
        'hardware_mismatch_count',
        'hardware_mismatch_reason',
        'method_device_requested',
        'method_device_resolved',
        'method_device_dtype',
        'seed',
        'seed_count',
        'seeds',
        'seed_runs',
        'status',
        'exit_code',
        'error',
    ]
    protocol_fields = [
        'dataset.options.class_filter',
        'sampling.split.kind',
        'sampling.split.test_fraction',
        'sampling.split.val_fraction',
        'sampling.split.stratify',
        'sampling.split.shuffle',
        'sampling.labeling.mode',
        'sampling.labeling.value',
        'sampling.labeling.strategy',
        'sampling.labeling.min_per_class',
        'sampling.labeling.per_class',
        'sampling.imbalance.kind',
        'sampling.policy.respect_official_test',
        'sampling.policy.use_official_graph_masks',
        'sampling.policy.allow_override_official',
        'preprocess.fit_on',
        'preprocess.cache',
        'preprocess.steps',
        'augmentation.enabled',
        'augmentation.mode',
        'augmentation.modality',
        'augmentation.weak.steps',
        'augmentation.strong.steps',
        'method.model.classifier_id',
        'method.model.classifier_backend',
        'limits.profile',
        'evaluation.split_for_model_selection',
        'evaluation.report_splits',
        'evaluation.metrics',
    ]

    summary = {field: run.get(field) for field in summary_fields}
    summary.update({field: run.get(field) for field in protocol_fields})
    summary['target_regime'] = normalize_target_regime(summary.get('target_regime'))

    raw_data_urls = run.get('raw_data_urls')
    if isinstance(raw_data_urls, dict):
        summary['raw_data_urls'] = {k: v for k, v in raw_data_urls.items() if v}
    else:
        summary['raw_data_urls'] = {}

    train_labeled_n = extract_labeled_count(run)
    if train_labeled_n is not None:
        summary['train_labeled_n'] = train_labeled_n

    train_n = extract_train_count(run)
    if train_n is not None:
        summary['train_n'] = train_n

    return prune_empty(summary)


def infer_regime_label_count(runs):
    votes = {}
    for run in runs:
        labeled = extract_labeled_count(run)
        if labeled is None:
            continue
        key = str(int(round(labeled)))
        votes[key] = votes.get(key, 0) + 1

    best = None
    best_freq = -1
    for key, freq in votes.items():
        value = int(key)
        if freq > best_freq or (freq == best_freq and (best is None or value < best)):
            best = value
            best_freq = freq
    return best


def get_method_family(method_id):
    return METHOD_FAMILY.get(method_id, 'Other')


def is_successful_compact_run(run):
    if run.get('error'):
        return False
    status = str(run.get('status') or '').strip().upper()
    return not status or status in {'OK', 'SUCCESS', 'SUCCEEDED'}


def is_visible_compact_run(run):
    dataset_id = run.get('dataset_id')
    return not dataset_id or dataset_id not in HIDDEN_BENCHMARK_DATASET_IDS


def runtime_value_for_summary(run):
    return pick_numeric(
        run.get('run_time_seconds'),
        run.get('run_time_seconds_mean'),
        run.get('duration_s'),
    )


def write_runtime_summaries(compact_runs, output_dir):
    rows = []
    runs = [
        run for run in compact_runs
        if is_successful_compact_run(run)
        and is_visible_compact_run(run)
        and runtime_value_for_summary(run) is not None
    ]

    for include_mismatches in (True, False):
        filtered = runs if include_mismatches else [
            run for run in runs if run.get('hardware_mismatch') is not True
        ]

        groups = {}
        for run in filtered:
            group_key = (
                run.get('method_id'),
                get_method_family(run.get('method_id')),
                run.get('dataset_id'),
                run.get('target_regime'),
                run.get('modality'),
            )
            groups.setdefault(group_key, []).append(run)

        for (method_id, family, dataset_id, regime, modality), group_runs in groups.items():
            values = [runtime_value_for_summary(run) for run in group_runs]
            stats = summarize_numeric(values)
            if not stats:
                continue
            hardware_mismatch_count = sum(1 for run in group_runs if run.get('hardware_mismatch') is True)
            gpu_devices = sorted({run.get('gpu_device') for run in group_runs if run.get('gpu_device')})
            hardware_profiles = sorted({
                run.get('hardware_profile') or run.get('limits.profile')
                for run in group_runs
                if run.get('hardware_profile') or run.get('limits.profile')
            })
            rows.append({
                'hardware_filter': 'all' if include_mismatches else 'matched_only',
                'method_id': method_id,
                'family': family,
                'dataset_id': dataset_id,
                'target_regime': regime,
                'modality': modality,
                'count': stats['count'],
                'mean': stats['mean'],
                'std': stats['std'],
                'min': stats['min'],
                'max': stats['max'],
                'hardware_mismatch_count': hardware_mismatch_count,
                'gpu_devices': '|'.join(gpu_devices),
                'hardware_profiles': '|'.join(hardware_profiles),
            })

    rows.sort(key=lambda row: (
        row['hardware_filter'],
        regime_sort_key(row.get('target_regime')),
        str(row.get('modality') or ''),
        str(row.get('family') or ''),
        str(row.get('method_id') or ''),
        str(row.get('dataset_id') or ''),
    ))

    if not rows:
        return

    fieldnames = [
        'hardware_filter',
        'method_id',
        'family',
        'dataset_id',
        'target_regime',
        'modality',
        'count',
        'mean',
        'std',
        'min',
        'max',
        'hardware_mismatch_count',
        'gpu_devices',
        'hardware_profiles',
    ]

    public_csv = output_dir / 'runtime-summary.csv'
    public_json = output_dir / 'runtime-summary.json'
    with open(public_csv, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    with open(public_json, 'w', encoding='utf-8') as f:
        json.dump(rows, f, indent=2)

    analysis_dir = Path('analysis/output')
    analysis_dir.mkdir(parents=True, exist_ok=True)
    with open(analysis_dir / 'runtime_summary.csv', 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    with open(analysis_dir / 'runtime_summary.json', 'w', encoding='utf-8') as f:
        json.dump(rows, f, indent=2)

    try:
        import pandas as pd  # type: ignore

        frame = pd.DataFrame(rows)
        frame.to_parquet(output_dir / 'runtime-summary.parquet', index=False)
        frame.to_parquet(analysis_dir / 'runtime_summary.parquet', index=False)
    except Exception as e:
        print(f"Runtime parquet summary skipped: {e}")


def write_compact_results(all_runs, output_dir):
    compact_runs = [build_run_summary(run) for run in all_runs]
    compact_runs = [run for run in compact_runs if run.get('run_id')]
    compact_runs.sort(
        key=lambda run: (
            regime_sort_key(run.get('target_regime')),
            str(run.get('dataset_id') or ''),
            str(run.get('method_id') or ''),
            str(run.get('run_id') or ''),
        )
    )

    # Backward-compatible single file (now compact).
    with open(output_dir / 'results.json', 'w', encoding='utf-8') as f:
        json.dump(compact_runs, f, indent=2)

    results_dir = output_dir / 'results'
    results_dir.mkdir(parents=True, exist_ok=True)
    for stale in results_dir.glob('*.json'):
        stale.unlink()

    runs_by_regime = {}
    for run in compact_runs:
        regime = normalize_target_regime(run.get('target_regime'))
        if not regime:
            continue
        runs_by_regime.setdefault(regime, []).append(run)

    if not runs_by_regime and compact_runs:
        runs_by_regime['UNKNOWN'] = compact_runs

    manifest_chunks = []
    for regime in sorted(runs_by_regime.keys(), key=regime_sort_key):
        regime_runs = runs_by_regime[regime]
        chunk_file = results_dir / f'{regime}.json'
        with open(chunk_file, 'w', encoding='utf-8') as f:
            json.dump(regime_runs, f, indent=2)

        manifest_chunks.append(
            {
                'regime': regime,
                'path': f'data/results/{regime}.json',
                'run_count': len(regime_runs),
                'label_count': infer_regime_label_count(regime_runs),
            }
        )

    manifest_total = sum(chunk['run_count'] for chunk in manifest_chunks)
    manifest = {
        'schema_version': 1,
        'total_runs': manifest_total,
        'default_regime': manifest_chunks[0]['regime'] if manifest_chunks else None,
        'chunks': manifest_chunks,
    }

    with open(output_dir / 'results-manifest.json', 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    write_runtime_summaries(compact_runs, output_dir)

    return compact_runs


def extract_run_data_from_artifact_dir(artifact_dir):
    artifact_dir = Path(artifact_dir)
    if not artifact_dir.is_dir():
        return None

    run_json_path = artifact_dir / 'run.json'
    if not run_json_path.exists():
        return None

    run_id = artifact_dir.name
    try:
        with open(run_json_path, 'r', encoding='utf-8', errors='ignore') as f:
            payload = json.load(f)
    except Exception as e:
        print(f"Error reading artifact run json {run_json_path}: {e}")
        return None

    if not isinstance(payload, dict):
        return None

    config_payload = get_nested(payload, ('config',), default={})
    if not isinstance(config_payload, dict):
        config_payload = {}

    method_id = (
        get_nested(payload, ('artifacts', 'method', 'id'))
        or get_nested(payload, ('method', 'id'))
        or get_nested(config_payload, ('method', 'id'))
    )
    paradigm = (
        get_nested(payload, ('artifacts', 'method', 'kind'))
        or get_nested(payload, ('run', 'benchmark_mode'))
    )
    modality = (
        get_nested(payload, ('artifacts', 'dataset', 'info', 'modality'))
        or get_nested(config_payload, ('dataset', 'modality'))
    )
    dataset_id = (
        get_nested(payload, ('artifacts', 'dataset', 'id'))
        or get_nested(config_payload, ('dataset', 'id'))
    )

    status = normalize_status(get_nested(payload, ('run', 'status')))
    exit_code = (
        to_int(get_nested(payload, ('run', 'exit_code')))
        if get_nested(payload, ('run', 'exit_code')) is not None
        else to_int(get_nested(payload, ('run', 'error_code')))
    )
    if exit_code is None and status == 'OK':
        exit_code = 0

    error_value = payload.get('error')
    if isinstance(error_value, dict):
        error_value = json.dumps(error_value, ensure_ascii=False)
    elif error_value is not None and not isinstance(error_value, str):
        error_value = str(error_value)
    if status == 'FAIL' and not error_value:
        if exit_code is not None:
            error_value = f"status=FAIL exit_code={exit_code}"
        else:
            error_value = "status=FAIL"

    results = {
        'run_id': run_id,
        'raw_data_urls': {
            'run': f"data/artifacts/{run_id}/run.json",
        },
        'history': [],
        'method_id': method_id,
        'paradigm': paradigm,
        'modality': modality,
        'dataset_id': dataset_id,
        'target_regime': infer_target_regime(run_id, payload),
        'status': status,
        'exit_code': exit_code,
        'error': error_value,
        'seed': to_int(get_nested(payload, ('run', 'seed'))),
        'duration_s': to_float(get_nested(payload, ('run', 'duration_s'))),
        'test_accuracy': to_float(get_nested(payload, ('metrics', 'test', 'accuracy'))),
        'test_macro_f1': to_float(get_nested(payload, ('metrics', 'test', 'macro_f1'))),
        'val.accuracy': to_float(get_nested(payload, ('metrics', 'val', 'accuracy'))),
        'val.macro_f1': to_float(get_nested(payload, ('metrics', 'val', 'macro_f1'))),
    }
    merge_runtime_hardware_into_results(results, payload)

    config_path = artifact_dir / 'config.yaml'
    if config_path.exists():
        results['raw_data_urls']['config'] = f"data/artifacts/{run_id}/config.yaml"

    log_path = artifact_dir / 'run.log'
    if log_path.exists():
        results['raw_data_urls']['log'] = f"data/artifacts/{run_id}/run.log"

    method_params = (
        get_nested(config_payload, ('method', 'params'))
        if isinstance(config_payload, dict)
        else None
    )
    if isinstance(method_params, dict):
        for key, value in flatten_dict(method_params, parent_key='params').items():
            results[key] = value

    sampling_stats = get_nested(payload, ('artifacts', 'sampling', 'stats'))
    if isinstance(sampling_stats, dict):
        for key, value in flatten_dict(sampling_stats, parent_key='sampling.stats').items():
            results[key] = value

    ensure_fallback_artifacts(results, artifact_dir, run_id, source_row=None)
    return results


def main():
    output_dir = Path('dashboard/public/data')
    output_dir.mkdir(parents=True, exist_ok=True)

    all_runs = []
    seen_run_ids = set()
    # Source: logs/status/*.tsv (new structure)
    status_dir = Path('logs/status')
    if status_dir.exists():
        for row in iter_status_rows(status_dir):
            run_data_or_list = extract_run_data_from_status_row(row)
            if not run_data_or_list:
                continue
            
            if isinstance(run_data_or_list, dict):
                entries = [run_data_or_list]
            else:
                entries = run_data_or_list

            for entry in entries:
                run_id = entry.get('run_id')
                if not run_id:
                    continue
                if run_id in seen_run_ids:
                    continue
                all_runs.append(entry)
                seen_run_ids.add(run_id)
    else:
        print('Directory logs/status not found; trying logs/bench fallback.')
        bench_dir = Path('logs/bench')
        if bench_dir.exists():
            for log_path in sorted(bench_dir.rglob('*.log')):
                run_data_or_list = extract_run_data_from_bench_log(log_path)
                if not run_data_or_list:
                    continue

                if isinstance(run_data_or_list, dict):
                    entries = [run_data_or_list]
                else:
                    entries = run_data_or_list

                for entry in entries:
                    run_id = entry.get('run_id')
                    if run_id and run_id not in seen_run_ids:
                        all_runs.append(entry)
                        seen_run_ids.add(run_id)

    if not all_runs:
        artifacts_root = output_dir / 'artifacts'
        if artifacts_root.exists():
            print('No logs found; rebuilding results from artifacts.')
            for artifact_dir in sorted(artifacts_root.iterdir()):
                run_data = extract_run_data_from_artifact_dir(artifact_dir)
                if not run_data:
                    continue
                run_id = run_data.get('run_id')
                if not run_id or run_id in seen_run_ids:
                    continue
                all_runs.append(run_data)
                seen_run_ids.add(run_id)

    compact_runs = write_compact_results(all_runs, output_dir)
    output_file = output_dir / 'results.json'

    print(f"Successfully processed {len(compact_runs)} runs. Data saved to {output_file}")


if __name__ == '__main__':
    main()
