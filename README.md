# ModSSC-Dashboard

The official visualization dashboard for the ModSSC benchmark project. It allows researchers to explore, analyze, and inspect the results of Semi-Supervised Learning (SSL) experiments.

## Project Structure

- `dashboard/`: React-based visualization frontend (Vite + Tailwind + Recharts).
- `runs/`: Experiment logs and configuration files from ModSSC.
- `src/etl.py`: ETL pipeline to parse logs (extracting metrics, configs, and logs) into `dashboard/public/data`.
- `.github/workflows/deploy.yml`: CI/CD for automated ETL and GitHub Pages deployment.

## Getting Started

### Prerequisites

- Node.js (v18+)
- Python (v3.10+)

### Development

1. **Process Data**:
   ```bash
   pip install pandas pyyaml
   python src/etl.py
   ```

2. **Run Dashboard**:
   ```bash
   cd dashboard
   npm install
   npm run dev
   ```

### Deployment

The project is configured to automatically deploy to GitHub Pages on every push to the `main` branch. The deployment process includes:
1. Running the ETL script to refresh data.
2. Building the React application.
3. Deploying the static files to the `gh-pages` branch.

## Analytics Tabs

The dashboard exposes the leaderboard matrix at `/` and additional analytics routes:

- `/coverage`: modality/regime coverage for successful visible runs.
- `/families`: family-level normalized rank across regimes.
- `/variability`: seed variability box plots from multi-seed sweeps.
- `/performance`: runtime and hardware diagnostics, including family-level runtime charts, hardware filters, and mismatch review.
- `/case-studies`: representative dataset trajectories across regimes.
- `/pipelines`: canonical preprocessing and augmentation protocol summaries.
- `/variability-design`: non-method design axes such as sampling, preprocessing, evaluation, and class filtering.
- `/modality`: modality-specific method explorer with per-family/per-method charts and cross-modality comparison.

All analytics pages reuse the public `data/results-manifest.json` chunks, exclude hidden datasets, and ignore crashed runs. Method families are encoded in `dashboard/src/lib/methodFamilies.js`; pipeline summaries combine compact protocol fields extracted by `src/etl.py` with documented canonical ModSSC presets.

## Runtime And Hardware Metadata

The ModSSC benchmark runner writes, and the dashboard ETL expects, each future `run.json` to expose:

```json
{
  "run_info": {
    "run_time_seconds": 123.456,
    "gpu_device": "NVIDIA A100-SXM4-80GB",
    "hardware_profile": "a100",
    "hardware_mismatch": false
  }
}
```

`run_time_seconds` is wall-clock runtime in seconds. `gpu_device` is the actual detected device name, or `CPU` for CPU runs. `hardware_profile` mirrors `config.limits.profile` so the expected profile can be compared with the actual device. `hardware_mismatch` is set when a specific profile does not match the detected GPU, or when a method resolves to CUDA but the run reports CPU.

For historical artefacts that do not yet contain `run_info`, `src/etl.py` derives runtime from `run.started_at` and `run.finished_at`, parses GPU names from bench logs when available, and falls back to `Unknown` when CUDA was resolved but no model name was recorded. Runtime summaries are exported to `dashboard/public/data/runtime-summary.{csv,json}` and `analysis/output/runtime_summary.{csv,json}`.
