import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { SpeechClient } from '@google-cloud/speech';
import { TextToSpeechClient, protos } from '@google-cloud/text-to-speech';
import { VADProcessor } from './vad';
import { AudioBuffer } from './audio-buffer';

type ISynthesizeSpeechRequest = protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest;

interface SessionConfig {
  language: string;
  voiceId: string;
  dialogflowAgentId: string;
  dialogflowProjectId: string;
  greeting: string;
  scriptContext: string;
}

interface TwilioMediaMessage {
  event: string;
  streamSid?: string;
  media?: {
    payload: string;
    timestamp: string;
  };
  start?: {
    streamSid: string;
    callSid: string;
  };
}

export class MediaBridgeSession extends EventEmitter {
  private sessionId: string;
  private ws: WebSocket;
  private speechClient: SpeechClient;
  private ttsClient: TextToSpeechClient;
  private recognizeStream: ReturnType<SpeechClient['streamingRecognize']> | null = null;
  private vad: VADProcessor;
  private audioBuffer: AudioBuffer;
  
  private streamSid: string = '';
  private callSid: string = '';
  private config: SessionConfig | null = null;
  private startTime: number = Date.now();
  private turnsCount: number = 0;
  private isAgentSpeaking: boolean = false;
  private pendingAudioChunks: string[] = [];
  private lastTranscript: string = '';
  private sessionActive: boolean = true;
  
  // Metrics
  private metrics = {
    ttfsMs: 0,
    endToAudioMs: 0,
    bargeInCount: 0,
    sttFailures: 0,
    totalTurns: 0
  };

  constructor(sessionId: string, ws: WebSocket) {
    super();
    this.sessionId = sessionId;
    this.ws = ws;
    this.speechClient = new SpeechClient();
    this.ttsClient = new TextToSpeechClient();
    this.vad = new VADProcessor();
    this.audioBuffer = new AudioBuffer();

    this.setupMessageHandler();
  }

  private setupMessageHandler() {
    this.ws.on('message', async (data: Buffer) => {
      try {
        const message: TwilioMediaMessage = JSON.parse(data.toString());
        await this.handleMessage(message);
      } catch (error) {
        console.error(`[${this.sessionId}] Error handling message:`, error);
      }
    });
  }

  private async handleMessage(message: TwilioMediaMessage) {
    switch (message.event) {
      case 'start':
        if (message.start) {
          this.streamSid = message.start.streamSid;
          this.callSid = message.start.callSid;
          console.log(`[${this.sessionId}] Stream started: ${this.streamSid}, Call: ${this.callSid}`);
        }
        break;

      case 'config':
        // Custom event from Edge Function with session config
        this.config = message as unknown as SessionConfig;
        console.log(`[${this.sessionId}] Config received:`, this.config);
        await this.startSession();
        break;

      case 'media':
        if (message.media?.payload) {
          await this.handleAudio(message.media.payload);
        }
        break;

      case 'stop':
        console.log(`[${this.sessionId}] Stream stopped`);
        await this.endSession();
        break;
    }
  }

  private async startSession() {
    if (!this.config) return;

    // Start persistent STT stream
    this.startRecognitionStream();

    // Send greeting after 300ms delay for stability
    setTimeout(async () => {
      if (this.config?.greeting) {
        await this.speakText(this.config.greeting);
      }
    }, 300);
  }

  private startRecognitionStream() {
    if (this.recognizeStream) {
      this.recognizeStream.destroy();
    }

    const language = this.config?.language || 'he-IL';
    
    // Build phrase hints for better accuracy
    const phraseHints = this.buildPhraseHints();

    this.recognizeStream = this.speechClient.streamingRecognize({
      config: {
        encoding: 'MULAW' as const,
        sampleRateHertz: 8000,
        languageCode: language,
        alternativeLanguageCodes: ['ar-IL', 'en-US'],
        enableAutomaticPunctuation: true,
        model: 'phone_call',
        useEnhanced: true,
        speechContexts: [{
          phrases: phraseHints,
          boost: 15
        }],
        enableWordTimeOffsets: true,
        metadata: {
          interactionType: 'PHONE_CALL' as const,
          industryNaicsCodeOfAudio: 812111
        }
      },
      interimResults: true,
      singleUtterance: false
    });

    this.recognizeStream.on('data', (response) => {
      this.handleRecognitionResult(response);
    });

    this.recognizeStream.on('error', (error) => {
      console.error(`[${this.sessionId}] STT error:`, error);
      this.metrics.sttFailures++;
      // Restart stream on error
      setTimeout(() => this.startRecognitionStream(), 100);
    });

    this.recognizeStream.on('end', () => {
      console.log(`[${this.sessionId}] STT stream ended, restarting...`);
      if (this.sessionActive) {
        this.startRecognitionStream();
      }
    });

    console.log(`[${this.sessionId}] STT stream started with language: ${language}`);
  }

  private buildPhraseHints(): string[] {
    const commonPhrases = [
      // Hebrew phrases
      'שלום', 'תודה', 'להתראות', 'כן', 'לא', 'בבקשה',
      'תור', 'פגישה', 'זמין', 'לקבוע', 'לבטל', 'לשנות',
      'מחר', 'היום', 'בשבוע הבא', 'בחודש הבא',
      'בוקר', 'צהריים', 'ערב', 'לילה',
      'רופא', 'מספרה', 'טיפול', 'שירות',
      // Arabic phrases  
      'مرحبا', 'شكرا', 'مع السلامة', 'نعم', 'لا', 'من فضلك',
      'موعد', 'حجز', 'متاح', 'إلغاء', 'تغيير',
      'غدا', 'اليوم', 'الأسبوع القادم',
      'صباح', 'ظهر', 'مساء',
      // Code-switching terms
      'תור/موعد', 'פגישה/اجتماع', 'סניף/فرع'
    ];

    return commonPhrases;
  }

  private async handleAudio(base64Audio: string) {
    const audioBytes = Buffer.from(base64Audio, 'base64');
    
    // Process VAD
    const vadResult = this.vad.process(audioBytes);
    
    // Handle barge-in
    if (this.isAgentSpeaking && vadResult.hasVoice) {
      console.log(`[${this.sessionId}] Barge-in detected!`);
      this.metrics.bargeInCount++;
      this.isAgentSpeaking = false;
      this.pendingAudioChunks = [];
      this.clearTwilioAudio();
    }

    // Buffer audio
    this.audioBuffer.add(audioBytes);

    // Send to STT stream
    if (this.recognizeStream && !this.recognizeStream.destroyed) {
      this.recognizeStream.write(audioBytes);
    }
  }

  private handleRecognitionResult(response: any) {
    const result = response.results?.[0];
    if (!result) return;

    const transcript = result.alternatives?.[0]?.transcript || '';
    const confidence = result.alternatives?.[0]?.confidence || 0;
    const isFinal = result.isFinal;

    // Skip low confidence or empty transcripts
    if (!transcript.trim()) return;

    // Log interim results for debugging
    if (!isFinal) {
      console.log(`[${this.sessionId}] Interim: "${transcript}" (${(confidence * 100).toFixed(1)}%)`);
      return;
    }

    // Validate final transcript
    if (confidence < 0.3 && !this.hasValidWord(transcript)) {
      console.log(`[${this.sessionId}] Rejected low-confidence transcript: "${transcript}"`);
      return;
    }

    console.log(`[${this.sessionId}] Final: "${transcript}" (${(confidence * 100).toFixed(1)}%)`);
    this.lastTranscript = transcript;
    this.turnsCount++;
    this.metrics.totalTurns++;

    // Process with Dialogflow
    this.processWithDialogflow(transcript);
  }

  private hasValidWord(text: string): boolean {
    // Check for at least one valid Hebrew word (2+ letters)
    return /[א-ת]{2,}/.test(text) || /[\u0600-\u06FF]{2,}/.test(text);
  }

  private async processWithDialogflow(transcript: string) {
    if (!this.config) return;

    const startTime = Date.now();

    try {
      // Call Dialogflow CX
      const response = await this.callDialogflowCX(transcript);
      
      this.metrics.ttfsMs = Date.now() - startTime;
      console.log(`[${this.sessionId}] Dialogflow response in ${this.metrics.ttfsMs}ms`);

      if (response.text) {
        await this.speakText(response.text);
      }

      if (response.endConversation) {
        await this.endSession();
      }
    } catch (error) {
      console.error(`[${this.sessionId}] Dialogflow error:`, error);
      // Fallback response
      await this.speakText('סליחה, לא הצלחתי להבין. אנא נסה שוב.');
    }
  }

  private async callDialogflowCX(text: string): Promise<{ text: string; endConversation: boolean }> {
    // This would call the actual Dialogflow CX API
    // For now, we'll send a message to the Edge Function to handle this
    this.ws.send(JSON.stringify({
      event: 'dialogflow_request',
      sessionId: this.sessionId,
      text,
      callSid: this.callSid
    }));

    // Wait for response from Edge Function
    return new Promise((resolve) => {
      const handler = (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.event === 'dialogflow_response') {
            this.ws.off('message', handler);
            resolve({
              text: message.text || '',
              endConversation: message.endConversation || false
            });
          }
        } catch (e) {
          // Ignore non-JSON messages
        }
      };
      this.ws.on('message', handler);

      // Timeout after 10 seconds
      setTimeout(() => {
        this.ws.off('message', handler);
        resolve({ text: 'מצטער, יש בעיה טכנית. אנא נסה שוב.', endConversation: false });
      }, 10000);
    });
  }

  private async speakText(text: string) {
    if (!text.trim()) return;

    const startTime = Date.now();
    this.isAgentSpeaking = true;

    try {
      // Split by sentences for streaming
      const sentences = text.match(/[^.!?。؟]+[.!?。؟]?/g) || [text];

      for (const sentence of sentences) {
        if (!this.isAgentSpeaking) break; // Barge-in occurred

        const trimmed = sentence.trim();
        if (!trimmed) continue;

        const audioContent = await this.synthesizeSpeech(trimmed);
        if (audioContent && this.isAgentSpeaking) {
          await this.sendAudioToTwilio(audioContent);
        }
      }

      this.metrics.endToAudioMs = Date.now() - startTime;
    } catch (error) {
      console.error(`[${this.sessionId}] TTS error:`, error);
    } finally {
      this.isAgentSpeaking = false;
    }
  }

  private async synthesizeSpeech(text: string): Promise<Buffer | null> {
    const language = this.detectSentenceLanguage(text);
    const voiceConfig = this.getVoiceConfig(language);

    const request: ISynthesizeSpeechRequest = {
      input: { text },
      voice: voiceConfig,
      audioConfig: {
        audioEncoding: 'MULAW' as const,
        sampleRateHertz: 8000,
        speakingRate: 1.0,
        pitch: 0
      }
    };

    try {
      const [response] = await this.ttsClient.synthesizeSpeech(request);
      return response.audioContent as Buffer;
    } catch (error) {
      console.error(`[${this.sessionId}] TTS synthesis error:`, error);
      return null;
    }
  }

  private detectSentenceLanguage(text: string): 'he' | 'ar' | 'en' {
    const arabicRatio = (text.match(/[\u0600-\u06FF]/g) || []).length / text.length;
    const hebrewRatio = (text.match(/[\u0590-\u05FF]/g) || []).length / text.length;
    
    if (arabicRatio > 0.3) return 'ar';
    if (hebrewRatio > 0.3) return 'he';
    return 'en';
  }

  private getVoiceConfig(language: 'he' | 'ar' | 'en') {
    const voiceMap = {
      he: { languageCode: 'he-IL', name: 'he-IL-Chirp3-HD-Achiad' },
      ar: { languageCode: 'ar-XA', name: 'ar-XA-Chirp3-HD-Fares' },
      en: { languageCode: 'en-US', name: 'en-US-Journey-F' }
    };

    return voiceMap[language] || voiceMap.he;
  }

  private async sendAudioToTwilio(audioContent: Buffer) {
    // Convert to base64 and send in chunks
    const base64Audio = audioContent.toString('base64');
    const chunkSize = 8000; // ~1 second of audio
    
    for (let i = 0; i < base64Audio.length; i += chunkSize) {
      if (!this.isAgentSpeaking) break;

      const chunk = base64Audio.slice(i, i + chunkSize);
      this.pendingAudioChunks.push(chunk);

      this.ws.send(JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: chunk
        }
      }));

      // Small delay between chunks for smoother playback
      await new Promise(r => setTimeout(r, 20));
    }
  }

  private clearTwilioAudio() {
    this.ws.send(JSON.stringify({
      event: 'clear',
      streamSid: this.streamSid
    }));
    this.pendingAudioChunks = [];
  }

  private async endSession() {
    this.sessionActive = false;

    // Send metrics to Edge Function
    this.ws.send(JSON.stringify({
      event: 'session_end',
      sessionId: this.sessionId,
      callSid: this.callSid,
      metrics: this.metrics
    }));

    this.emit('end');
  }

  cleanup() {
    this.sessionActive = false;
    
    if (this.recognizeStream) {
      this.recognizeStream.destroy();
      this.recognizeStream = null;
    }

    this.vad.reset();
    this.audioBuffer.clear();
  }

  getCallSid(): string {
    return this.callSid;
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }

  getTurnsCount(): number {
    return this.turnsCount;
  }
}
