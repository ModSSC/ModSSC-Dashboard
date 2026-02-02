import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card"
import { cn } from "../lib/utils";
import { Download, Calculator } from 'lucide-react';
import { Badge } from "./ui/badge";

const BenchmarkMatrix = ({ runs, metric = "test_accuracy", onInspect }) => {
    const [compareMode, setCompareMode] = useState(false); // Default to absolute values
    const [baselineMethod, setBaselineMethod] = useState("");
    const [sortByRank, setSortByRank] = useState(true);

    // 1. Get unique Datasets and Methods
    const datasets = React.useMemo(() => 
        Array.from(new Set(runs.map(r => r.dataset_id).filter(id => id))).sort(),
        [runs]);

    const allMethods = React.useMemo(() => 
        Array.from(new Set(runs.map(r => r.method_id).filter(id => id))),
        [runs]);

    // 2. Build Data Map & Calculate Column Stats (Max/Min) for Heatmap
    const { dataMap, colStats } = React.useMemo(() => {
        const map = {};
        const stats = {};
        
        datasets.forEach(d => {
            stats[d] = { max: 0, min: 1 };
        });

        runs.forEach(r => {
            const key = `${r.method_id}-${r.dataset_id}`;
            const val = r[metric] || 0;
            
            // Logic: Prioritize success over error, then max value
            const current = map[key];
            
            // If new entry or (current is error and new is not) or (both success and new > old)
            if (!current || (current.error && !r.error) || (!r.error && val > current.val)) {
                map[key] = { val, error: r.error, run: r };
            }
            // If both are errors, just keep one (maybe the last one)
            else if (current.error && r.error) {
                 map[key] = { val: 0, error: r.error, run: r };
            }

            // Update stats only if valid
            if (!r.error && val > 0) {
                if (val > stats[r.dataset_id].max) stats[r.dataset_id].max = val;
                if (val < stats[r.dataset_id].min) stats[r.dataset_id].min = val;
            }
        });
        return { dataMap: map, colStats: stats };
    }, [runs, datasets, metric]);

    // 3. Compute Ranks
    const methodsSorted = React.useMemo(() => {
        let sorted = [];
        if (!sortByRank) {
            sorted = [...allMethods].sort();
        } else {
            // Calculate Average Rank
            const methodRanks = {};
            allMethods.forEach(m => methodRanks[m] = []);

            datasets.forEach(d => {
                // Get all values for this dataset
                const scores = allMethods.map(m => {
                    const entry = dataMap[`${m}-${d}`];
                    return { method: m, score: entry && !entry.error ? entry.val : -1 };
                });
                // Sort desc
                scores.sort((a, b) => b.score - a.score);
                
                // Assign ranks (1-based)
                let currentRank = 1;
                scores.forEach((item, idx) => {
                    if (item.score === -1) {
                        // Method failed or didn't run -> Rank = Total Methods (Penalty)
                        methodRanks[item.method].push(allMethods.length);
                    } else {
                        methodRanks[item.method].push(currentRank);
                        currentRank++;
                    }
                });
            });

            // Compute avg
            const methodAvgRank = [];
            allMethods.forEach(m => {
                const ranks = methodRanks[m];
                const avg = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : 999;
                methodAvgRank.push({ method: m, avgRank: avg });
            });

            sorted = methodAvgRank.sort((a, b) => a.avgRank - b.avgRank).map(item => item.method);
        }

        // PIN "supervised" to top
        const pinnedMethod = "supervised";
        if (sorted.includes(pinnedMethod)) {
            sorted = sorted.filter(m => m !== pinnedMethod);
            sorted.unshift(pinnedMethod);
        }

        return sorted;
    }, [allMethods, datasets, dataMap, sortByRank]);


    // Default baseline: Prioritize "supervised"
    React.useEffect(() => {
        if (!baselineMethod && methodsSorted.length > 0) {
            if (methodsSorted.includes("supervised")) {
                setBaselineMethod("supervised");
            } else {
                setBaselineMethod(methodsSorted[0]);
            }
        }
    }, [methodsSorted, baselineMethod]);

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

    // Helper for background color (Heatmap)
    const getCellColor = (entry, dataset) => {
        if (!entry) return "";
        if (entry.error) return "bg-red-50 text-red-600 font-bold";
        if (compareMode) return ""; // No heatmap in compare mode
        
        const val = entry.val;
        const min = colStats[dataset].min;
        const max = colStats[dataset].max;
        if (max === min) return "";
        
        // Normalize 0 to 1
        const norm = (val - min) / (max - min);
        
        // Simple green opacity
        if (norm >= 0.95) return "bg-green-200 text-green-900 font-bold";
        if (norm >= 0.8) return "bg-green-100 text-green-800";
        if (norm >= 0.6) return "bg-green-50 text-green-800";
        return "text-zinc-600";
    };

    const copyLatex = () => {
        let latex = "\\begin{table}[h]\n\\centering\n\\begin{tabular}{l" + "c".repeat(datasets.length) + "}\n\\toprule\n";
        latex += "Method & " + datasets.map(d => d.replace(/_/g, '\\_')).join(" & ") + " \\\\\n\\midrule\n";

        methodsSorted.forEach(m => {
            const row = [m.replace(/_/g, '\\_')];
            datasets.forEach(d => {
                const entry = dataMap[`${m}-${d}`];
                row.push(entry && !entry.error ? (entry.val * 100).toFixed(2) : "-");
            });
            latex += row.join(" & ") + " \\\\\n";
        });

        latex += "\\bottomrule\n\\end{tabular}\n\\caption{Benchmark results.}\n\\label{tab:bench}\n\\end{table}";
        navigator.clipboard.writeText(latex);
        alert("LaTeX table code copied to clipboard!");
    };

    return (
        <Card className="overflow-hidden border-2 border-black/10 shadow-sm print:shadow-none">
            <CardHeader className="flex flex-row items-center justify-between bg-zinc-50/50 pb-4">
                <CardTitle className="text-xl font-serif tracking-tight">Benchmark Results ({metric === 'test_accuracy' ? 'Accuracy' : metric})</CardTitle>
                <div className="flex gap-2">
                    {/* Controls */}
                    <div className="flex items-center gap-4 mr-4">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={sortByRank} onChange={e => setSortByRank(e.target.checked)} className="mr-1 accent-black" />
                            <span className="flex items-center gap-1">Sort by Rank</span>
                        </label>

                        <div className="h-4 w-px bg-gray-300"></div>

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
                            {methodsSorted.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
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
                                        {d.replace(/_/g, ' ')}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {methodsSorted.map((method, idx) => (
                                <tr key={method} className={cn("hover:bg-zinc-50 transition-colors", idx % 2 === 0 ? "bg-white" : "bg-zinc-50/30")}>
                                    <td className="p-3 font-medium text-zinc-900 border-r border-gray-100 sticky left-0 bg-inherit z-10 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                                        {method}
                                        {sortByRank && <span className="ml-2 text-[10px] text-zinc-400 font-mono">#{idx+1}</span>}
                                    </td>
                                    {datasets.map(dataset => {
                                        const entry = dataMap[`${method}-${dataset}`];
                                        const rawVal = getCellValue(method, dataset); 
                                        
                                        const isDiff = compareMode && baselineMethod;
                                        let cellText = rawVal === null ? "-" : (typeof rawVal === 'string' ? rawVal : rawVal.toFixed(2));

                                        // Color logic
                                        let colorClass = getCellColor(entry, dataset);
                                        
                                        // Override for diff mode
                                        if (isDiff && rawVal !== null && typeof rawVal === 'number') {
                                            if (rawVal > 0.5) colorClass = "text-green-700 font-bold bg-green-50";
                                            else if (rawVal < -0.5) colorClass = "text-red-700 font-bold bg-red-50";
                                            else colorClass = "text-zinc-400";
                                        }

                                        return (
                                            <td key={dataset} 
                                                title={entry?.error || "Click for details"} 
                                                onClick={() => entry && entry.run && onInspect && onInspect(entry.run)}
                                                className={cn(
                                                    "p-2 text-center border-r border-gray-100 last:border-r-0",
                                                    entry && entry.run ? "cursor-pointer hover:underline" : "",
                                                    colorClass
                                                )}
                                            >
                                                {cellText}{isDiff && typeof rawVal === 'number' ? " pp" : (isDiff || typeof rawVal === 'string' ? "" : "%")}
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
