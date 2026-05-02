import React, { useEffect, useState } from 'react';
import { X, FileJson, FileText, ScrollText, BarChart3, ListOrdered } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { formatDatasetLabel, getRunLabeledFraction } from '../lib/dataset';

SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('yaml', yaml);

const toFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const metricStatKey = (metric, stat) => `${metric.replace(/\./g, '_')}_${stat}`;

const getMetricStat = (run, metric, stat) => {
    if (!run) return null;
    return toFiniteNumber(run[metricStatKey(metric, stat)]);
};

const formatPercent = (value) => {
    const n = toFiniteNumber(value);
    return n === null ? '-' : `${(n * 100).toFixed(2)}%`;
};

const formatMetricWithStd = (run, metric) => {
    const mean = toFiniteNumber(run?.[metric]);
    if (mean === null) return '-';
    const std = getMetricStat(run, metric, 'std');
    return std === null
        ? formatPercent(mean)
        : `${formatPercent(mean)} ± ${(std * 100).toFixed(2)} pp`;
};

const metricRows = [
    { label: 'Test accuracy', metric: 'test_accuracy' },
    { label: 'Test macro F1', metric: 'test_macro_f1' },
    { label: 'Val accuracy', metric: 'val.accuracy' },
    { label: 'Val macro F1', metric: 'val.macro_f1' },
];

const SeedSweepSummary = ({ run }) => (
    <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="border rounded-md p-3">
                <div className="text-xs uppercase text-zinc-500 font-semibold">Seeds</div>
                <div className="mt-1 font-mono text-lg">{run.seed_count ?? run.seeds?.length ?? '-'}</div>
            </div>
            <div className="border rounded-md p-3">
                <div className="text-xs uppercase text-zinc-500 font-semibold">Status</div>
                <div className="mt-1 font-mono text-lg">{run.status ?? '-'}</div>
            </div>
            <div className="border rounded-md p-3 sm:col-span-2">
                <div className="text-xs uppercase text-zinc-500 font-semibold">Seed IDs</div>
                <div className="mt-1 font-mono text-sm break-words">
                    {Array.isArray(run.seeds) && run.seeds.length > 0 ? run.seeds.join(', ') : '-'}
                </div>
            </div>
        </div>

        <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b">
                    <tr>
                        <th className="text-left p-3 font-semibold">Metric</th>
                        <th className="text-right p-3 font-semibold">Mean ± std</th>
                        <th className="text-right p-3 font-semibold">Min</th>
                        <th className="text-right p-3 font-semibold">Max</th>
                        <th className="text-right p-3 font-semibold">n</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {metricRows.map(({ label, metric }) => (
                        <tr key={metric}>
                            <td className="p-3 font-medium">{label}</td>
                            <td className="p-3 text-right font-mono">{formatMetricWithStd(run, metric)}</td>
                            <td className="p-3 text-right font-mono">{formatPercent(getMetricStat(run, metric, 'min'))}</td>
                            <td className="p-3 text-right font-mono">{formatPercent(getMetricStat(run, metric, 'max'))}</td>
                            <td className="p-3 text-right font-mono">{getMetricStat(run, metric, 'count') ?? run.seed_count ?? '-'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const SeedRunsTable = ({ run }) => {
    const seedRuns = Array.isArray(run.seed_runs) ? run.seed_runs : [];
    if (seedRuns.length === 0) {
        return <div className="p-6 text-sm text-zinc-500">No seed data available.</div>;
    }

    return (
        <div className="p-6">
            <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50 border-b">
                        <tr>
                            <th className="text-left p-3 font-semibold">Seed</th>
                            <th className="text-left p-3 font-semibold">Run ID</th>
                            <th className="text-right p-3 font-semibold">Test acc</th>
                            <th className="text-right p-3 font-semibold">Test F1</th>
                            <th className="text-right p-3 font-semibold">Val acc</th>
                            <th className="text-right p-3 font-semibold">Val F1</th>
                            <th className="text-right p-3 font-semibold">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {seedRuns.map((seedRun) => (
                            <tr key={seedRun.run_id || seedRun.seed}>
                                <td className="p-3 font-mono">{seedRun.seed ?? '-'}</td>
                                <td className="p-3 font-mono text-xs">{seedRun.run_id ?? '-'}</td>
                                <td className="p-3 text-right font-mono">{formatPercent(seedRun.test_accuracy)}</td>
                                <td className="p-3 text-right font-mono">{formatPercent(seedRun.test_macro_f1)}</td>
                                <td className="p-3 text-right font-mono">{formatPercent(seedRun['val.accuracy'])}</td>
                                <td className="p-3 text-right font-mono">{formatPercent(seedRun['val.macro_f1'])}</td>
                                <td className="p-3 text-right font-mono">{seedRun.status ?? '-'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const RunDetailsModal = ({ run, isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('config');
    const [content, setContent] = useState({ config: '', run: '', log: '', aggregate: '' });
    const [loading, setLoading] = useState({ config: false, run: false, log: false, aggregate: false });
    const datasetLabel = formatDatasetLabel(run?.dataset_id, getRunLabeledFraction(run));
    const isSeedSweep = run?.run_kind === 'seed_sweep';

    useEffect(() => {
        if (isOpen && run && run.raw_data_urls) {
            setActiveTab(run.run_kind === 'seed_sweep' ? 'summary' : 'config');
            // Reset content when opening a new run
            setContent({ config: '', run: '', log: '', aggregate: '' });
            
            const fetchFile = async (type) => {
                const filePath = run.raw_data_urls[type] || (type === 'aggregate' ? run.raw_data_urls.run : null);
                if (!filePath) return;
                
                setLoading(prev => ({ ...prev, [type]: true }));
                try {
                    // Handle base path for GitHub Pages
                    const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
                    const url = `${baseUrl}/${filePath}`;
                    
                    const res = await fetch(url);
                    if (res.ok) {
                        const text = await res.text();
                        setContent(prev => ({ ...prev, [type]: text }));
                    } else {
                        setContent(prev => ({ ...prev, [type]: `Error loading ${type}: ${res.statusText}` }));
                    }
                } catch (err) {
                    setContent(prev => ({ ...prev, [type]: `Error loading ${type}: ${err.message}` }));
                } finally {
                    setLoading(prev => ({ ...prev, [type]: false }));
                }
            };

            fetchFile('config');
            fetchFile(isSeedSweep ? 'aggregate' : 'run');
            fetchFile('log');
        }
    }, [isOpen, run, isSeedSweep]);

    if (!isOpen || !run) return null;

    const tabs = isSeedSweep
        ? [
            { id: 'summary', label: 'Summary', icon: BarChart3 },
            { id: 'seeds', label: 'Seeds', icon: ListOrdered },
            { id: 'aggregate', label: 'Aggregate (JSON)', icon: FileJson, lang: 'json' },
            { id: 'config', label: 'Config (YAML)', icon: FileText, lang: 'yaml' },
            { id: 'log', label: 'Run Log', icon: ScrollText, lang: 'text' },
        ]
        : [
            { id: 'config', label: 'Config (YAML)', icon: FileText, lang: 'yaml' },
            { id: 'run', label: 'Run (JSON)', icon: FileJson, lang: 'json' },
            { id: 'log', label: 'Log (Output)', icon: ScrollText, lang: 'text' },
        ];

    const currentLang = tabs.find(t => t.id === activeTab)?.lang;
    const isStructuredTab = activeTab === 'summary' || activeTab === 'seeds';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-zinc-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-zinc-50">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            Run Details: <span className="font-mono text-zinc-600">{run.run_id}</span>
                        </h2>
                        <div className="flex gap-2 mt-1">
                            <Badge variant="outline">{run.method_id}</Badge>
                            <Badge variant="outline">{datasetLabel}</Badge>
                            {isSeedSweep && <Badge variant="outline">{run.seed_count ?? run.seeds?.length ?? 0} seeds</Badge>}
                            {run.error && <Badge variant="destructive">Error</Badge>}
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-zinc-200 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-zinc-500" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b bg-white">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors",
                                    isActive 
                                        ? "border-black text-black bg-zinc-50" 
                                        : "border-transparent text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                                )}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Content */}
                <div className={cn(
                    "flex-1 overflow-auto relative",
                    isStructuredTab ? "bg-white text-zinc-900" : "bg-[#282c34] text-zinc-100"
                )}>
                    {loading[activeTab] ? (
                        <div className="flex items-center justify-center h-full text-zinc-400">
                            Loading...
                        </div>
                    ) : activeTab === 'summary' ? (
                        <SeedSweepSummary run={run} />
                    ) : activeTab === 'seeds' ? (
                        <SeedRunsTable run={run} />
                    ) : (
                        currentLang === 'text' ? (
                            <pre className="p-4 font-mono text-xs whitespace-pre-wrap break-all text-zinc-300">
                                {content[activeTab] || "No content available."}
                            </pre>
                        ) : (
                            <SyntaxHighlighter
                                language={currentLang}
                                style={atomOneDark}
                                customStyle={{ margin: 0, padding: '1rem', height: '100%', fontSize: '12px' }}
                                showLineNumbers={true}
                                wrapLongLines={true}
                            >
                                {content[activeTab] || ""}
                            </SyntaxHighlighter>
                        )
                    )}
                </div>
            </div>
        </div>
    );
};

export default RunDetailsModal;
