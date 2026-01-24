/**
 * Audio Buffer for managing incoming audio chunks
 * Provides circular buffer functionality with configurable size
 */

interface AudioChunk {
  data: Buffer;
  timestamp: number;
}

export class AudioBuffer {
  private buffer: AudioChunk[] = [];
  private maxDuration: number; // Max buffer duration in ms
  private sampleRate: number;
  private bytesPerMs: number;

  constructor(maxDurationMs: number = 5000, sampleRate: number = 8000) {
    this.maxDuration = maxDurationMs;
    this.sampleRate = sampleRate;
    this.bytesPerMs = sampleRate / 1000; // 8 bytes per ms at 8kHz µ-law
  }

  add(data: Buffer) {
    const chunk: AudioChunk = {
      data,
      timestamp: Date.now()
    };

    this.buffer.push(chunk);
    this.cleanup();
  }

  private cleanup() {
    const now = Date.now();
    const cutoff = now - this.maxDuration;

    // Remove old chunks
    while (this.buffer.length > 0 && this.buffer[0].timestamp < cutoff) {
      this.buffer.shift();
    }
  }

  getLastMs(durationMs: number): Buffer {
    const now = Date.now();
    const cutoff = now - durationMs;

    // Collect chunks within the time window
    const chunks: Buffer[] = [];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].timestamp >= cutoff) {
        chunks.unshift(this.buffer[i].data);
      } else {
        break;
      }
    }

    return Buffer.concat(chunks);
  }

  getAll(): Buffer {
    return Buffer.concat(this.buffer.map(c => c.data));
  }

  clear() {
    this.buffer = [];
  }

  getDuration(): number {
    if (this.buffer.length === 0) return 0;
    return Date.now() - this.buffer[0].timestamp;
  }

  getSize(): number {
    return this.buffer.reduce((sum, chunk) => sum + chunk.data.length, 0);
  }

  getChunkCount(): number {
    return this.buffer.length;
  }
}
