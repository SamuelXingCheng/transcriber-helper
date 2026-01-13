import React, { useState, useRef } from 'react';
import { Upload, FileAudio, Play, Download, RefreshCw, AlertCircle, CheckCircle2, Type, Languages, Sparkles, FileText, BookOpen, Layout, Trash2, Layers, Plus } from 'lucide-react';
import { decodeAndResampleAudio, sliceAudioBufferSmart } from '../services/audioService';
import { transcribeAudioChunk, refineAndMergeTranscript, translateTranscript, formatToLSMStyle, summarizeMeeting, enrichWithLinks } from '../services/geminiService';
import { ChunkResult, ProcessingState, TranscribeStatus, FileJob } from '../types';

const CHUNK_DURATION_SECONDS = 300; // 5 minutes

export const Transcriber: React.FC = () => {
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'format' | 'split'>('edit');
  const [userInstructions, setUserInstructions] = useState(''); // 儲存使用者的修正指令

  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateJob = (id: string, updates: Partial<FileJob> | ((prev: FileJob) => Partial<FileJob>)) => {
    setJobs(prevJobs => prevJobs.map(job => {
      if (job.id !== id) return job;
      const newValues = typeof updates === 'function' ? updates(job) : updates;
      return { ...job, ...newValues };
    }));
  };

  const updateJobState = (id: string, updates: Partial<ProcessingState>) => {
    setJobs(prevJobs => prevJobs.map(job => {
      if (job.id !== id) return job;
      return { ...job, state: { ...job.state, ...updates } };
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newJobs: FileJob[] = (Array.from(e.target.files) as File[]).map(file => ({
        id: Math.random().toString(36).substring(7),
        file,
        metadata: {
            fileName: file.name,
            size: file.size,
            type: file.type,
            duration: 0,
        },
        state: {
            status: TranscribeStatus.IDLE,
            progress: 0,
            totalChunks: 0,
            completedChunks: 0,
        },
        chunks: [],
        finalTranscript: '',
        translatedTranscript: '',
        formattedHtml: '',
        enrichedHtml: '',
        isTranslating: false,
        isFormatting: false,
        isEnriching: false,
      }));

      setJobs(prev => [...prev, ...newJobs]);
      if (!activeJobId && newJobs.length > 0) {
        setActiveJobId(newJobs[0].id);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeJob = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setJobs(prev => prev.filter(j => j.id !== id));
    if (activeJobId === id) {
        setActiveJobId(null);
    }
  };

  const processJob = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || job.state.status === TranscribeStatus.PROCESSING) return;

    const cacheKey = `checkpoint_${job.file.name}_${job.file.size}`;
    const savedData = localStorage.getItem(cacheKey);
    
    let startFromIndex = 0;
    let accumulatedText = "";

    if (savedData) {
        try {
            const { completedChunks, text } = JSON.parse(savedData);
            if (completedChunks > 0 && window.confirm(`偵測到上次已辨識 ${completedChunks} 個片段，是否從中斷處繼續？`)) {
                startFromIndex = completedChunks;
                accumulatedText = text;
            } else {
                localStorage.removeItem(cacheKey);
            }
        } catch (e) {
            console.error("解析暫存失敗", e);
        }
    }

    try {
        updateJobState(jobId, { status: TranscribeStatus.DECODING, currentOperation: '解碼中...' });
        const audioBuffer = await decodeAndResampleAudio(job.file);
        
        updateJob(jobId, (prev) => ({ 
            metadata: prev.metadata ? { ...prev.metadata, duration: audioBuffer.duration } : null,
            finalTranscript: accumulatedText
        }));

        updateJobState(jobId, { status: TranscribeStatus.PROCESSING, currentOperation: '分析段落中...' });
        const chunksData = sliceAudioBufferSmart(audioBuffer, CHUNK_DURATION_SECONDS);
        const total = chunksData.length;

        updateJobState(jobId, { 
            totalChunks: total, 
            completedChunks: startFromIndex, 
            progress: Math.round((startFromIndex / total) * 90), 
            currentOperation: startFromIndex > 0 ? '恢復進度中...' : '開始聽抄...' 
        });

        const results: ChunkResult[] = [];
        for (let k = 0; k < startFromIndex; k++) {
            results.push({ id: k, startTime: 0, endTime: 0, text: "[已恢復]", status: 'completed' });
        }

        for (let i = startFromIndex; i < total; i++) {
            const { blob, start, end } = chunksData[i];
            updateJobState(jobId, { 
                currentOperation: `聽抄片段 ${i + 1}/${total}...`,
                progress: Math.round((i / total) * 90)
            });

            try {
                const context = accumulatedText.slice(-200);
                const text = await transcribeAudioChunk(blob, context);
                const timeLabel = `[${formatTime(start)}] `;
                accumulatedText += (accumulatedText ? "\n\n" : "") + timeLabel + text;
                
                localStorage.setItem(cacheKey, JSON.stringify({
                    completedChunks: i + 1,
                    text: accumulatedText
                }));

                const chunk: ChunkResult = { id: i, startTime: start, endTime: end, text, status: 'completed' };
                results.push(chunk);
                
                updateJob(jobId, { 
                    chunks: [...results],
                    finalTranscript: accumulatedText 
                });
            } catch (err: any) {
                if (err.message?.includes('429')) {
                    throw new Error("API 配額已滿，進度已儲存，請晚點再試。");
                }
                const chunk: ChunkResult = { id: i, startTime: start, endTime: end, text: "[失敗]", status: 'error' };
                results.push(chunk);
                updateJob(jobId, { chunks: [...results] });
            }
            updateJobState(jobId, { completedChunks: i + 1 });
        }

        localStorage.removeItem(cacheKey);

        updateJobState(jobId, { 
            status: TranscribeStatus.AWAITING_REFINEMENT, 
            progress: 100, 
            currentOperation: '聽抄初稿完成，等待您的修正指示...' 
        });

    } catch (error: any) {
        console.error("Critical Error:", error);
        updateJobState(jobId, { 
            status: TranscribeStatus.ERROR, 
            error: error.message || "處理失敗" 
        });
    }
  };

  const handleFinalRefine = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || !job.finalTranscript) return;

    updateJobState(jobId, { 
        status: TranscribeStatus.PROCESSING, 
        currentOperation: '正在根據您的指示優化全篇文稿...' 
    });
    
    try {
        const refinedText = await refineAndMergeTranscript(job.finalTranscript, userInstructions);
        updateJob(jobId, { finalTranscript: refinedText });
        updateJobState(jobId, { 
            status: TranscribeStatus.COMPLETED, 
            currentOperation: '完成' 
        });
        setUserInstructions(''); 
    } catch (error: any) {
        updateJobState(jobId, { 
            status: TranscribeStatus.AWAITING_REFINEMENT,
            error: "潤稿失敗，請重試" 
        });
        alert(`優化失敗: ${error.message}`);
    }
  };

  const handleSkipRefine = (jobId: string) => {
      updateJobState(jobId, { 
          status: TranscribeStatus.COMPLETED, 
          currentOperation: '完成 (未潤稿)' 
      });
      setUserInstructions('');
  };
  
  const handleBatchProcess = async () => {
    setIsBatchProcessing(true);
    const queue = jobs.filter(j => j.state.status === TranscribeStatus.IDLE);
    for (const job of queue) {
        await processJob(job.id);
    }
    setIsBatchProcessing(false);
  };

  const handleMeetingSummary = async () => {
    if (!activeJobId) return;
    const job = jobs.find(j => j.id === activeJobId);
    if (!job) return;

    if (job.summaryHtml) { 
        updateJob(activeJobId, { formattedHtml: job.summaryHtml });
        setViewMode('format'); 
        return;
    }

    const sourceText = job.translatedTranscript || job.finalTranscript;
    if (!sourceText) return;

    updateJob(activeJobId, { isFormatting: true });
    try {
        const html = await summarizeMeeting(sourceText); 
        updateJob(activeJobId, { 
            summaryHtml: html,
            formattedHtml: html
        });
        setViewMode('format');
    } catch (error: any) {
        alert(`生成總結失敗: ${error.message}`);
    } finally {
        updateJob(activeJobId, { isFormatting: false });
    }
  };

  const handleTranslate = async () => {
    if (!activeJobId) return;
    const job = jobs.find(j => j.id === activeJobId);
    if (!job || !job.finalTranscript) return;
    updateJob(activeJobId, { isTranslating: true });
    try {
        const result = await translateTranscript(job.finalTranscript);
        updateJob(activeJobId, { translatedTranscript: result });
    } catch (error) { alert("翻譯錯誤"); } finally { updateJob(activeJobId, { isTranslating: false }); }
  };

  const handleFormatLSM = async () => {
    if (!activeJobId) return;
    const job = jobs.find(j => j.id === activeJobId);
    if (!job) return;

    if (job.formattedHtml) {
        setViewMode('format');
        return;
    }

    const sourceText = job.translatedTranscript || job.finalTranscript;
    if (!sourceText) return;

    updateJob(activeJobId, { isFormatting: true });
    try {
        const html = await formatToLSMStyle(sourceText);
        updateJob(activeJobId, { formattedHtml: html });
        setViewMode('format');
    } catch (error) {
        alert("排版錯誤");
    } finally {
        updateJob(activeJobId, { isFormatting: false });
    }
  };

  const handleEnrichLinks = async () => {
    if (!activeJobId) return;
    const job = jobs.find(j => j.id === activeJobId);
    if (!job) return;

    if (job.enrichedHtml) {
        setViewMode('split');
        return;
    }

    const sourceText = job.translatedTranscript || job.finalTranscript;
    if (!sourceText) return;

    updateJob(activeJobId, { isEnriching: true });
    try {
        const html = await enrichWithLinks(sourceText);
        updateJob(activeJobId, { enrichedHtml: html });
        setViewMode('split');
    } catch (error) {
        alert("連結生成錯誤");
    } finally {
        updateJob(activeJobId, { isEnriching: false });
    }
  };

  const handleExport = (format: 'txt' | 'doc' | 'pdf') => {
    if (!activeJobId) return;
    const job = jobs.find(j => j.id === activeJobId);
    if (!job) return;
    const content = viewMode === 'format' ? job.formattedHtml : (job.translatedTranscript || job.finalTranscript);
    const fileName = `${job.metadata?.fileName.split('.')[0] || 'transcript'}`;

    if (format === 'txt') {
        const textContent = viewMode === 'format' ? content.replace(/<[^>]+>/g, '') : content;
        const blob = new Blob([textContent], { type: "text/plain" });
        triggerDownload(blob, `${fileName}.txt`);
    } else if (format === 'doc') {
        const docContent = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset='utf-8'><title>Export</title>
            <style>body { font-family: 'PMingLiU', 'Times New Roman', serif; font-size: 14pt; line-height: 1.5; }</style>
            </head><body>${viewMode === 'format' || viewMode === 'split' ? (viewMode === 'split' ? job.enrichedHtml : job.formattedHtml) : (job.translatedTranscript || job.finalTranscript).replace(/\n/g, '<br/>')}</body></html>
        `;
        const blob = new Blob([docContent], { type: "application/msword" });
        triggerDownload(blob, `${fileName}.doc`);
    } else if (format === 'pdf') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(`
                <html><head><title>${fileName}</title>
                <style>body { font-family: 'PMingLiU', 'Times New Roman', serif; padding: 40px; font-size: 12pt; line-height: 1.5; }
                @media print { body { -webkit-print-color-adjust: exact; } }
                </style></head><body>${viewMode === 'format' || viewMode === 'split' ? (viewMode === 'split' ? job.enrichedHtml : job.formattedHtml) : (job.translatedTranscript || job.finalTranscript).replace(/\n/g, '<br/>')}</body></html>
            `);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
        }
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
      const element = document.createElement("a");
      element.href = URL.createObjectURL(blob);
      element.download = filename;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
  };

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const activeJob = jobs.find(j => j.id === activeJobId);

  return (
    <div className="max-w-[1920px] mx-auto px-4 lg:px-6 h-[calc(100vh-140px)] flex flex-col lg:flex-row gap-6">
      
      {/* Sidebar */}
      <div className="w-full lg:w-96 h-1/3 lg:h-full flex-shrink-0 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
           <h2 className="font-semibold text-gray-700 flex items-center gap-2">
             <Layers className="w-5 h-5 text-blue-600" /> 檔案列表 ({jobs.length})
           </h2>
           <button 
             onClick={() => fileInputRef.current?.click()}
             className="p-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
           >
             <Plus className="w-4 h-4" />
           </button>
           <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*,video/*" multiple className="hidden" />
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {jobs.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                    <Upload className="w-10 h-10 mb-2 opacity-50" />
                    <p className="text-sm">點擊上方 + 按鈕<br/>新增錄音檔</p>
                </div>
            )}
            {jobs.map(job => (
                <div 
                  key={job.id} 
                  onClick={() => setActiveJobId(job.id)}
                  className={`relative group p-3 rounded-xl border transition-all cursor-pointer ${
                      activeJobId === job.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100' : 'bg-white border-gray-100 hover:border-blue-200'
                  }`}
                >
                    <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2 overflow-hidden">
                           {job.state.status === TranscribeStatus.COMPLETED ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> :
                            job.state.status === TranscribeStatus.ERROR ? <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" /> :
                            <FileAudio className="w-4 h-4 text-gray-400 flex-shrink-0" />
                           }
                           <span className="text-sm font-medium text-gray-700 truncate">{job.metadata?.fileName}</span>
                        </div>
                        <button onClick={(e) => removeJob(e, job.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity">
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-400 mt-2">
                       <span>{job.metadata?.duration ? formatTime(job.metadata.duration) : '--:--'}</span>
                       <span className={`px-1.5 rounded ${job.state.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : job.state.status === 'PROCESSING' || job.state.status === 'DECODING' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}>
                           {job.state.status === 'IDLE' ? '等待中' : job.state.status === 'COMPLETED' ? '完成' : job.state.status === 'ERROR' ? '錯誤' : job.state.status === TranscribeStatus.AWAITING_REFINEMENT ? '等待潤稿' : `${job.state.progress}%`}
                       </span>
                    </div>
                </div>
            ))}
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50">
            <button 
                onClick={handleBatchProcess}
                disabled={isBatchProcessing || jobs.every(j => j.state.status === 'COMPLETED')}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 shadow-sm transition-all"
            >
                {isBatchProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isBatchProcessing ? '批次處理中...' : '開始批次處理'}
            </button>
        </div>
      </div>

      {/* Right Main: Editor */}
      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
         {!activeJob ? (
             <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                 <FileText className="w-24 h-24 mb-4 opacity-20" />
                 <p className="text-lg">請選擇或上傳檔案以開始</p>
             </div>
         ) : (
             <>
                 {/* Toolbar */}
                  <div className="p-3 border-b border-gray-100 bg-gray-50 flex flex-wrap justify-between items-center gap-3">
                      <div className="flex flex-1 items-center space-x-2 overflow-x-auto lg:overflow-visible no-scrollbar">
                          <div className="relative group flex items-center">
                              <button onClick={() => setViewMode('edit')} className={`px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-2 flex-shrink-0 ${viewMode === 'edit' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-gray-100'}`}>
                                  <Type className="w-4 h-4" /> 編輯模式
                              </button>
                              <div className="absolute top-full mt-2 left-0 hidden group-hover:block w-48 bg-gray-800 text-white text-[10px] rounded py-1.5 px-3 shadow-xl z-50 pointer-events-none text-left">
                                  自由修改聽抄文字內容，修改後會同步更新至其他模式
                                  <div className="absolute bottom-full left-4 border-4 border-transparent border-b-gray-800"></div>
                              </div>
                          </div>

                          <div className="relative group flex items-center">
                              <button onClick={handleMeetingSummary} disabled={activeJob.isFormatting} className={`px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-2 flex-shrink-0 ${viewMode === 'format' ? 'text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}>
                                  {activeJob.isFormatting ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4" />} 會議總結
                              </button>
                              <div className="absolute top-full mt-2 left-0 hidden group-hover:block w-48 bg-gray-800 text-white text-[10px] rounded py-1.5 px-3 shadow-xl z-50 pointer-events-none text-left leading-relaxed">
                                  提煉會議內容中的屬靈要點與服事安排，生成精簡的標準大綱
                                  <div className="absolute bottom-full left-4 border-4 border-transparent border-b-gray-800"></div>
                              </div>
                          </div>

                          <div className="relative group flex items-center">
                              <button onClick={handleEnrichLinks} disabled={activeJob.isEnriching} className={`px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-2 flex-shrink-0 ${viewMode === 'split' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-gray-100'}`}>
                                  {activeJob.isEnriching ? <RefreshCw className="w-4 h-4 animate-spin"/> : <BookOpen className="w-4 h-4" />} 經文對照
                              </button>
                              <div className="absolute top-full mt-2 left-0 hidden group-hover:block w-48 bg-gray-800 text-white text-[10px] rounded py-1.5 px-3 shadow-xl z-50 pointer-events-none text-left">
                                  生成恢復本聖經、生命讀經與職事書報的自動連結與對照
                                  <div className="absolute bottom-full left-4 border-4 border-transparent border-b-gray-800"></div>
                              </div>
                          </div>

                          <div className="w-px h-6 bg-gray-300 mx-2 self-center flex-shrink-0"></div>

                          <div className="relative group flex items-center">
                              <button onClick={handleTranslate} disabled={activeJob.isTranslating || !!activeJob.translatedTranscript} className={`px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-2 flex-shrink-0 ${activeJob.translatedTranscript ? 'text-green-600 bg-green-50' : 'text-gray-600 hover:bg-gray-100'}`}>
                                  {activeJob.isTranslating ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Languages className="w-4 h-4" />} {activeJob.translatedTranscript ? '已翻譯' : '翻譯'}
                              </button>
                              <div className="absolute top-full mt-2 left-0 hidden group-hover:block w-48 bg-gray-800 text-white text-[10px] rounded py-1.5 px-3 shadow-xl z-50 pointer-events-none text-left">
                                  使用專為恢復本與職事術語優化的 AI 模型進行中英互譯
                                  <div className="absolute bottom-full left-4 border-4 border-transparent border-b-gray-800"></div>
                              </div>
                          </div>
                      </div>

                      <div className="relative group flex-shrink-0">
                        <button className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 shadow-sm">
                            <Download className="w-4 h-4" /> 匯出
                        </button>
                        <div className="absolute right-0 top-full pt-2 w-48 hidden group-hover:block z-50">
                            <div className="bg-white rounded-md shadow-lg py-1 border border-gray-100">
                                <button onClick={() => handleExport('txt')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">文字檔 (.txt)</button>
                                <button onClick={() => handleExport('doc')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Word (.doc)</button>
                                <button onClick={() => handleExport('pdf')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">PDF (列印)</button>
                            </div>
                        </div>
                    </div>
                  </div>

                 {/* Content Area */}
                 <div className="flex-1 relative overflow-hidden flex flex-col bg-gray-50/50">
                    
                    {/* [新增] 頂部進度條：當有文字顯示且仍在處理中時，顯示詳細進度 */}
                    {activeJob && activeJob.state.status === TranscribeStatus.PROCESSING && activeJob.finalTranscript && (
                        <div className="px-6 py-2 bg-white border-b border-gray-200 flex flex-col gap-1 flex-shrink-0 z-20">
                            <div className="flex justify-between text-xs font-medium text-gray-500">
                                <span className="flex items-center gap-2">
                                    <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />
                                    {activeJob.state.currentOperation}
                                </span>
                                <span className="text-blue-600">{activeJob.state.progress}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                <div 
                                    className="bg-blue-600 h-1.5 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(37,99,235,0.3)]" 
                                    style={{ width: `${activeJob.state.progress}%` }}
                                ></div>
                            </div>
                        </div>
                    )}
                    {/* [修改] 持久化提示框：辨識中、等待潤稿、甚至「完成後」都顯示，支援多次修改 */}
                    {activeJob && (
                        activeJob.state.status === TranscribeStatus.PROCESSING || 
                        activeJob.state.status === TranscribeStatus.AWAITING_REFINEMENT || 
                        activeJob.state.status === TranscribeStatus.COMPLETED // [新增] 完成後依然顯示
                    ) && (
                        <div className={`flex-shrink-0 p-4 border-b shadow-sm animate-in slide-in-from-top-4 z-10 ${
                            activeJob.state.status === TranscribeStatus.COMPLETED ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'
                        }`}>
                            <div className="max-w-4xl mx-auto flex gap-4 items-start">
                                <div className="flex-1">
                                    <div className={`flex items-center gap-2 mb-2 font-bold text-sm ${
                                        activeJob.state.status === TranscribeStatus.COMPLETED ? 'text-green-800' : 'text-blue-800'
                                    }`}>
                                        <Sparkles className="w-4 h-4" />
                                        <span>
                                            {activeJob.state.status === TranscribeStatus.COMPLETED 
                                                ? "AI 隨時待命：您可以繼續下指令，請 AI 再次潤飾或是修正特定錯誤" 
                                                : "AI 修正提示與指引"}
                                        </span>
                                    </div>
                                    <textarea 
                                        value={userInstructions}
                                        onChange={(e) => setUserInstructions(e.target.value)}
                                        placeholder={activeJob.state.status === TranscribeStatus.COMPLETED 
                                            ? "例如：『請把語氣改得更正式一點』、『第三段的經節引用有誤請修正』..." 
                                            : "邊看邊寫：例如『把零弟兄改為林弟兄』..."}
                                        className={`w-full p-2 text-sm border rounded-lg h-20 focus:ring-2 outline-none resize-none shadow-inner bg-white/60 ${
                                            activeJob.state.status === TranscribeStatus.COMPLETED 
                                            ? 'border-green-200 focus:ring-green-400 placeholder-green-700/50' 
                                            : 'border-blue-200 focus:ring-blue-400'
                                        }`}
                                    />
                                </div>
                                
                                {/* 按鈕邏輯：在「等待潤稿」或是「已完成」時都可以按 */}
                                {(activeJob.state.status === TranscribeStatus.AWAITING_REFINEMENT || activeJob.state.status === TranscribeStatus.COMPLETED) && (
                                    <div className="flex flex-col gap-2 pt-6">
                                        <button 
                                            onClick={() => handleFinalRefine(activeJob.id)}
                                            disabled={!userInstructions && activeJob.state.status === TranscribeStatus.COMPLETED} // 完成狀態下，沒寫字不給按，避免誤觸
                                            className={`px-6 py-2 text-white rounded-lg text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
                                                !userInstructions && activeJob.state.status === TranscribeStatus.COMPLETED
                                                ? 'bg-gray-400 cursor-not-allowed'
                                                : activeJob.state.status === TranscribeStatus.COMPLETED 
                                                    ? 'bg-green-600 hover:bg-green-700' 
                                                    : 'bg-blue-600 hover:bg-blue-700'
                                            }`}
                                        >
                                            <Sparkles className="w-4 h-4" /> 
                                            {activeJob.state.status === TranscribeStatus.COMPLETED ? "再次優化 (Re-refine)" : "確認並執行潤稿"}
                                        </button>
                                        
                                        {/* 只有在等待階段才顯示跳過按鈕，完成後就不需要跳過了 */}
                                        {activeJob.state.status === TranscribeStatus.AWAITING_REFINEMENT && (
                                            <button 
                                                onClick={() => handleSkipRefine(activeJob.id)}
                                                className="text-xs text-blue-400 hover:text-blue-600 underline text-center"
                                            >
                                                跳過潤稿，直接完成
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {!activeJob.finalTranscript && activeJob.state.status !== TranscribeStatus.COMPLETED && activeJob.state.status !== TranscribeStatus.AWAITING_REFINEMENT ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
                            {activeJob.state.status === 'IDLE' ? (
                                <>
                                  <Play className="w-16 h-16 text-gray-300 mb-4" />
                                  <p className="text-gray-500 mb-4">此檔案尚未處理</p>
                                  <button onClick={() => processJob(activeJob.id)} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">立即開始</button>
                                </>
                            ) : activeJob.state.status === 'ERROR' ? (
                                <>
                                  <AlertCircle className="w-16 h-16 text-red-300 mb-4" />
                                  <p className="text-red-600 mb-2">處理失敗</p>
                                  <p className="text-gray-500 text-sm max-w-md">{activeJob.state.error}</p>
                                </>
                            ) : (
                                <div className="max-w-md w-full">
                                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                                        <span>{activeJob.state.currentOperation}</span>
                                        <span>{activeJob.state.progress}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                                        <div className="bg-blue-600 h-3 rounded-full transition-all duration-500" style={{ width: `${activeJob.state.progress}%` }}></div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            {viewMode === 'edit' && (
                              <textarea 
                                  className="flex-1 w-full p-8 focus:outline-none resize-none font-serif text-lg leading-relaxed text-gray-800 bg-white"
                                  style={{ fontFamily: '"PMingLiU", "Times New Roman", serif' }}
                                  value={activeJob.translatedTranscript || activeJob.finalTranscript}
                                  // [修正重點 2] 解除鎖定：只在解碼或處理中唯讀，等待潤稿時(AWAITING_REFINEMENT)開放編輯
                                  readOnly={
                                      activeJob.state.status === TranscribeStatus.PROCESSING || 
                                      activeJob.state.status === TranscribeStatus.DECODING
                                  }
                                  placeholder={activeJob.state.status === TranscribeStatus.PROCESSING ? "正在努力聽抄中，請稍候..." : ""}
                                  onChange={(e) => {
                                      // 允許在 完成(COMPLETED) 或 等待潤稿(AWAITING_REFINEMENT) 狀態下修改
                                      if (activeJob.state.status === TranscribeStatus.COMPLETED || activeJob.state.status === TranscribeStatus.AWAITING_REFINEMENT) {
                                          const newValue = e.target.value;
                                          
                                          if (activeJob.translatedTranscript) {
                                              updateJob(activeJob.id, { 
                                                  translatedTranscript: newValue,
                                                  formattedHtml: '', // 清除舊排版暫存
                                                  enrichedHtml: ''   // 清除舊連結暫存
                                              }); 
                                          } else {
                                              updateJob(activeJob.id, { 
                                                  finalTranscript: newValue,
                                                  formattedHtml: '', // 清除舊排版暫存
                                                  enrichedHtml: ''   // 清除舊連結暫存
                                              });
                                          }
                                      }
                                  }}
                              />
                          )}
                            {viewMode === 'format' && (
                                <div className="flex-1 overflow-y-auto p-8 bg-white">
                                    <div className="max-w-4xl mx-auto prose prose-lg" dangerouslySetInnerHTML={{ __html: activeJob.formattedHtml || '<p class="text-gray-400 italic">尚未排版，請點擊上方 "LSM 排版"</p>' }} />
                                </div>
                            )}
                            {viewMode === 'split' && (
                                <div className="flex flex-col lg:flex-row flex-1 w-full h-full">
                                    <div className="w-full lg:w-1/2 h-1/2 lg:h-full border-b lg:border-b-0 lg:border-r border-gray-200 overflow-y-auto p-6 bg-gray-50">
                                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">原始文稿</h4>
                                        <div className="font-serif text-base leading-relaxed whitespace-pre-wrap text-gray-600">{activeJob.translatedTranscript || activeJob.finalTranscript}</div>
                                    </div>
                                    <div className="w-full lg:w-1/2 h-1/2 lg:h-full overflow-y-auto p-6 bg-white">
                                        <h4 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-4">資料來源連結</h4>
                                        <div className="font-serif text-lg leading-relaxed text-gray-800" dangerouslySetInnerHTML={{ __html: activeJob.enrichedHtml || '<p class="text-gray-400 italic">尚未生成連結，請點擊上方 "經文對照"</p>' }} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                 </div>

                 {/* Footer Status */}
                 <div className="p-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 flex justify-between">
                    <span>{activeJob.metadata?.fileName}</span>
                    <span>字數: {(activeJob.translatedTranscript || activeJob.finalTranscript || '').length}</span>
                 </div>
             </>
         )}
      </div>
    </div>
  );
};