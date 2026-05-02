import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card"
import { cn } from "../lib/utils";
import { Download, Calculator, Funnel } from 'lucide-react';
import { formatDatasetLabel, getDatasetFractionMap } from '../lib/dataset';

const toFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const metricStatKey = (metric, stat) => `${metric.replace(/\./g, '_')}_${stat}`;

const getMetricStat = (run, metric, stat) => {
    if (!run) return null;
    return toFiniteNumber(run[metricStatKey(metric, stat)]);
};

const getMetricCount = (run, metric) => {
    return getMetricStat(run, metric, 'count') ?? toFiniteNumber(run?.seed_count);
};

const formatPercent = (value) => `${(value * 100).toFixed(2)}%`;

const formatSeedList = (seeds) => {
    if (!Array.isArray(seeds) || seeds.length === 0) return null;
    return seeds.join(', ');
};

const BenchmarkMatrix = ({ runs, metric = "test_accuracy", onInspect }) => {
    const [compareMode, setCompareMode] = useState(false); // Default to absolute values
    const [baselineMethod, setBaselineMethod] = useState("");
    const [methodFilterMode, setMethodFilterMode] = useState("all"); // all | top | bottom

    // 1. Get unique Datasets and Methods
    const datasets = React.useMemo(() => 
        Array.from(new Set(runs.map(r => r.dataset_id).filter(id => id))).sort(),
        [runs]);

    const allMethods = React.useMemo(() => 
        Array.from(new Set(runs.map(r => r.method_id).filter(id => id))),
        [runs]);

    const datasetFractionMap = React.useMemo(() => getDatasetFractionMap(runs), [runs]);

    const datasetDisplayLabel = React.useCallback(
        (dataset) => formatDatasetLabel(dataset, datasetFractionMap[dataset]),
        [datasetFractionMap]
    );

    // 2. Build Data Map
    const dataMap = React.useMemo(() => {
        const map = {};

        runs.forEach(r => {
            const key = `${r.method_id}-${r.dataset_id}`;
            const val = toFiniteNumber(r[metric]);
            if (!r.error && val === null) return;
            
            // Logic: Prioritize success over error, then max value
            const current = map[key];
            
            // If new entry or (current is error and new is not) or (both success and new > old)
            if (!current || (current.error && !r.error) || (!r.error && val > current.val)) {
                map[key] = {
                    val: val ?? 0,
                    std: getMetricStat(r, metric, 'std'),
                    min: getMetricStat(r, metric, 'min'),
                    max: getMetricStat(r, metric, 'max'),
                    count: getMetricCount(r, metric),
                    error: r.error,
                    run: r,
                };
            }
            // If both are errors, just keep one (maybe the last one)
            else if (current.error && r.error) {
                 map[key] = { val: 0, std: null, min: null, max: null, count: null, error: r.error, run: r };
            }
        });
        return map;
    }, [runs, metric]);

    // 3. Build method ordering
    const methodsBaseOrder = React.useMemo(() => {
        let sorted = [...allMethods].sort();

        // PIN "supervised" to top
        const pinnedMethod = "supervised";
        if (sorted.includes(pinnedMethod)) {
            sorted = sorted.filter(m => m !== pinnedMethod);
            sorted.unshift(pinnedMethod);
        }

        return sorted;
    }, [allMethods]);

    const methodScoreMap = React.useMemo(() => {
        const scores = {};

        methodsBaseOrder.forEach((method) => {
            const values = [];

            datasets.forEach((dataset) => {
                const entry = dataMap[`${method}-${dataset}`];
                if (!entry || entry.error) return;

                if (compareMode && baselineMethod) {
                    const baseEntry = dataMap[`${baselineMethod}-${dataset}`];
                    if (!baseEntry || baseEntry.error) return;
                    values.push((entry.val - baseEntry.val) * 100);
                    return;
                }

                values.push(entry.val * 100);
            });

            if (values.length === 0) {
                scores[method] = null;
                return;
            }

            const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
            scores[method] = mean;
        });

        return scores;
    }, [methodsBaseOrder, datasets, dataMap, compareMode, baselineMethod]);

    const methodsSorted = React.useMemo(() => {
        if (methodFilterMode === "all") {
            return methodsBaseOrder;
        }

        const scoredMethods = [...methodsBaseOrder]
            .sort((a, b) => {
                const aScore = methodScoreMap[a];
                const bScore = methodScoreMap[b];
                if (aScore === null && bScore === null) return a.localeCompare(b);
                if (aScore === null) return 1;
                if (bScore === null) return -1;
                const delta = methodFilterMode === "top" ? bScore - aScore : aScore - bScore;
                if (Math.abs(delta) > 1e-9) return delta;
                return a.localeCompare(b);
            });

        return scoredMethods;
    }, [methodFilterMode, methodsBaseOrder, methodScoreMap]);

    const bestAbsoluteByDataset = React.useMemo(() => {
        if (compareMode || methodFilterMode !== "all") {
            return {};
        }

        const bestMap = {};
        datasets.forEach((dataset) => {
            let best = null;
            methodsBaseOrder.forEach((method) => {
                const entry = dataMap[`${method}-${dataset}`];
                if (!entry || entry.error) return;
                const value = entry.val * 100;
                if (best === null || value > best) {
                    best = value;
                }
            });
            bestMap[dataset] = best;
        });

        return bestMap;
    }, [compareMode, methodFilterMode, datasets, methodsBaseOrder, dataMap]);


    // Default baseline: Prioritize "supervised"
    React.useEffect(() => {
        if (!baselineMethod && methodsBaseOrder.length > 0) {
            if (methodsBaseOrder.includes("supervised")) {
                setBaselineMethod("supervised");
            } else {
                setBaselineMethod(methodsBaseOrder[0]);
            }
        }
    }, [methodsBaseOrder, baselineMethod]);

    const cycleMethodFilter = () => {
        setMethodFilterMode((prev) => {
            if (prev === "all") return "top";
            if (prev === "top") return "bottom";
            return "all";
        });
    };

    const filterLabel = React.useMemo(() => {
        if (methodFilterMode === "all") return "All Methods";
        if (methodFilterMode === "top") {
            return compareMode ? "Top Δ" : "Top Score";
        }
        return compareMode ? "Bottom Δ" : "Bottom Score";
    }, [methodFilterMode, compareMode]);

    const getCellValue = (method, dataset) => {
        const entry = dataMap[`${method}-${dataset}`];
        if (!entry) return null;
        if (entry.error) return "ERR";

        const val = entry.val;

        if (compareMode && baselineMethod) {
            const baseEntry = dataMap[`${baselineMethod}-${dataset}`];
            if (!baseEntry || baseEntry.error) return null; 
            return (val - baseEntry.val) * 100; // Percentage point diff
        }
        return val * 100;
    };

    const copyLatex = () => {
        let latex = "\\begin{table}[h]\n\\centering\n\\begin{tabular}{l" + "c".repeat(datasets.length) + "}\n\\toprule\n";
        latex += "Method & " + datasets
            .map(d => datasetDisplayLabel(d).replace(/_/g, '\\_').replace(/%/g, '\\%'))
            .join(" & ") + " \\\\\n\\midrule\n";

        methodsSorted.forEach(m => {
            const row = [m.replace(/_/g, '\\_')];
            datasets.forEach(d => {
                const entry = dataMap[`${m}-${d}`];
                if (!entry || entry.error) {
                    row.push("-");
                    return;
                }
                const std = typeof entry.std === 'number' ? ` $\\pm$ ${(entry.std * 100).toFixed(2)}` : "";
                row.push(`${(entry.val * 100).toFixed(2)}${std}`);
            });
            latex += row.join(" & ") + " \\\\\n";
        });

        latex += "\\bottomrule\n\\end{tabular}\n\\caption{Benchmark results.}\n\\label{tab:bench}\n\\end{table}";
        navigator.clipboard.writeText(latex);
        alert("LaTeX table code copied to clipboard!");
    };

    const getCellTitle = (entry, isDiff) => {
        if (!entry) return "";
        if (entry.error) return entry.error;
        if (isDiff) return "Click for details";

        const details = ["Click for details"];
        if (entry.count && entry.count > 1) {
            details.push(`${entry.count} seeds`);
        }
        if (typeof entry.min === 'number' && typeof entry.max === 'number') {
            details.push(`min ${formatPercent(entry.min)}, max ${formatPercent(entry.max)}`);
        }
        const seedList = formatSeedList(entry.run?.seeds);
        if (seedList) {
            details.push(`seeds ${seedList}`);
        }
        return details.join(' · ');
    };

    return (
        <Card className="overflow-hidden border-2 border-black/10 shadow-sm print:shadow-none">
            <CardHeader className="flex flex-row items-center justify-between bg-zinc-50/50 pb-4">
                <CardTitle className="text-xl font-serif tracking-tight">Benchmark Results ({metric === 'test_accuracy' ? 'Accuracy' : metric})</CardTitle>
                <div className="flex gap-2">
                    {/* Controls */}
                    <div className="flex items-center gap-4 mr-4">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={compareMode} onChange={e => setCompareMode(e.target.checked)} className="mr-1 accent-black" />
                            <span className="flex items-center gap-1"><Calculator className="w-3 h-3" /> Rel. to</span>
                        </label>
                        <select
                            className="bg-transparent border-b border-gray-300 text-sm focus:outline-none"
                            value={baselineMethod}
                            onChange={e => setBaselineMethod(e.target.value)}
                            disabled={!compareMode}
                        >
                            {methodsBaseOrder.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <button
                            type="button"
                            onClick={cycleMethodFilter}
                            className="px-2.5 py-1 text-xs font-semibold border rounded-md bg-white hover:bg-zinc-50 transition-colors flex items-center gap-1"
                            title="Cycle: all -> top -> bottom"
                        >
                            <Funnel className="w-3 h-3" />
                            {filterLabel}
                        </button>
                    </div>

                    <button
                        onClick={copyLatex}
                        className="flex items-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider bg-black text-white rounded hover:bg-zinc-800 transition-colors"
                    >
                        <Download className="w-3 h-3" /> LaTeX
                    </button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse font-serif">
                        <thead className="text-xs uppercase bg-white border-b-2 border-black">
                            <tr>
                                <th className="p-4 font-bold text-black border-r bg-gray-50/50 sticky left-0 z-10">Method</th>
                                {datasets.map(d => (
                                    <th key={d} className="p-4 text-center font-bold text-black border-r last:border-r-0 min-w-[100px]">
                                        {datasetDisplayLabel(d).replace(/_/g, ' ')}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {methodsSorted.map((method, idx) => (
                                <tr key={method} className={cn("hover:bg-zinc-50 transition-colors", idx % 2 === 0 ? "bg-white" : "bg-zinc-50/30")}>
                                    <td className="p-3 font-medium text-zinc-900 border-r border-gray-100 sticky left-0 bg-inherit z-10 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                                        {method}
                                    </td>
                                    {datasets.map(dataset => {
                                        const entry = dataMap[`${method}-${dataset}`];
                                        const rawVal = getCellValue(method, dataset); 
                                        
                                        const isDiff = compareMode && baselineMethod;
                                        const cellText = rawVal === null ? "-" : (typeof rawVal === 'string' ? rawVal : rawVal.toFixed(2));
                                        const stdText = !isDiff && entry?.std !== null && typeof entry?.std === 'number'
                                            ? ` ± ${(entry.std * 100).toFixed(2)}`
                                            : "";
                                        const count = !isDiff ? entry?.count : null;
                                        const bestForDataset = bestAbsoluteByDataset[dataset];
                                        const isBestAbsoluteScore = !isDiff &&
                                            methodFilterMode === "all" &&
                                            typeof rawVal === 'number' &&
                                            typeof bestForDataset === 'number' &&
                                            Math.abs(rawVal - bestForDataset) < 1e-6;

                                        // Color logic
                                        let colorClass = "";
                                        
                                        // Override for diff mode
                                        if (isDiff && rawVal !== null && typeof rawVal === 'number') {
                                            if (rawVal > 0.5) colorClass = "text-green-700 font-bold bg-green-50";
                                            else if (rawVal < -0.5) colorClass = "text-red-700 font-bold bg-red-50";
                                            else colorClass = "text-zinc-400";
                                        }

                                        return (
                                            <td key={dataset} 
                                                title={getCellTitle(entry, isDiff)}
                                                onClick={() => entry && entry.run && onInspect && onInspect(entry.run)}
                                                className={cn(
                                                    "p-2 text-center border-r border-gray-100 last:border-r-0",
                                                    entry && entry.run ? "cursor-pointer hover:underline" : "",
                                                    colorClass,
                                                    isBestAbsoluteScore ? "font-bold" : ""
                                                )}
                                            >
                                                {rawVal === null || typeof rawVal === 'string' ? (
                                                    cellText
                                                ) : (
                                                    <span className="inline-flex flex-col items-center gap-0.5 leading-tight">
                                                        <span>
                                                            {isDiff ? `${cellText} pp` : `${cellText}%${stdText}`}
                                                        </span>
                                                        {count && count > 1 && (
                                                            <span className="text-[10px] font-normal text-zinc-500">
                                                                n={count}
                                                            </span>
                                                        )}
                                                    </span>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
};

export default BenchmarkMatrix;
