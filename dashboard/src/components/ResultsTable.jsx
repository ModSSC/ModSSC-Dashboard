import React from 'react';
import { Eye } from 'lucide-react';
import { formatDatasetLabel, getRunLabeledFraction } from '../lib/dataset';

const ResultsTable = ({ runs, onSelect, selectedIds, onInspect }) => {
    if (!runs || runs.length === 0) return <div>No data available</div>;

    // Dynamically determine columns
    // Fixed: Method, Dataset, Test Acc, Test F1, Duration
    // Dynamic: Params?

    const toggleSelect = (id) => {
        if (selectedIds.includes(id)) {
            onSelect(selectedIds.filter(x => x !== id));
        } else {
            onSelect([...selectedIds, id]);
        }
    };

    return (
        <div className="rounded-md border overflow-x-auto">
            <table className="w-full caption-bottom text-sm text-left">
                <thead className="[&_tr]:border-b">
                    <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                        <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Select</th>
                        <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Run ID</th>
                        <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Method</th>
                        <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Dataset</th>
                        <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Accuracy</th>
                        <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Macro F1</th>
                        <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Duration (s)</th>
                        <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Details</th>
                    </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                    {runs.map((run) => {
                        const isError = !!run.error;
                        const datasetLabel = formatDatasetLabel(run.dataset_id, getRunLabeledFraction(run));
                        const rowClass = isError 
                            ? "bg-red-50 hover:bg-red-100 border-b transition-colors" 
                            : "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted";

                        return (
                            <tr key={run.run_id} className={rowClass}>
                                <td className="p-4 align-middle">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.includes(run.run_id)}
                                        onChange={() => toggleSelect(run.run_id)}
                                        className="h-4 w-4 rounded border-gray-300"
                                    />
                                </td>
                                <td className="p-4 align-middle font-medium text-xs font-mono">
                                    <button 
                                        onClick={() => onInspect && onInspect(run)}
                                        className="hover:underline hover:text-blue-600 focus:outline-none text-left"
                                    >
                                        {run.run_id.substring(0, 8)}...
                                    </button>
                                </td>
                                <td className="p-4 align-middle">{run.method_id}</td>
                                <td className="p-4 align-middle">{datasetLabel}</td>
                                <td className="p-4 align-middle">
                                    {isError ? (
                                        <span className="text-red-600 font-bold text-xs">FAILED</span>
                                    ) : (
                                        run.test_accuracy ? (run.test_accuracy * 100).toFixed(2) + "%" : "N/A"
                                    )}
                                </td>
                                <td className="p-4 align-middle max-w-[200px] truncate" title={isError ? run.error : ""}>
                                    {isError ? (
                                        <span className="text-red-500 text-xs italic">{run.error}</span>
                                    ) : (
                                        run.test_macro_f1 ? (run.test_macro_f1 * 100).toFixed(2) + "%" : "-"
                                    )}
                                </td>
                                <td className="p-4 align-middle">{run.duration_s ? Math.round(run.duration_s) : "-"}</td>
                                <td className="p-4 align-middle">
                                    <button 
                                        onClick={() => onInspect && onInspect(run)}
                                        className="p-1 hover:bg-gray-200 rounded transition-colors"
                                        title="View Details"
                                    >
                                        <Eye className="w-4 h-4 text-gray-500" />
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export default ResultsTable;
