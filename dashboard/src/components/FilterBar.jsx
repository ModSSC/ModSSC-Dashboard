import React from 'react';
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

const FilterBar = ({ 
    selectedParadigms, setSelectedParadigms, 
    selectedModalities, setSelectedModalities, availableModalities,
    selectedDataset, setSelectedDataset, availableDatasets = []
}) => {
    const getModalityLabel = (m) => (m === 'vision' ? 'image' : m);

    const toggleModality = (m) => {
        if (selectedModalities.includes(m)) {
            setSelectedModalities(selectedModalities.filter(x => x !== m));
        } else {
            setSelectedModalities([...selectedModalities, m]);
        }
    };

    const toggleParadigm = (p) => {
        if (selectedParadigms.includes(p)) {
            setSelectedParadigms(selectedParadigms.filter(x => x !== p));
        } else {
            setSelectedParadigms([...selectedParadigms, p]);
        }
    };

    return (
        <div className="flex flex-col gap-6 p-4 border rounded-xl bg-card text-card-foreground shadow-sm mb-6">
            <div className="flex flex-col md:flex-row gap-8 items-start">
                
                {/* Paradigm Selector (Multi-select) */}
                <div className="flex flex-col gap-2 w-full md:w-auto">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Paradigm</span>
                    <div className="flex bg-muted rounded-lg p-1 gap-1">
                        {['inductive', 'transductive'].map(p => (
                            <button
                                key={p}
                                onClick={() => toggleParadigm(p)}
                                className={cn(
                                    "px-4 py-1.5 text-sm font-medium rounded-md transition-all flex-1 md:flex-none",
                                    selectedParadigms.includes(p)
                                        ? "bg-background shadow-sm text-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-black/5"
                                )}
                            >
                                {p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Dataset Selector (Dropdown) */}
                <div className="flex flex-col gap-2 w-full md:w-auto">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dataset</span>
                    <select 
                        className="h-9 w-full md:w-[200px] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={selectedDataset}
                        onChange={(e) => setSelectedDataset(e.target.value)}
                    >
                        <option value="all">All Datasets</option>
                        {availableDatasets.map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                </div>

                {/* Modalities (Tags) */}
                <div className="flex flex-col gap-2 flex-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Modalities</span>
                    <div className="flex flex-wrap gap-2">
                        {availableModalities.map(m => (
                            <Badge
                                key={m}
                                variant={selectedModalities.includes(m) ? "default" : "outline"}
                                className={cn(
                                    "cursor-pointer capitalize px-3 py-1.5 transition-all", 
                                    !selectedModalities.includes(m) && "opacity-50 hover:opacity-100"
                                )}
                                onClick={() => toggleModality(m)}
                            >
                                {getModalityLabel(m)}
                            </Badge>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FilterBar;
