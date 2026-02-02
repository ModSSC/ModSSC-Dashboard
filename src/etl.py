import os
import json
import yaml
import re
import pandas as pd
import shutil
from pathlib import Path
from datetime import datetime

def parse_log_file(log_path):
    """
    Parses a log file to extract training curves from DEBUG lines.
    Supports:
    1. Dictionary format: "epoch=1 ... metrics={'acc': 0.1}"
    2. Flat format: "Method epoch=1 p_rel=0.6"
    """
    history = []
    
    # Pattern 1: Dictionary
    pattern_dict = re.compile(r"epoch=(\d+).*metrics=({.*})")
    
    # Pattern 2: Flat generic key=value
    pattern_flat_epoch = re.compile(r"epoch=(\d+)")
    
    try:
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if 'DEBUG' not in line:
                    continue

                # 1. Try dictionary format
                match_dict = pattern_dict.search(line)
                if match_dict:
                    try:
                        epoch = int(match_dict.group(1))
                        metrics_str = match_dict.group(2)
                        # Parse pseudo-json
                        import ast
                        metrics = ast.literal_eval(metrics_str)
                        
                        entry = {'epoch': epoch}
                        entry.update(metrics)
                        history.append(entry)
                        continue
                    except Exception:
                        pass
                
                # 2. Try flat format (fallback)
                if 'epoch=' in line:
                    match_epoch = pattern_flat_epoch.search(line)
                    if match_epoch:
                        epoch = int(match_epoch.group(1))
                        
                        # Extract all key=value pairs
                        # \w+ key, and numeric value
                        pairs = re.findall(r"(\w+)=([-+]?\d*\.\d+|\d+)", line)
                        
                        if pairs:
                            entry = {'epoch': epoch}
                            valid_entry = False
                            for k, v in pairs:
                                if k == 'epoch': continue
                                try:
                                    entry[k] = float(v)
                                    valid_entry = True
                                except ValueError:
                                    pass
                            
                            if valid_entry:
                                history.append(entry)
    except Exception as e:
        print(f"Error parsing log {log_path}: {e}")
        
    return history

def flatten_dict(d, parent_key='', sep='.'):
    items = []
    for k, v in d.items():
        new_key = parent_key + sep + k if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep=sep).items())
        else:
            items.append((new_key, v))
    return dict(items)

def extract_run_data(run_dir):
    run_dir = Path(run_dir).resolve()
    results = {}
    
    # Prepare artifacts directory
    run_id = run_dir.name
    artifacts_dir = Path(f'dashboard/public/data/artifacts/{run_id}')
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    
    results['raw_data_urls'] = {}

    # 1. Parse config.yaml
    config_path = run_dir / 'config.yaml'
    if config_path.exists():
        try:
            # Copy file
            shutil.copy(config_path, artifacts_dir / 'config.yaml')
            results['raw_data_urls']['config'] = f"data/artifacts/{run_id}/config.yaml"

            with open(config_path, 'r') as f:
                config = yaml.safe_load(f)
                if config:
                    # Extract specific fields as requested
                    results['method_id'] = config.get('method', {}).get('id')
                    results['seed'] = config.get('run', {}).get('seed')
                    
                    # Flatten params
                    params = config.get('method', {}).get('params', {})
                    for k, v in flatten_dict(params, parent_key='params').items():
                        results[k] = v
        except Exception as e:
            print(f"Error reading config {config_path}: {e}")

    # 2. Parse run.json
    json_path = run_dir / 'run.json'
    if json_path.exists():
        try:
            # Copy file
            shutil.copy(json_path, artifacts_dir / 'run.json')
            results['raw_data_urls']['run'] = f"data/artifacts/{run_id}/run.json"

            with open(json_path, 'r') as f:
                data = json.load(f)
                
                # Metrics
                metrics = data.get('metrics') or {}
                test_metrics = metrics.get('test') or {}
                results['test_accuracy'] = test_metrics.get('accuracy')
                results['test_macro_f1'] = test_metrics.get('macro_f1')
                
                # Error (New)
                results['error'] = data.get('error')
                
                # Get all validation metrics flattened
                val_metrics = metrics.get('val') or {}
                for k, v in flatten_dict(val_metrics, parent_key='val').items():
                    results[k] = v
                    
                # Duration
                if 'duration_s' in data.get('run', {}):
                    results['duration_s'] = data['run']['duration_s']
                # Fallback calculation
                elif 'started_at' in data.get('run', {}) and 'finished_at' in data.get('run', {}):
                    try:
                       start = datetime.fromisoformat(data['run']['started_at'])
                       end = datetime.fromisoformat(data['run']['finished_at'])
                       results['duration_s'] = (end - start).total_seconds()
                    except:
                        pass

                # Dataset artifact
                artifacts = data.get('artifacts', {})
                results['dataset_id'] = artifacts.get('dataset', {}).get('id')
                
        except Exception as e:
            print(f"Error reading run.json {json_path}: {e}")

    # 3. Parse Metadata from Path
    # Expected structure: runs/run/{paradigm}/{method}/{modality}/{dataset}/{run_id}
    parts = run_dir.parts
    
    # Defaults
    results['paradigm'] = 'unknown'
    results['modality'] = 'unknown'

    # Special handling for supervised runs which might use 'pseudo_label' config
    if 'supervised' in parts:
        results['method_id'] = 'supervised'

    # Extract Paradigm
    if 'inductive' in parts:
        results['paradigm'] = 'inductive'
    elif 'transductive' in parts:
        results['paradigm'] = 'transductive'
    
    # Extract Modality
    known_modalities = ['text', 'audio', 'vision', 'graph', 'tabular']
    for m in known_modalities:
        if m in parts:
            results['modality'] = m
            break
            
    # 4. Parse Logs
    log_file = None
    # Check inside run dir first
    log_files = list(run_dir.glob('*.log'))
    if log_files:
        log_file = log_files[0]
    else:
        # Fallback: Look for detached log file in parallel runs/log hierarchy
        # Pattern: runs/run/.../dataset/run_id -> runs/log/.../dataset.log
        try:
            dataset_dir = run_dir.parent # .../dataset
            dataset_path_str = str(dataset_dir)
            
            # Replace /runs/run/ with /runs/log/
            # We look for the last occurrence associated with the root layout
            if '/runs/run/' in dataset_path_str:
                log_base = dataset_path_str.replace('/runs/run/', '/runs/log/')
                potential_log = Path(log_base + '.log')
                if potential_log.exists():
                    log_file = potential_log
            
            # Handle plural form /runs/runs/ -> /runs/log/
            elif '/runs/runs/' in dataset_path_str:
                log_base = dataset_path_str.replace('/runs/runs/', '/runs/log/')
                potential_log = Path(log_base + '.log')
                if potential_log.exists():
                    log_file = potential_log
            
            # Legacy/Alternative: maybe just /run/ -> /log/ if root is different
            elif '/run/' in dataset_path_str:
                 # Check if 'log' is a sibling of 'run' parent
                 # This is a bit riskier, stick to the known structure if possible
                 pass

        except Exception as e:
            print(f"Error finding log for {run_dir}: {e}")

    if log_file:
         # Copy file
         try:
            shutil.copy(log_file, artifacts_dir / 'run.log')
            results['raw_data_urls']['log'] = f"data/artifacts/{run_id}/run.log"
         except Exception as e:
            print(f"Error copying log {log_file}: {e}")

         if 'adamatch' in str(run_dir) and 'adult' in str(run_dir):
             msg = f"DEBUG: Parsing log for Adamatch/Adult: {log_file}\n"
             with open('debug_etl.txt', 'a') as df: df.write(msg)
             
             hist = parse_log_file(log_file)
             
             msg2 = f"DEBUG: Parsed {len(hist)} entries. First: {hist[0] if hist else 'None'}\n"
             with open('debug_etl.txt', 'a') as df: df.write(msg2)
             
             results['history'] = hist
         else:
             results['history'] = parse_log_file(log_file)
    else:
        results['history'] = []
        if 'adamatch' in str(run_dir) and 'adult' in str(run_dir):
             msg = f"DEBUG: Adamatch/Adult log file NOT FOUND inside {run_dir}\n"
             with open('debug_etl.txt', 'a') as df: df.write(msg)

    results['run_id'] = run_id
    return results

def main():
    # Clear debug log
    with open('debug_etl.txt', 'w') as f: f.write("ETL Start\n")
    
    root_dir = 'runs'
    all_runs = []
    
    if not os.path.exists(root_dir):
        print(f"Directory {root_dir} not found.")
        return

    # Recursively find runs. A run is defined by presence of config.yaml or run.json
    for root, dirs, files in os.walk(root_dir):
        if 'run.json' in files or 'config.yaml' in files:
            print(f"Processing {root}...")
            run_data = extract_run_data(root)
            all_runs.append(run_data)
            
    # Save to public/data/results.json
    output_dir = Path('dashboard/public/data')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    output_file = output_dir / 'results.json'
    with open(output_file, 'w') as f:
        json.dump(all_runs, f, indent=2)
    
    print(f"Successfully processed {len(all_runs)} runs. Data saved to {output_file}")

if __name__ == '__main__':
    main()
