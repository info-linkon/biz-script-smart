/**
 * Voice Activity Detection (VAD) Processor
 * Detects voice presence in audio using energy-based analysis
 */

interface VADResult {
  hasVoice: boolean;
  energy: number;
  isSpeechStart: boolean;
  isSpeechEnd: boolean;
}

interface VADConfig {
  energyThreshold: number;
  silenceFrames: number;
  speechFrames: number;
  frameSize: number;
  frameTimeMs: number;  // Time per frame in milliseconds
}

export class VADProcessor {
  private config: VADConfig;
  private frameHistory: number[] = [];
  private isSpeaking: boolean = false;
  private silentFrameCount: number = 0;
  private speechFrameCount: number = 0;
  private adaptiveThreshold: number;

  constructor(config: Partial<VADConfig> = {}) {
    this.config = {
      energyThreshold: config.energyThreshold || 0.02,
      silenceFrames: config.silenceFrames || 15, // ~300ms at 20ms frames
      speechFrames: config.speechFrames || 3,    // ~60ms to start
      frameSize: config.frameSize || 160,         // 20ms at 8kHz
      frameTimeMs: config.frameTimeMs || 20       // 20ms per frame
    };
    this.adaptiveThreshold = this.config.energyThreshold;
  }

  process(audioData: Buffer): VADResult {
    const energy = this.calculateEnergy(audioData);
    this.updateAdaptiveThreshold(energy);

    const hasVoice = energy > this.adaptiveThreshold;
    let isSpeechStart = false;
    let isSpeechEnd = false;

    if (hasVoice) {
      this.speechFrameCount++;
      this.silentFrameCount = 0;

      if (!this.isSpeaking && this.speechFrameCount >= this.config.speechFrames) {
        this.isSpeaking = true;
        isSpeechStart = true;
      }
    } else {
      this.silentFrameCount++;
      this.speechFrameCount = 0;

      if (this.isSpeaking && this.silentFrameCount >= this.config.silenceFrames) {
        this.isSpeaking = false;
        isSpeechEnd = true;
      }
    }

    return {
      hasVoice: this.isSpeaking || hasVoice,
      energy,
      isSpeechStart,
      isSpeechEnd
    };
  }

  private calculateEnergy(audioData: Buffer): number {
    let sum = 0;
    const samples = audioData.length;

    for (let i = 0; i < samples; i++) {
      // Convert µ-law to linear PCM approximation
      const mulaw = audioData[i];
      const linear = this.mulawDecode(mulaw);
      sum += linear * linear;
    }

    return Math.sqrt(sum / samples) / 32768; // Normalize to 0-1
  }

  private mulawDecode(mulaw: number): number {
    // µ-law decompression formula
    const MULAW_BIAS = 33;
    const sign = (mulaw & 0x80) ? -1 : 1;
    mulaw = ~mulaw & 0x7F;
    
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0F;
    
    let sample = (mantissa << 3) + MULAW_BIAS;
    sample <<= exponent;
    
    return sign * sample;
  }

  private updateAdaptiveThreshold(energy: number) {
    // Keep history for adaptive threshold
    this.frameHistory.push(energy);
    if (this.frameHistory.length > 50) {
      this.frameHistory.shift();
    }

    // Calculate noise floor from lowest 20% of energies
    if (this.frameHistory.length >= 20) {
      const sorted = [...this.frameHistory].sort((a, b) => a - b);
      const noiseFloor = sorted[Math.floor(sorted.length * 0.2)];
      
      // Threshold is noise floor + margin
      this.adaptiveThreshold = Math.max(
        this.config.energyThreshold,
        noiseFloor * 2.5
      );
    }
  }

  /**
   * Get the current silent time in milliseconds
   */
  getSilentMs(): number {
    return this.silentFrameCount * this.config.frameTimeMs;
  }

  /**
   * Get the current silent frame count
   */
  getSilentFrameCount(): number {
    return this.silentFrameCount;
  }

  /**
   * Get full debug state for logging
   */
  debugState(): {
    isSpeaking: boolean;
    silentMs: number;
    silentFrames: number;
    speechFrames: number;
    adaptiveThreshold: number;
    historyLength: number;
    lastEnergy: number;
  } {
    return {
      isSpeaking: this.isSpeaking,
      silentMs: this.getSilentMs(),
      silentFrames: this.silentFrameCount,
      speechFrames: this.speechFrameCount,
      adaptiveThreshold: this.adaptiveThreshold,
      historyLength: this.frameHistory.length,
      lastEnergy: this.frameHistory[this.frameHistory.length - 1] || 0
    };
  }

  reset() {
    this.frameHistory = [];
    this.isSpeaking = false;
    this.silentFrameCount = 0;
    this.speechFrameCount = 0;
    this.adaptiveThreshold = this.config.energyThreshold;
  }

  getState() {
    return {
      isSpeaking: this.isSpeaking,
      adaptiveThreshold: this.adaptiveThreshold,
      historyLength: this.frameHistory.length
    };
  }
}
