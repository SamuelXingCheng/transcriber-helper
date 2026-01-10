/**
 * Decodes an audio file and resamples it to 16kHz mono to save tokens and bandwidth.
 */
export const decodeAndResampleAudio = async (file: File): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  // Fix: Cast window to any to access webkitAudioContext property which doesn't exist on standard Window type
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: 16000, // Force 16kHz context
  });

  try {
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Check if we need to mix down to mono
    if (decodedBuffer.numberOfChannels === 1 && decodedBuffer.sampleRate === 16000) {
      return decodedBuffer;
    }

    // Offline context to resample/mixdown efficiently
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

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this writer)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
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
 * Slices an AudioBuffer into multiple chunks of a given duration (in seconds).
 */
export const sliceAudioBuffer = (
  buffer: AudioBuffer,
  chunkDurationSeconds: number
): Blob[] => {
  const chunks: Blob[] = [];
  const totalDuration = buffer.duration;
  const sampleRate = buffer.sampleRate;
  const samplesPerChunk = chunkDurationSeconds * sampleRate;
  
  // We use the 16kHz mono buffer directly
  const channelData = buffer.getChannelData(0); 

  for (let startSample = 0; startSample < buffer.length; startSample += samplesPerChunk) {
    const endSample = Math.min(startSample + samplesPerChunk, buffer.length);
    const frameCount = endSample - startSample;
    
    // Create a new buffer for this chunk
    // We create a temporary AudioContext just to create the buffer structure
    // but honestly we can just build the WAV directly from the Float32Array slice
    // to save memory overhead of creating AudioBuffers repeatedly.
    
    // Let's reuse the audioBufferToWav logic but adapted for raw float array to save ops
    // Actually, creating a small AudioBuffer is safer for correctness with the helper above.
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

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // Remove the Data-URL declaration (e.g., "data:audio/wav;base64,")
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};