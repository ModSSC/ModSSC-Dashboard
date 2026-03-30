import ast
import csv
import json
import re
import shutil
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
RUN_ID_REGIME_RE = re.compile(r"^(R\d+)_")
TOKEN_REGIME_RE = re.compile(r"(?:^|[_-])(R\d+)(?:[_-]|$)", re.IGNORECASE)
REGIME_ONLY_RE = re.compile(r"^R(\d+)$", re.IGNORECASE)


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

        if results.get('seed') is None:
            results['seed'] = config.get('run', {}).get('seed')

        params = config.get('method', {}).get('params', {})
        if isinstance(params, dict):
            for k, v in flatten_dict(params, parent_key='params').items():
                # Keep params from logs if already available.
                results.setdefault(k, v)

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

    summary = parse_bench_log_summary(log_path)
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

    summary = parse_bench_log_summary(log_path)
    results.update(summary)

    output_run_json_path = copy_output_run_json_into_artifacts(results, artifacts_dir, run_id)
    hydrate_config_from_available_sources(
        results,
        artifacts_dir,
        run_id,
        source_row=None,
        output_run_json_path=output_run_json_path,
    )

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
        'method_id',
        'dataset_id',
        'paradigm',
        'modality',
        'target_regime',
        'test_accuracy',
        'test_macro_f1',
        'val.accuracy',
        'val.macro_f1',
        'duration_s',
        'seed',
        'status',
        'exit_code',
        'error',
    ]

    summary = {field: run.get(field) for field in summary_fields}
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
            run_data = extract_run_data_from_status_row(row)
            if not run_data:
                continue
            run_id = run_data.get('run_id')
            if not run_id:
                continue
            if run_id in seen_run_ids:
                continue
            all_runs.append(run_data)
            seen_run_ids.add(run_id)
    else:
        print('Directory logs/status not found; trying logs/bench fallback.')
        bench_dir = Path('logs/bench')
        if bench_dir.exists():
            for log_path in sorted(bench_dir.rglob('*.log')):
                run_data = extract_run_data_from_bench_log(log_path)
                run_id = run_data.get('run_id')
                if run_id and run_id not in seen_run_ids:
                    all_runs.append(run_data)
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
