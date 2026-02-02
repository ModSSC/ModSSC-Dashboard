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
