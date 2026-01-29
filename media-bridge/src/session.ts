import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { SpeechClient } from '@google-cloud/speech';
import { TextToSpeechClient, protos } from '@google-cloud/text-to-speech';
import { VADProcessor } from './vad';
import { AudioBuffer } from './audio-buffer';
import { verifyToken, isValidDevToken } from './auth';
import { isCircuitOpen, recordSuccess, recordFailure, getFallbackResponse } from './circuit-breaker';

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
    customParameters?: {
      sessionToken?: string;
      userId?: string;
      agentId?: string;
      language?: string;
      greeting?: string;
    };
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
  
  // Session State Tracking
  private sessionState: 'idle' | 'awaiting_user' | 'agent_speaking' | 'processing' = 'idle';
  private lastActivityType: 'none' | 'media_in' | 'stt_result' | 'tts_sent' | 'dialogflow' = 'none';
  
  // Security
  private validated: boolean = false;
  private apiSecret: string;
  private devToken: string;
  private userId: string = '';
  private agentId: string = '';
  
  // Activity tracking
  private lastActivityTime: number = Date.now();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private mediaPacketsBeforeValidation: number = 0;
  
  // STT deduplication
  private lastFinalTranscript: string = '';
  private lastFinalTimestamp: number = 0;
  
  // Metrics
  private metrics = {
    ttfsMs: 0,
    endToAudioMs: 0,
    bargeInCount: 0,
    sttFailures: 0,
    totalTurns: 0
  };

  constructor(sessionId: string, ws: WebSocket, apiSecret: string, devToken: string = '') {
    super();
    this.sessionId = sessionId;
    this.ws = ws;
    this.apiSecret = apiSecret;
    this.devToken = devToken;
    this.speechClient = new SpeechClient();
    this.ttsClient = new TextToSpeechClient();
    this.vad = new VADProcessor();
    this.audioBuffer = new AudioBuffer();

    this.setupMessageHandler();
    this.startHeartbeat();
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

  private startHeartbeat() {
    // Smart heartbeat with dynamic timeouts based on session state
    this.heartbeatTimer = setInterval(() => {
      const idleTime = Date.now() - this.lastActivityTime;
      
      // Dynamic timeout based on state
      const timeout = this.sessionState === 'awaiting_user' ? 120000 : 
                      this.sessionState === 'agent_speaking' ? 180000 : 90000;
      
      if (idleTime > 60000) { // 1 minute idle
        console.log(`[${this.sessionId}] Session idle for ${Math.round(idleTime / 1000)}s, state: ${this.sessionState}`);
      }
      
      // Close sessions that exceed their state-based timeout
      if (idleTime > timeout) {
        console.log(`[${this.sessionId}] Session timed out: state=${this.sessionState}, idle=${Math.round(idleTime/1000)}s, timeout=${timeout/1000}s`);
        this.ws.close(4000, 'connection_stale');
        this.cleanup();
        this.emit('end');
      }
    }, 30000); // Check every 30 seconds
    
    this.heartbeatTimer.unref();
  }

  private updateActivity(type: 'media_in' | 'stt_result' | 'tts_sent' | 'dialogflow' = 'media_in') {
    this.lastActivityTime = Date.now();
    this.lastActivityType = type;
  }

  private async handleMessage(message: TwilioMediaMessage) {
    this.updateActivity();
    
    switch (message.event) {
      case 'start':
        await this.handleStartEvent(message);
        break;

      case 'config':
        // Custom event from Edge Function with session config
        this.config = message as unknown as SessionConfig;
        console.log(`[${this.sessionId}] Config received:`, this.config);
        if (this.validated) {
          await this.startSession();
        }
        break;

      case 'media':
        // SECURITY: Drop media packets before validation
        if (!this.validated) {
          this.mediaPacketsBeforeValidation++;
          if (this.mediaPacketsBeforeValidation % 100 === 0) {
            console.log(`[${this.sessionId}] Dropped ${this.mediaPacketsBeforeValidation} media packets (not validated)`);
          }
          return;
        }
        
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

  private async handleStartEvent(message: TwilioMediaMessage) {
    if (!message.start) return;
    
    this.streamSid = message.start.streamSid;
    this.callSid = message.start.callSid;
    console.log(`[${this.sessionId}] Stream started: ${this.streamSid}, Call: ${this.callSid}`);
    
    // Extract customParameters for validation
    const params = message.start.customParameters || {};
    const sessionToken = params.sessionToken;
    
    // Validate token
    if (this.devToken && isValidDevToken(sessionToken || '', this.devToken)) {
      // Dev token bypass for development
      console.log(`[${this.sessionId}] Validated via dev token`);
      this.validated = true;
      this.userId = params.userId || 'dev-user';
      this.agentId = params.agentId || 'dev-agent';
      this.emit('validated');
    } else if (sessionToken && this.apiSecret) {
      // Production token validation
      const result = verifyToken(sessionToken, this.apiSecret);
      
      if (result.valid && result.payload) {
        console.log(`[${this.sessionId}] Token validated for user: ${result.payload.userId}`);
        this.validated = true;
        this.userId = result.payload.userId;
        this.agentId = result.payload.agentId;
        this.emit('validated');
      } else {
        console.log(`[${this.sessionId}] Token validation failed: ${result.error}`);
        this.emit('validation_failed', result.error || 'Invalid token');
        return;
      }
    } else if (!this.apiSecret) {
      // No secret configured - allow connection (development mode)
      console.log(`[${this.sessionId}] No API secret configured, allowing connection`);
      this.validated = true;
      this.userId = params.userId || 'unknown';
      this.agentId = params.agentId || 'unknown';
      this.emit('validated');
    } else {
      // No token provided
      console.log(`[${this.sessionId}] No session token provided`);
      this.emit('validation_failed', 'No session token');
      return;
    }
    
    // Set initial config from customParameters
    if (params.language || params.greeting) {
      this.config = {
        language: params.language || 'he-IL',
        greeting: decodeURIComponent(params.greeting || ''),
        voiceId: '',
        dialogflowAgentId: this.agentId,
        dialogflowProjectId: '',
        scriptContext: ''
      };
      
      if (this.validated) {
        await this.startSession();
      }
    }
  }

  private async startSession() {
    if (!this.config) return;

    // Check circuit breaker for STT
    if (isCircuitOpen('google-stt')) {
      console.log(`[${this.sessionId}] STT circuit is open, using fallback`);
      const fallback = getFallbackResponse('google-stt', this.config.language);
      await this.speakText(fallback.text);
      return;
    }

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
      recordSuccess('google-stt');
      this.handleRecognitionResult(response);
    });

    this.recognizeStream.on('error', (error) => {
      console.error(`[${this.sessionId}] STT error:`, error);
      this.metrics.sttFailures++;
      recordFailure('google-stt');
      
      // Restart stream on error if circuit is not open
      if (!isCircuitOpen('google-stt')) {
        setTimeout(() => this.startRecognitionStream(), 100);
      }
    });

    this.recognizeStream.on('end', () => {
      console.log(`[${this.sessionId}] STT stream ended, restarting...`);
      if (this.sessionActive && !isCircuitOpen('google-stt')) {
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
      // Pause words for VAD
      'רגע', 'המתן', 'שניה',
      // Arabic phrases  
      'مرحبا', 'شكرا', 'مع السلامة', 'نعم', 'لا', 'من فضلك',
      'موعد', 'حجز', 'متاح', 'إلغاء', 'تغيير',
      'غدا', 'اليوم', 'الأسبوع القادم',
      'صباح', 'ظهر', 'مساء',
      // Arabic pause words
      'لحظة', 'انتظر',
      // Code-switching terms
      'תור/موعد', 'פגישה/اجتماع', 'סניף/فرع'
    ];

    return commonPhrases;
  }

  private async handleAudio(base64Audio: string) {
    this.updateActivity('media_in');
    const audioBytes = Buffer.from(base64Audio, 'base64');
    
    // Process VAD
    const vadResult = this.vad.process(audioBytes);
    
    // Handle barge-in
    if (this.isAgentSpeaking && vadResult.hasVoice) {
      console.log(`[${this.sessionId}] Barge-in detected!`);
      this.metrics.bargeInCount++;
      this.isAgentSpeaking = false;
      this.sessionState = 'idle';
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

    // STT Deduplication: Skip if same transcript within 2 seconds
    const now = Date.now();
    if (transcript === this.lastFinalTranscript && now - this.lastFinalTimestamp < 2000) {
      console.log(`[${this.sessionId}] Duplicate transcript skipped: "${transcript}"`);
      return;
    }
    this.lastFinalTranscript = transcript;
    this.lastFinalTimestamp = now;

    // Validate final transcript
    if (confidence < 0.3 && !this.hasValidWord(transcript)) {
      console.log(`[${this.sessionId}] Rejected low-confidence transcript: "${transcript}"`);
      return;
    }

    console.log(`[${this.sessionId}] Final: "${transcript}" (${(confidence * 100).toFixed(1)}%)`);
    this.updateActivity('stt_result');
    this.sessionState = 'processing';
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

    // Check circuit breaker
    if (isCircuitOpen('dialogflow')) {
      const fallback = getFallbackResponse('dialogflow', this.config.language);
      await this.speakText(fallback.text);
      return;
    }

    const startTime = Date.now();

    try {
      // Call Dialogflow CX
      const response = await this.callDialogflowCX(transcript);
      
      recordSuccess('dialogflow');
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
      recordFailure('dialogflow');
      
      // Fallback response
      const fallback = getFallbackResponse('dialogflow', this.config.language);
      await this.speakText(fallback.text);
    }
  }

  private async callDialogflowCX(text: string): Promise<{ text: string; endConversation: boolean }> {
    // This would call the actual Dialogflow CX API
    // For now, we'll send a message to the Edge Function to handle this
    this.ws.send(JSON.stringify({
      event: 'dialogflow_request',
      sessionId: this.sessionId,
      text,
      callSid: this.callSid,
      userId: this.userId,
      agentId: this.agentId
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

    // Check circuit breaker for TTS
    if (isCircuitOpen('google-tts')) {
      console.log(`[${this.sessionId}] TTS circuit is open, skipping speech`);
      return;
    }

    const startTime = Date.now();
    this.sessionState = 'agent_speaking';
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
          recordSuccess('google-tts');
          await this.sendAudioToTwilio(audioContent);
        }
      }

      this.metrics.endToAudioMs = Date.now() - startTime;
      this.updateActivity('tts_sent');
    } catch (error) {
      console.error(`[${this.sessionId}] TTS error:`, error);
      recordFailure('google-tts');
    } finally {
      this.isAgentSpeaking = false;
      // Check if this was a question - set state accordingly
      this.sessionState = this.isQuestionText(text) ? 'awaiting_user' : 'idle';
    }
  }

  /**
   * Detect if text is a question (for timeout logic)
   */
  private isQuestionText(text: string): boolean {
    const questionPatterns = [
      /\?$/,                              // Ends with ?
      /؟$/,                               // Arabic question mark
      /^(מה|איך|למה|מתי|איפה|האם|האם)/,  // Hebrew question words
      /^(ما|كيف|لماذا|متى|أين|هل)/,       // Arabic question words
    ];
    return questionPatterns.some(p => p.test(text.trim()));
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
      userId: this.userId,
      agentId: this.agentId,
      metrics: this.metrics
    }));

    this.emit('end');
  }

  /**
   * Record WebSocket close event with full context for debugging
   */
  recordWSClose(code: number, reason: string) {
    const lastActivityAgoMs = Date.now() - this.lastActivityTime;
    
    console.log(`[${this.sessionId}] WS Close Context:`, JSON.stringify({
      code,
      reason,
      validated: this.validated,
      sessionState: this.sessionState,
      isAgentSpeaking: this.isAgentSpeaking,
      lastActivityType: this.lastActivityType,
      lastActivityAgoMs,
      turnsCount: this.turnsCount,
      durationMs: this.getDuration(),
      mediaDroppedBeforeValidation: this.mediaPacketsBeforeValidation,
      metrics: this.metrics
    }));
  }

  cleanup() {
    this.sessionActive = false;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    if (this.recognizeStream) {
      this.recognizeStream.destroy();
      this.recognizeStream = null;
    }

    this.vad.reset();
    this.audioBuffer.clear();
  }

  // Public getters
  getCallSid(): string {
    return this.callSid;
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }

  getTurnsCount(): number {
    return this.turnsCount;
  }

  isValidated(): boolean {
    return this.validated;
  }

  getUserId(): string {
    return this.userId;
  }

  getAgentId(): string {
    return this.agentId;
  }
}
