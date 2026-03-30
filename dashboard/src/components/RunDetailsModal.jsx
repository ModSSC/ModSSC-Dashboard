import React, { useEffect, useState } from 'react';
import { X, FileJson, FileText, ScrollText } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { formatDatasetLabel, getRunLabeledFraction } from '../lib/dataset';

SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('yaml', yaml);

const RunDetailsModal = ({ run, isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('config');
    const [content, setContent] = useState({ config: '', run: '', log: '' });
    const [loading, setLoading] = useState({ config: false, run: false, log: false });
    const datasetLabel = formatDatasetLabel(run?.dataset_id, getRunLabeledFraction(run));

    useEffect(() => {
        if (isOpen && run && run.raw_data_urls) {
            // Reset content when opening a new run
            setContent({ config: '', run: '', log: '' });
            
            const fetchFile = async (type) => {
                if (!run.raw_data_urls[type]) return;
                
                setLoading(prev => ({ ...prev, [type]: true }));
                try {
                    // Handle base path for GitHub Pages
                    const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
                    const url = `${baseUrl}/${run.raw_data_urls[type]}`;
                    
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
            fetchFile('run');
            fetchFile('log');
        }
    }, [isOpen, run]);

    if (!isOpen || !run) return null;

    const tabs = [
        { id: 'config', label: 'Config (YAML)', icon: FileText, lang: 'yaml' },
        { id: 'run', label: 'Run (JSON)', icon: FileJson, lang: 'json' },
        { id: 'log', label: 'Log (Output)', icon: ScrollText, lang: 'text' },
    ];

    const currentLang = tabs.find(t => t.id === activeTab)?.lang;

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
                <div className="flex-1 overflow-auto bg-[#282c34] text-zinc-100 relative">
                    {loading[activeTab] ? (
                        <div className="flex items-center justify-center h-full text-zinc-400">
                            Loading...
                        </div>
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
