export enum TranscribeStatus {
  IDLE = 'IDLE',
  DECODING = 'DECODING',
  PROCESSING = 'PROCESSING',
  AWAITING_REFINEMENT = 'AWAITING_REFINEMENT', // [新增] 等待潤稿狀態
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface ChunkResult {
  id: number;
  startTime: number;
  endTime: number;
  text: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

export interface ProcessingState {
  status: TranscribeStatus;
  progress: number;
  totalChunks: number;
  completedChunks: number;
  currentOperation?: string;
  error?: string;
  // 新增：記錄上次儲存的片段索引
  lastSavedIndex?: number; 
}

export interface AudioMetadata {
  fileName: string;
  duration: number;
  size: number;
  type: string;
}

export interface FileJob {
  id: string;
  file: File;
  metadata: AudioMetadata | null;
  state: ProcessingState;
  chunks: ChunkResult[];
  
  // Content States
  finalTranscript: string;
  translatedTranscript: string;
  formattedHtml: string;
  enrichedHtml: string;
  summaryHtml: string;
  lsmHtml?: string;
  // Flags
  isTranslating: boolean;
  isFormatting: boolean;
  isEnriching: boolean;

  // [新增] 標記此檔案是否為參考綱目
  isReferenceOutline?: boolean;
}