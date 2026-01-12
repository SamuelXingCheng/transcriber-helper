// services/audioService.ts

/**
 * Decodes an audio file and resamples it to 16kHz mono to save tokens and bandwidth.
 */
export const decodeAndResampleAudio = async (file: File): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  // Fix: Cast window to any to access webkitAudioContext property
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: 16000, 
  });

  try {
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    if (decodedBuffer.numberOfChannels === 1 && decodedBuffer.sampleRate === 16000) {
      return decodedBuffer;
    }

    const offlineCtx = new OfflineAudioContext(1, decodedBuffer.duration * 16000, 16000);
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    
    return await offlineCtx.startRendering();
  } finally {
    await audioContext.close();
  }
};

/**
 * Converts an AudioBuffer to a WAV Blob.
 */
export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); 
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt "
  setUint32(16); 
  setUint16(1); 
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); 
  setUint16(numOfChan * 2); 
  setUint16(16); 

  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4); 

  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos])); 
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; 
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArr], { type: 'audio/wav' });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
};

/**
 * Slices an AudioBuffer into multiple chunks (Legacy function, keeping for compatibility if needed)
 */
export const sliceAudioBuffer = (
  buffer: AudioBuffer,
  chunkDurationSeconds: number
): Blob[] => {
  const chunks: Blob[] = [];
  const sampleRate = buffer.sampleRate;
  const samplesPerChunk = chunkDurationSeconds * sampleRate;
  const channelData = buffer.getChannelData(0); 

  for (let startSample = 0; startSample < buffer.length; startSample += samplesPerChunk) {
    const endSample = Math.min(startSample + samplesPerChunk, buffer.length);
    const frameCount = endSample - startSample;
    const chunkBuffer = new AudioBuffer({
        length: frameCount,
        numberOfChannels: 1,
        sampleRate: sampleRate
    });
    chunkBuffer.copyToChannel(channelData.slice(startSample, endSample), 0);
    chunks.push(audioBufferToWav(chunkBuffer));
  }
  return chunks;
};

/**
 * Smart Slicing: Detects silence to split audio.
 * Returns OBJECTS with blob, start, and end times.
 */
export const sliceAudioBufferSmart = (
  buffer: AudioBuffer,
  targetChunkDuration: number = 300, 
  silenceThreshold: number = 0.01    
): { blob: Blob; start: number; end: number }[] => {
  const chunks: { blob: Blob; start: number; end: number }[] = [];
  const sampleRate = buffer.sampleRate;
  const channelData = buffer.getChannelData(0);
  let currentStartSample = 0;

  while (currentStartSample < buffer.length) {
    let targetEndSample = currentStartSample + targetChunkDuration * sampleRate;
    
    if (buffer.length - targetEndSample < (targetChunkDuration * sampleRate) * 0.2) {
      targetEndSample = buffer.length;
    } else {
      const searchRange = 15 * sampleRate;
      const searchStart = Math.max(currentStartSample, targetEndSample - searchRange);
      const searchEnd = Math.min(buffer.length, targetEndSample + searchRange);
      
      let bestSilencePoint = targetEndSample;
      let minRms = Infinity;

      for (let i = searchStart; i < searchEnd; i += Math.floor(sampleRate * 0.1)) {
        const windowSize = Math.floor(sampleRate * 0.5); 
        if (i + windowSize > buffer.length) break;
        
        let sum = 0;
        for (let j = 0; j < windowSize; j++) {
          const val = channelData[i + j];
          sum += val * val;
        }
        const rms = Math.sqrt(sum / windowSize);
        
        if (rms < minRms) {
          minRms = rms;
          bestSilencePoint = i + Math.floor(windowSize / 2);
        }
        if (rms < silenceThreshold) break; 
      }
      targetEndSample = bestSilencePoint;
    }

    const frameCount = targetEndSample - currentStartSample;
    const chunkBuffer = new AudioBuffer({
      length: frameCount,
      numberOfChannels: 1,
      sampleRate: sampleRate
    });
    
    chunkBuffer.copyToChannel(channelData.slice(currentStartSample, targetEndSample), 0);
    chunks.push({
      blob: audioBufferToWav(chunkBuffer), // 這裡產生 Blob
      start: currentStartSample / sampleRate,
      end: targetEndSample / sampleRate
    });
    
    currentStartSample = targetEndSample;
  }
  return chunks;
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob); // 報錯就是發生在這裡，如果 blob 是 undefined 就會失敗
  });
};