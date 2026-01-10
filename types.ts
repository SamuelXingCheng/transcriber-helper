export enum TranscribeStatus {
  IDLE = 'IDLE',
  DECODING = 'DECODING',
  PROCESSING = 'PROCESSING', // Splitting and Transcribing
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
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
  progress: number; // 0-100
  totalChunks: number;
  completedChunks: number;
  currentOperation?: string;
  error?: string;
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
  
  // Flags
  isTranslating: boolean;
  isFormatting: boolean;
  isEnriching: boolean;
}