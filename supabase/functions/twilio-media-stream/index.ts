import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TwilioMediaMessage {
  event: string;
  sequenceNumber?: string;
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // Base64 encoded audio
  };
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters: Record<string, string>;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
  mark?: {
    name: string;
  };
}

interface BusinessInfo {
  name: string;
  services: string;
  faq: string;
  customPrompt: string;
  phoneNumber: string;
}

// ===== CONSTANTS: Week 1 Optimizations =====
// Dynamic VAD: Pause words that require longer silence threshold
const PAUSE_WORDS_REGEX = /רגע|שנייה|אממ|תן לי|بس|لحظة|يعني|wait|hold on/i;

// FAQ patterns for router bypass
const FAQ_PATTERNS = {
  hours: /שעות|פתוח|סגור|עד מתי|מתי פותחים|מתי סוגרים|متى|ساعات|working hours|open|close/i,
  address: /כתובת|איפה|איך מגיעים|מיקום|וين|عنوان|where|location|address/i,
  whatsapp: /וואטסאפ|whatsapp|واتساب/i,
  prices: /מחיר|עולה|כמה זה|تكلفة|كم|سعر|price|cost|how much/i,
  cancel: /לבטל|ביטול|إلغاء|cancel/i,
};

// LLM Settings (Week 1 optimizations)
const LLM_CONFIG = {
  DEFAULT_TEMPERATURE: 0.35,
  DEFAULT_MAX_TOKENS: 140,
  COMPLEX_FLOW_MAX_TOKENS: 220,  // For appointment booking flows
  MAX_RESPONSE_CHARS: 180,       // Post-process truncation
};

// ===== STREAMING STT MANAGER =====
// Real-time speech recognition using Google Cloud Speech-to-Text streaming API
interface StreamingSTTResult {
  transcript: string;
  isFinal: boolean;
  language: string;
  confidence: number;
  stability: number;
}

interface StreamingSTTManager {
  isActive: boolean;
  sessionStartTime: number;
  interimTranscript: string;
  finalTranscript: string;
  audioChunksBuffer: Uint8Array[];
  lastResultTime: number;
  recognitionComplete: boolean;
  detectedLanguage: string;
  confidence: number;
  onFinalResult: ((result: StreamingSTTResult) => Promise<void>) | null;
  onInterimResult: ((result: StreamingSTTResult) => void) | null;
  // For session management
  totalAudioDuration: number;
  chunkCount: number;
  // Dynamic VAD
  lastInterimCheck: number;
}

function createStreamingSTTManager(): StreamingSTTManager {
  return {
    isActive: false,
    sessionStartTime: 0,
    interimTranscript: '',
    finalTranscript: '',
    audioChunksBuffer: [],
    lastResultTime: 0,
    recognitionComplete: false,
    detectedLanguage: 'he-IL',
    confidence: 0,
    onFinalResult: null,
    onInterimResult: null,
    totalAudioDuration: 0,
    chunkCount: 0,
    lastInterimCheck: 0,
  };
}

// Start streaming STT session
async function startStreamingSTT(
  manager: StreamingSTTManager,
  accessToken: string,
  primaryLanguage: string,
  phraseHints: string[]
): Promise<void> {
  manager.isActive = true;
  manager.sessionStartTime = Date.now();
  manager.interimTranscript = '';
  manager.finalTranscript = '';
  manager.audioChunksBuffer = [];
  manager.recognitionComplete = false;
  manager.chunkCount = 0;
  manager.totalAudioDuration = 0;
  
  console.log('🎙️ Started streaming STT session for language:', primaryLanguage);
}

// Feed audio chunk to streaming manager
function feedAudioToStreaming(manager: StreamingSTTManager, audioBytes: Uint8Array): void {
  if (!manager.isActive) return;
  
  manager.audioChunksBuffer.push(audioBytes);
  manager.chunkCount++;
  manager.totalAudioDuration += (audioBytes.length / 8); // 8000 samples/sec = 1 byte = 0.125ms
  
  // Log every 50 chunks (~1 second of audio)
  if (manager.chunkCount % 50 === 0) {
    console.log(`📊 Streaming buffer: ${manager.chunkCount} chunks, ~${(manager.totalAudioDuration / 1000).toFixed(1)}s`);
  }
}

// Stop streaming and get final transcript using optimized batch transcription
async function stopStreamingAndTranscribe(
  manager: StreamingSTTManager,
  accessToken: string,
  projectId: string,
  primaryLanguage: string,
  phraseHints: string[]
): Promise<StreamingSTTResult | null> {
  if (!manager.isActive || manager.audioChunksBuffer.length === 0) {
    console.log('⚠️ Streaming: No audio to transcribe');
    manager.isActive = false;
    return null;
  }
  
  const processingStart = Date.now();
  console.log(`🔄 Streaming END: Processing ${manager.chunkCount} chunks (~${(manager.totalAudioDuration / 1000).toFixed(1)}s audio)`);
  
  // Combine all audio chunks
  let totalBytes = 0;
  for (const chunk of manager.audioChunksBuffer) {
    totalBytes += chunk.length;
  }
  
  const combinedAudio = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of manager.audioChunksBuffer) {
    combinedAudio.set(chunk, offset);
    offset += chunk.length;
  }
  
  // Clear buffer
  manager.audioChunksBuffer = [];
  manager.isActive = false;
  
  // Convert to base64
  const audioBase64 = btoa(String.fromCharCode(...combinedAudio));
  
  console.log('📤 Streaming->Batch: Sending', totalBytes, 'bytes to Google STT');
  
  // Use optimized batch transcription (Google STT v1 with short audio optimization)
  const result = await transcribeAudioOptimized(
    audioBase64,
    accessToken,
    projectId,
    primaryLanguage,
    phraseHints
  );
  
  const processingTime = Date.now() - processingStart;
  console.log(`⚡ Streaming transcription completed in ${processingTime}ms`);
  
  if (result.transcript) {
    return {
      transcript: result.transcript,
      isFinal: true,
      language: result.detectedLanguage,
      confidence: result.confidence,
      stability: 1.0,
    };
  }
  
  return null;
}

// ===== OPTIMIZED BATCH STT (for streaming end) =====
// Uses shorter timeout and optimized settings for faster response
async function transcribeAudioOptimized(
  mulawAudioBase64: string,
  accessToken: string,
  projectId: string,
  primaryLanguage: string = 'he-IL',
  phraseHints: string[] = []
): Promise<{ transcript: string | null; detectedLanguage: string; confidence: number }> {
  console.log('🎤 Optimized STT - audio length:', mulawAudioBase64.length);
  
  const sttUrl = 'https://speech.googleapis.com/v1/speech:recognize';
  
  // Build speech contexts for better business term recognition
  // Week 1: Reduced boost from 15 to 11 for more balanced recognition
  const speechContexts = phraseHints.length > 0 ? [{
    phrases: phraseHints.slice(0, 500),
    boost: 11
  }] : [];
  
  // Alternative languages for auto-detection
  const alternativeLanguages = ['he-IL', 'ar-XA', 'en-US'].filter(l => l !== primaryLanguage);
  
  const config: any = {
    encoding: 'MULAW',
    sampleRateHertz: 8000,
    languageCode: primaryLanguage,
    alternativeLanguageCodes: alternativeLanguages,
    enableAutomaticPunctuation: true,
    profanityFilter: false,
    // Optimizations for faster processing
    enableWordTimeOffsets: false,
    enableWordConfidence: false,
    maxAlternatives: 1,
  };
  
  // Use enhanced telephony model for English
  if (primaryLanguage === 'en-US') {
    config.model = 'phone_call';
    config.useEnhanced = true;
  }
  
  const requestBody: any = {
    config,
    audio: {
      content: mulawAudioBase64,
    },
  };
  
  if (speechContexts.length > 0) {
    requestBody.config.speechContexts = speechContexts;
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
    
    const response = await fetch(sttUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);

    const data = await response.json();
    
    if (data.error) {
      console.error('❌ STT API Error:', data.error.message);
      return { transcript: null, detectedLanguage: primaryLanguage, confidence: 0 };
    }

    if (data.results && data.results[0]?.alternatives?.[0]?.transcript) {
      const transcript = data.results[0].alternatives[0].transcript;
      const confidence = data.results[0].alternatives[0].confidence || 0.8;
      let detectedLanguage = data.results[0].languageCode || primaryLanguage;
      
      // Hebrew word indicators - override Arabic detection when Hebrew greeting detected
      const hebrewIndicators = ['שלום', 'היי', 'בוקר', 'ערב', 'אלו', 'מה', 'איך', 'כן', 'לא', 'תודה', 'בבקשה', 'סליחה', 'רגע'];
      const containsHebrew = hebrewIndicators.some(word => transcript.includes(word));
      
      if (containsHebrew && detectedLanguage.startsWith('ar')) {
        console.log('🔄 Detected Hebrew in Arabic transcript, switching to he-IL');
        detectedLanguage = 'he-IL';
      }
      
      // Confidence filter
      if (detectedLanguage !== 'he-IL' && confidence < 0.5) {
        detectedLanguage = 'he-IL';
      }
      
      console.log('✅ Transcript:', transcript, '| Lang:', detectedLanguage, '| Conf:', (confidence*100).toFixed(0) + '%');
      return { transcript, detectedLanguage, confidence };
    }
    
    return { transcript: null, detectedLanguage: primaryLanguage, confidence: 0 };
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('❌ STT timeout (8s)');
    } else {
      console.error('❌ STT error:', error);
    }
    return { transcript: null, detectedLanguage: primaryLanguage, confidence: 0 };
  }
}

interface ConversationState {
  userId: string;
  agentId: string;
  sessionId: string;
  callSid: string;
  streamSid: string;
  audioBuffer: Uint8Array[];
  isProcessing: boolean;
  lastAudioTime: number;
  credentials: any;
  projectId: string;
  greeting: string;
  language: string;
  // Barge-in support
  isAgentSpeaking: boolean;
  interruptedText: string | null;
  // Conversation context for memory
  conversationHistory: { role: 'user' | 'agent'; text: string; timestamp: number }[];
  customerName: string | null;
  customerPhone: string | null;
  customerTopic: string | null;
  customerRequests: string[];
  turnCount: number;
  // Echo suppression
  lastTTSEndTime: number;
  echoGracePeriodMs: number;
  // VAD state
  isUserSpeaking: boolean;
  lastVoiceTime: number;
  speechStartTime: number | null;
  noiseFloor: number;
  noiseFloorSamples: number;
  totalBufferBytes: number;
  // Multi-language detection
  detectedLanguage: string;
  voiceGender: 'FEMALE' | 'MALE';
  sttConfidence: number;
  // Gender detection for natural conversation
  detectedGender: 'male' | 'female' | null;
  // Grace period for listening after greeting
  greetingSentAt: number;
  // Business info for AI prompting
  businessInfo: BusinessInfo;
  // Phrase hints for STT
  phraseHints: string[];
  // STT failure tracking for fallback prompt
  consecutiveSTTFailures: number;
  // Streaming STT manager
  streamingSTT: StreamingSTTManager;
}

// MULAW decode table for proper energy calculation
const MULAW_DECODE_TABLE = [
  -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
  -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
  -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
  -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
  -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
  -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
  -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
  -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
  -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
  -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
  -876, -844, -812, -780, -748, -716, -684, -652,
  -620, -588, -556, -524, -492, -460, -428, -396,
  -372, -356, -340, -324, -308, -292, -276, -260,
  -244, -228, -212, -196, -180, -164, -148, -132,
  -120, -112, -104, -96, -88, -80, -72, -64,
  -56, -48, -40, -32, -24, -16, -8, 0,
  32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
  23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
  15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
  11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
  7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
  5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
  3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
  2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
  1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
  1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
  876, 844, 812, 780, 748, 716, 684, 652,
  620, 588, 556, 524, 492, 460, 428, 396,
  372, 356, 340, 324, 308, 292, 276, 260,
  244, 228, 212, 196, 180, 164, 148, 132,
  120, 112, 104, 96, 88, 80, 72, 64,
  56, 48, 40, 32, 24, 16, 8, 0
];

// Voice Activity Detection - STRICTER thresholds to reduce false positives
function detectVoiceActivity(audioPayload: string, noiseFloor: number): { hasVoice: boolean; energy: number } {
  try {
    const audioBytes = Uint8Array.from(atob(audioPayload), c => c.charCodeAt(0));
    
    let sumSquares = 0;
    for (let i = 0; i < audioBytes.length; i++) {
      const linear16Sample = MULAW_DECODE_TABLE[audioBytes[i]];
      sumSquares += linear16Sample * linear16Sample;
    }
    const rms = Math.sqrt(sumSquares / audioBytes.length);
    
    // STRICTER: Higher thresholds to reduce false positives from background noise
    const VOICE_THRESHOLD_MULTIPLIER = 6;
    const MIN_VOICE_ENERGY = 2500;
    
    const threshold = Math.max(noiseFloor * VOICE_THRESHOLD_MULTIPLIER, MIN_VOICE_ENERGY);
    const hasVoice = rms > threshold;
    
    return { hasVoice, energy: rms };
  } catch {
    return { hasVoice: false, energy: 0 };
  }
}

// Send clear event to stop audio playback on Twilio
function clearTwilioAudio(socket: WebSocket, streamSid: string): void {
  console.log('🔇 Barge-in: Clearing Twilio audio queue');
  socket.send(JSON.stringify({
    event: 'clear',
    streamSid: streamSid,
  }));
}

// Generate Google Cloud access token from service account
async function getAccessToken(credentials: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const privateKeyPem = credentials.private_key;
  const pemContents = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(unsignedToken)
  );
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${unsignedToken}.${signatureB64}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// ===== BACKUP: Batch STT (fallback if streaming fails) =====
async function transcribeAudio(
  mulawAudioBase64: string, 
  accessToken: string, 
  projectId: string,
  primaryLanguage: string = 'he-IL',
  phraseHints: string[] = []
): Promise<{ transcript: string | null; detectedLanguage: string; confidence: number }> {
  console.log('🎤 Batch STT fallback, audio length:', mulawAudioBase64.length);
  
  const sttUrl = 'https://speech.googleapis.com/v1/speech:recognize';
  
  // Week 1: Reduced boost from 15 to 11
  const speechContexts = phraseHints.length > 0 ? [{
    phrases: phraseHints.slice(0, 500),
    boost: 11
  }] : [];
  
  const alternativeLanguages = ['he-IL', 'ar-XA', 'en-US'].filter(l => l !== primaryLanguage);
  
  const config: any = {
    encoding: 'MULAW',
    sampleRateHertz: 8000,
    languageCode: primaryLanguage,
    alternativeLanguageCodes: alternativeLanguages,
    enableAutomaticPunctuation: true,
    profanityFilter: false,
  };
  
  if (primaryLanguage === 'en-US') {
    config.model = 'phone_call';
    config.useEnhanced = true;
  }
  
  const requestBody: any = {
    config,
    audio: {
      content: mulawAudioBase64,
    },
  };
  
  if (speechContexts.length > 0) {
    requestBody.config.speechContexts = speechContexts;
  }
  
  try {
    const response = await fetch(sttUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (data.error) {
      console.error('❌ STT API Error:', data.error.message);
      return { transcript: null, detectedLanguage: primaryLanguage, confidence: 0 };
    }

    if (data.results && data.results[0]?.alternatives?.[0]?.transcript) {
      const transcript = data.results[0].alternatives[0].transcript;
      const confidence = data.results[0].alternatives[0].confidence || 0.8;
      let detectedLanguage = data.results[0].languageCode || primaryLanguage;
      
      const hebrewIndicators = ['שלום', 'היי', 'בוקר', 'ערב', 'אלו', 'מה', 'איך', 'כן', 'לא', 'תודה', 'בבקשה', 'סליחה', 'רגע'];
      const containsHebrew = hebrewIndicators.some(word => transcript.includes(word));
      
      if (containsHebrew && detectedLanguage.startsWith('ar')) {
        detectedLanguage = 'he-IL';
      }
      
      if (detectedLanguage !== 'he-IL' && confidence < 0.5) {
        detectedLanguage = 'he-IL';
      }
      
      console.log('✅ Transcript:', transcript, '| Lang:', detectedLanguage, '| Conf:', (confidence*100).toFixed(0) + '%');
      return { transcript, detectedLanguage, confidence };
    }
    
    return { transcript: null, detectedLanguage: primaryLanguage, confidence: 0 };
    
  } catch (error) {
    console.error('❌ STT fetch error:', error);
    return { transcript: null, detectedLanguage: primaryLanguage, confidence: 0 };
  }
}


// ===== UPGRADED: Lovable AI Response (replaces Dialogflow LLM) =====
async function getAIResponse(
  transcript: string,
  state: ConversationState
): Promise<{ response: string; extractedName?: string; extractedPhone?: string; extractedTopic?: string }> {
  console.log('🧠 Getting Lovable AI response for:', transcript);
  
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) {
    console.error('❌ LOVABLE_API_KEY not set');
    return { response: 'סליחה, יש בעיה טכנית. אפשר לנסות שוב?' };
  }
  
  // Build dynamic system prompt from business info
  const systemPrompt = buildSystemPrompt(state);
  
  // Format conversation history for AI
  const messages = [
    { role: 'system', content: systemPrompt },
    ...state.conversationHistory.slice(-8).map(h => ({
      role: h.role === 'user' ? 'user' as const : 'assistant' as const,
      content: h.text
    })),
    { role: 'user' as const, content: transcript }
  ];
  
  // Week 1 A1: Detect if this is a complex appointment flow
  const isAppointmentFlow = /תור|פגישה|לקבוע|לשנות|לבטל|موعد|حجز|appointment|schedule|book/i.test(transcript);
  const maxTokens = isAppointmentFlow ? LLM_CONFIG.COMPLEX_FLOW_MAX_TOKENS : LLM_CONFIG.DEFAULT_MAX_TOKENS;
  
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages,
        max_tokens: maxTokens,
        temperature: LLM_CONFIG.DEFAULT_TEMPERATURE,
      })
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        console.error('❌ Rate limited');
        return { response: 'רגע, יש עומס. אפשר לחזור עוד רגע?' };
      }
      if (response.status === 402) {
        console.error('❌ Payment required');
        return { response: 'יש בעיה טכנית, נציג יחזור אליך בקרוב.' };
      }
      throw new Error(`AI API error: ${response.status}`);
    }
    
    const data = await response.json();
    let aiResponse = data.choices?.[0]?.message?.content || 'סליחה, לא הבנתי. אפשר לחזור?';
    
    // Extract customer info from transcript
    const extractedInfo = extractCustomerInfo(transcript);
    
    // Clean up response - remove any unwanted AI phrases
    aiResponse = cleanAIResponse(aiResponse);
    
    // Week 1 A1: Post-process truncation - enforce max 180 chars
    if (aiResponse.length > LLM_CONFIG.MAX_RESPONSE_CHARS) {
      const sentences = aiResponse.split(/[.!?،؟]+/).filter((s: string) => s.trim().length > 0);
      const firstSentence = sentences[0]?.trim() || aiResponse.substring(0, 80);
      const followUpQuestion = state.detectedLanguage?.startsWith('ar') 
        ? 'شو بعد؟' 
        : state.detectedLanguage?.startsWith('en') 
        ? 'Anything else?' 
        : 'עוד משהו?';
      aiResponse = firstSentence + '. ' + followUpQuestion;
      console.log('✂️ Response truncated to:', aiResponse.length, 'chars');
    }
    
    // Add natural filler words for Israeli spontaneous speech
    aiResponse = addFillerWords(aiResponse, state.turnCount, state.detectedLanguage);
    
    console.log('🤖 AI Response:', aiResponse);
    
    return { 
      response: aiResponse, 
      ...extractedInfo 
    };
  } catch (err) {
    console.error('❌ Lovable AI error:', err);
    return { response: 'סליחה, יש בעיה טכנית. אפשר לנסות שוב?' };
  }
}

// Build system prompt from business info - MULTILINGUAL SPONTANEOUS STYLE
function buildSystemPrompt(state: ConversationState): string {
  const { businessInfo, customerName, voiceGender, detectedLanguage } = state;
  
  const isAgentFemale = voiceGender === 'FEMALE';
  
  const customerLanguage = detectedLanguage?.startsWith('ar') 
    ? 'arabic' 
    : detectedLanguage?.startsWith('en') 
    ? 'english' 
    : 'hebrew';
  
  console.log('🌍 Building prompt for language:', customerLanguage, '(detected:', detectedLanguage, ')');
  
  // === ARABIC PROMPT ===
  if (customerLanguage === 'arabic') {
    const agentRole = isAgentFemale ? 'انتي ممثلة' : 'انت ممثل';
    const agentStyle = isAgentFemale ? 'احكي كأنك صديقة على التلفون' : 'احكي كأنك صديق على التلفون';
    
    return `${agentRole} ${businessInfo.name}. ${agentStyle}

## اسلوب الكلام:
- جمل قصيرة. ماكسيموم 10-15 كلمة بالرد
- عربي فلسطيني/اسرائيلي طبيعي - مش فصحى
- كلمات ربط طبيعية: "طيب", "ماشي", "اوكي", "تمام", "يعني"
- ردود قصيرة: "اكيد", "اه", "تمام", "منيح", "خلص"

## امثلة:
❌ لا: "اهلا وسهلا بك، كيف يمكنني مساعدتك اليوم؟"
✅ نعم: "اهلين! شو بدك؟"

❌ لا: "سوف اتحقق من المواعيد المتاحة لك"
✅ نعم: "لحظة بشوف. امتى بتناسبك؟"

## قواعد:
1. لا تقول انك AI/ذكاء اصطناعي
2. ${customerName ? `الزبون: ${customerName}. استخدم اسمه بطبيعية` : 'اسأل شو اسمه اذا ما قال'}
3. ردود قصيرة! هاي مكالمة تلفون، مش رسالة
4. ما بتعرف شي؟ "خليني اتأكد وبرجعلك" - وبس
5. بلا ايموجي

## عن المحل:
${businessInfo.name}
${businessInfo.phoneNumber ? `تلفون: ${businessInfo.phoneNumber}` : ''}
${businessInfo.services ? `خدمات: ${businessInfo.services}` : ''}

${businessInfo.faq ? `## اسئلة شائعة:\n${businessInfo.faq}` : ''}

${businessInfo.customPrompt ? `## تعليمات اضافية:\n${businessInfo.customPrompt}` : ''}

## حالة المكالمة:
${state.customerTopic ? `موضوع: ${state.customerTopic}` : ''}
${state.customerRequests.length > 0 ? `طلبات: ${state.customerRequests.join(', ')}` : ''}
دور: ${state.turnCount + 1}`;
  }
  
  // === ENGLISH PROMPT ===
  if (customerLanguage === 'english') {
    const agentRole = isAgentFemale ? "You're a friendly representative of" : "You're a friendly representative of";
    const agentStyle = "Talk like a real person on the phone - casual, warm, natural.";
    
    return `${agentRole} ${businessInfo.name}. ${agentStyle}

## Speaking style:
- Short sentences. Max 10-15 words per response.
- Natural conversation - not robotic, not reading from a script.
- Casual connectors: "okay", "so", "right", "sure", "got it"
- Short responses: "absolutely", "yeah", "sure thing", "no problem"

## Examples:
❌ No: "I am very pleased to assist you today with any questions you may have"
✅ Yes: "Hey! How can I help?"

❌ No: "I shall proceed to verify the availability of appointments for you"
✅ Yes: "Let me check. When works for you?"

## Rules:
1. Never say you're an AI/language model
2. ${customerName ? `Customer: ${customerName}. Use their name naturally` : 'Ask for their name if they haven\'t said it'}
3. Keep it short! This is a phone call, not an email
4. Don't know something? "Let me check and get back to you" - that's it
5. No emojis

## About the business:
${businessInfo.name}
${businessInfo.phoneNumber ? `Phone: ${businessInfo.phoneNumber}` : ''}
${businessInfo.services ? `Services: ${businessInfo.services}` : ''}

${businessInfo.faq ? `## FAQ:\n${businessInfo.faq}` : ''}

${businessInfo.customPrompt ? `## Additional instructions:\n${businessInfo.customPrompt}` : ''}

## Call status:
${state.customerTopic ? `Topic: ${state.customerTopic}` : ''}
${state.customerRequests.length > 0 ? `Requests: ${state.customerRequests.join(', ')}` : ''}
Turn: ${state.turnCount + 1}`;
  }
  
  // === HEBREW PROMPT (default) ===
  const agentRole = isAgentFemale ? 'את נציגה של' : 'אתה נציג של';
  const agentStyle = isAgentFemale 
    ? 'כמו חברה בטלפון - לא רובוטית, לא קוראת מדף.'
    : 'כמו חבר בטלפון - לא רובוט, לא קורא מדף.';
  const agentSpeakStyle = isAgentFemale
    ? 'דברי כמו ישראלית אמיתית - קצר, חם, ספונטני.'
    : 'דבר כמו ישראלי אמיתי - קצר, חם, ספונטני.';
  const agentCheckPhrase = isAgentFemale ? 'רגע אני בודקת' : 'רגע אני בודק';
  const agentHappyPhrase = isAgentFemale ? 'אשמח לבדוק' : 'אשמח לבדוק';
  const agentDontKnow = isAgentFemale ? 'תני לי לבדוק ונחזור אלייך' : 'תן לי לבדוק ונחזור אליך';
  
  const customerGenderContext = state.detectedGender === 'male' 
    ? 'הלקוח גבר - פני אליו בלשון זכר (תשמע, אתה, לך)' 
    : state.detectedGender === 'female'
    ? 'הלקוחה אישה - פני אליה בלשון נקבה (תשמעי, את, לך)'
    : 'לא ברור מגדר הלקוח - השתמשי בניסוח ניטרלי עד שיתברר';
  
  return `${agentRole} ${businessInfo.name}. ${agentSpeakStyle}

## סגנון הדיבור שלך:
- מקסימום 2 משפטים + שאלה אחת. בלי פסקאות. בלי רשימות.
- משפטים קצרים. מקסימום 10-15 מילים לתשובה.
- ${agentStyle}
- מילות קישור טבעיות: "אוקיי", "יאללה", "רגע", "תשמע/תשמעי", "אין בעיה"
- תגובות קצרות: "בטח", "כן", "ברור", "מעולה", "סבבה"
- אל תחזרי על מה שהלקוח אמר. תגיבי ותתקדמי.

## דוגמאות לסגנון:
❌ לא: "אני מאוד ${isAgentFemale ? 'שמחה' : 'שמח'} לעזור לך היום בכל שאלה או בקשה שתהיה לך"
✅ כן: "מה קורה? איך אפשר לעזור?"

❌ לא: "בהחלט, ${agentHappyPhrase} עבורך את הזמינות ולתאם לך תור מתאים"
✅ כן: "אוקיי, ${agentCheckPhrase}. מתי נוח לך?"

❌ לא: "האם יש משהו נוסף שאוכל לסייע לך בו היום?"
✅ כן: "עוד משהו?"

## כללים:
1. לעולם לא להגיד שאת AI/בינה מלאכותית/מודל שפה
2. ${customerName ? `הלקוח: ${customerName}. ${isAgentFemale ? 'תשתמשי' : 'תשתמש'} בשם שלו בטבעיות` : isAgentFemale ? 'תשאלי איך קוראים לו אם עוד לא אמר' : 'תשאל איך קוראים לו אם עוד לא אמר'}
3. תשובות קצרות! זו שיחת טלפון, לא מייל
4. לא ${isAgentFemale ? 'יודעת' : 'יודע'} משהו? "${agentDontKnow}" - וזהו
5. ${customerGenderContext}
6. בלי סמיילים/אימוג'י

## על העסק:
${businessInfo.name}
${businessInfo.phoneNumber ? `טלפון: ${businessInfo.phoneNumber}` : ''}
${businessInfo.services ? `שירותים: ${businessInfo.services}` : ''}

${businessInfo.faq ? `## תשובות מוכנות:\n${businessInfo.faq}` : ''}

${businessInfo.customPrompt ? `## הנחיות נוספות:\n${businessInfo.customPrompt}` : ''}

## מצב השיחה:
${state.customerTopic ? `נושא: ${state.customerTopic}` : ''}
${state.customerRequests.length > 0 ? `בקשות: ${state.customerRequests.join(', ')}` : ''}
תור: ${state.turnCount + 1}`;
}

// Extract customer info from transcript
function extractCustomerInfo(text: string): { extractedName?: string; extractedPhone?: string; extractedTopic?: string } {
  let extractedName: string | undefined;
  let extractedPhone: string | undefined;
  let extractedTopic: string | undefined;
  
  // Hebrew name patterns
  const hebrewNamePatterns = [
    /(?:אני|שמי|קוראים לי|זה)\s+([א-ת]{2,15})/,
    /^([א-ת]{2,15})\s+(?:פה|כאן|מדבר|מדברת)/,
    /(?:השם שלי|שם שלי)\s+([א-ת]{2,15})/
  ];
  
  // English name patterns
  const englishNamePatterns = [
    /(?:my name is|i'm|i am|this is|call me)\s+([A-Za-z]{2,20})/i,
    /^([A-Z][a-z]+)\s+(?:here|speaking|calling)/
  ];
  
  const allNamePatterns = [...hebrewNamePatterns, ...englishNamePatterns];
  
  for (const pattern of allNamePatterns) {
    const match = text.match(pattern);
    if (match) {
      extractedName = match[1];
      console.log('📛 Extracted customer name:', extractedName);
      break;
    }
  }
  
  // Topic extraction patterns
  const topicPatterns = [
    /(?:אני מחפש|אני צריך|אני רוצה|מעוניין ב|רוצה לדעת על|שאלה לגבי|בקשר ל)\s*(.+?)(?:[.,?!]|$)/,
    /(?:מתעניין ב|צריך עזרה עם|יש לי שאלה על)\s*(.+?)(?:[.,?!]|$)/,
    /(?:i need|i want|i'm looking for|interested in|question about|regarding)\s+(.+?)(?:[.,?!]|$)/i,
  ];
  
  for (const pattern of topicPatterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 3) {
      extractedTopic = match[1].trim();
      console.log('📌 Extracted topic:', extractedTopic);
      break;
    }
  }
  
  // Phone number
  const phonePattern = /(\d{9,10}|0\d{1,2}[-\s]?\d{7})/;
  const phoneMatch = text.match(phonePattern);
  if (phoneMatch) {
    extractedPhone = phoneMatch[1].replace(/[-\s]/g, '');
    console.log('📞 Extracted phone:', extractedPhone);
  }
  
  return { extractedName, extractedPhone, extractedTopic };
}

// Add natural filler words for Israeli spontaneous speech
function addFillerWords(response: string, turnCount: number, detectedLanguage: string): string {
  const hebrewFillers = {
    thinking: ['אממ...', 'רגע...', 'אוקיי...', 'טוב...'],
    confirming: ['כן,', 'בטח,', 'ברור,', 'אוקיי,'],
    transitioning: ['אז,', 'יאללה,', 'טוב אז,', 'בסדר,'],
    responding: ['תשמע,', 'תראה,', 'נו,', 'הנה,'],
  };
  
  const arabicFillers = {
    thinking: ['طيب...', 'لحظة...', 'امممم...'],
    confirming: ['اكيد,', 'تمام,', 'ماشي,'],
    responding: ['يعني,', 'شوف,', 'خلص,'],
  };
  
  const englishFillers = {
    thinking: ['Hmm...', 'Let me see...', 'Okay...', 'Right...'],
    confirming: ['Sure,', 'Yeah,', 'Got it,', 'Alright,'],
    responding: ['So,', 'Well,', 'Look,'],
  };
  
  if (response.length < 20 || turnCount === 0) {
    return response;
  }
  
  const allFillers = [...hebrewFillers.thinking, ...hebrewFillers.confirming, 
                      ...arabicFillers.thinking, ...englishFillers.thinking];
  const startsWithFiller = allFillers.some(f => 
    response.startsWith(f.replace('...', '').replace(',', ''))
  );
  if (startsWithFiller) {
    return response;
  }
  
  const lang = detectedLanguage?.toLowerCase() || 'he';
  let fillers: string[];
  
  if (lang.startsWith('ar')) {
    if (response.includes('؟') || response.includes('?')) {
      fillers = arabicFillers.thinking;
    } else {
      fillers = [...arabicFillers.confirming, ...arabicFillers.responding];
    }
  } else if (lang.startsWith('en')) {
    if (response.includes('?')) {
      fillers = englishFillers.thinking;
    } else {
      fillers = [...englishFillers.confirming, ...englishFillers.responding];
    }
  } else {
    if (response.includes('?') || response.includes('?')) {
      fillers = hebrewFillers.thinking;
    } else if (response.startsWith('כן') || response.startsWith('בטח') || response.startsWith('לא')) {
      return response;
    } else {
      fillers = turnCount % 2 === 0 
        ? hebrewFillers.confirming 
        : hebrewFillers.transitioning;
    }
  }
  
  if (Math.random() > 0.3) {
    return response;
  }
  
  const filler = fillers[Math.floor(Math.random() * fillers.length)];
  console.log('💬 Added filler word:', filler);
  
  return `${filler} ${response}`;
}

// Clean AI response from unwanted phrases
function cleanAIResponse(response: string): string {
  const unwantedPhrases = [
    'בתור עוזר AI',
    'כעוזר AI',
    'אני עוזר AI',
    'בתור עוזר בינה מלאכותית',
    'כמודל שפה',
    'אני מודל שפה',
    'as an AI assistant',
    'as an AI',
    'I am an AI',
    'I\'m an AI',
    'אני בינה מלאכותית',
    'אני רובוט',
  ];
  
  for (const phrase of unwantedPhrases) {
    if (response.toLowerCase().includes(phrase.toLowerCase())) {
      console.log('⚠️ Filtering unwanted phrase:', phrase);
      return 'שלום! איך אפשר לעזור?';
    }
  }
  
  return response;
}

// ===== Week 1 A4: FAQ Router =====
// Bypass LLM for common FAQ intents - returns cached responses
interface FAQMatch {
  intent: 'hours' | 'address' | 'whatsapp' | 'prices' | 'cancel' | 'none';
  response: string | null;
  confidence: number;
}

function matchFAQ(transcript: string, businessInfo: BusinessInfo, detectedLanguage: string): FAQMatch {
  const lowerTranscript = transcript.toLowerCase();
  
  // Check each FAQ pattern
  for (const [intent, pattern] of Object.entries(FAQ_PATTERNS)) {
    if (pattern.test(lowerTranscript)) {
      const response = getFAQResponse(intent as keyof typeof FAQ_PATTERNS, businessInfo, detectedLanguage);
      if (response) {
        console.log('🎯 FAQ Match:', intent, '- bypassing LLM');
        return { intent: intent as FAQMatch['intent'], response, confidence: 0.9 };
      }
    }
  }
  
  return { intent: 'none', response: null, confidence: 0 };
}

function getFAQResponse(
  intent: keyof typeof FAQ_PATTERNS, 
  businessInfo: BusinessInfo, 
  detectedLanguage: string
): string | null {
  const isArabic = detectedLanguage?.startsWith('ar');
  const isEnglish = detectedLanguage?.startsWith('en');
  
  // Try to extract info from FAQ JSON
  let faqData: Record<string, string> = {};
  try {
    if (businessInfo.faq) {
      faqData = typeof businessInfo.faq === 'string' ? JSON.parse(businessInfo.faq) : businessInfo.faq;
    }
  } catch { /* ignore */ }
  
  switch (intent) {
    case 'hours':
      // Check FAQ for hours info
      const hoursKey = Object.keys(faqData).find(k => 
        /שעות|פתוח|hours|ساعات/i.test(k)
      );
      if (hoursKey && faqData[hoursKey]) {
        return faqData[hoursKey];
      }
      // Default responses
      if (isArabic) return 'لحظة بشوف لك الساعات. شو اليوم اللي بيناسبك؟';
      if (isEnglish) return 'Let me check our hours. What day works for you?';
      return 'רגע, אני בודק. איזה יום נוח לך?';
      
    case 'address':
      const addressKey = Object.keys(faqData).find(k => 
        /כתובת|מיקום|address|عنوان/i.test(k)
      );
      if (addressKey && faqData[addressKey]) {
        return faqData[addressKey];
      }
      if (isArabic) return 'شو المنطقة اللي قريبة عليك؟ بقلك اقرب فرع.';
      if (isEnglish) return 'Which area are you near? I\'ll find the closest branch.';
      return 'מאיזה אזור אתה? אגיד לך הסניף הכי קרוב.';
      
    case 'whatsapp':
      if (businessInfo.phoneNumber) {
        if (isArabic) return `تمام، بعتلك رابط واتساب على ${businessInfo.phoneNumber}`;
        if (isEnglish) return `Sure, I'll send you a WhatsApp link to ${businessInfo.phoneNumber}`;
        return `מעולה, אשלח לך לינק לוואטסאפ למספר ${businessInfo.phoneNumber}`;
      }
      if (isArabic) return 'اوكي، شو رقم الواتساب تبعك؟';
      if (isEnglish) return 'Sure, what\'s your WhatsApp number?';
      return 'בטח, מה המספר שלך לוואטסאפ?';
      
    case 'prices':
      const pricesKey = Object.keys(faqData).find(k => 
        /מחיר|עלות|price|سعر/i.test(k)
      );
      if (pricesKey && faqData[pricesKey]) {
        return faqData[pricesKey];
      }
      if (isArabic) return 'شو الخدمة اللي بتسأل عنها؟ بقلك السعر.';
      if (isEnglish) return 'Which service are you asking about? I\'ll give you the price.';
      return 'על איזה שירות מדובר? אגיד לך מחיר.';
      
    case 'cancel':
      if (isArabic) return 'اوكي، شو اسمك عشان ابحث الموعد؟';
      if (isEnglish) return 'Sure, what\'s your name so I can find your appointment?';
      return 'בסדר, מה השם שלך שאמצא את התור?';
      
    default:
      return null;
  }
}

// Get voice configuration based on detected language - using Chirp 3 HD
function getVoiceForLanguage(
  detectedLanguage: string, 
  voiceGender: 'FEMALE' | 'MALE',
  sttConfidence: number = 1.0
): { languageCode: string; name: string } {
  
  const chirp3Voices = {
    hebrew: {
      FEMALE: 'he-IL-Chirp3-HD-Aoede',
      MALE: 'he-IL-Chirp3-HD-Charon'
    },
    arabic: {
      FEMALE: 'ar-XA-Chirp3-HD-Aoede',
      MALE: 'ar-XA-Chirp3-HD-Charon'
    },
    english: {
      FEMALE: 'en-US-Chirp3-HD-Aoede',
      MALE: 'en-US-Chirp3-HD-Charon'
    }
  };
  
  if (sttConfidence < 0.5 || !detectedLanguage) {
    console.log('🎤 Low confidence or no language, using Hebrew Chirp3-HD voice');
    return { 
      languageCode: 'he-IL', 
      name: chirp3Voices.hebrew[voiceGender]
    };
  }
  
  const lang = detectedLanguage.toLowerCase();
  
  if (lang.startsWith('en')) {
    console.log('🎤 Using English Chirp3-HD voice');
    return { 
      languageCode: 'en-US', 
      name: chirp3Voices.english[voiceGender]
    };
  } else if (lang.startsWith('ar')) {
    console.log('🎤 Using Arabic Chirp3-HD voice');
    return { 
      languageCode: 'ar-XA', 
      name: chirp3Voices.arabic[voiceGender]
    };
  } else {
    console.log('🎤 Using Hebrew Chirp3-HD voice');
    return { 
      languageCode: 'he-IL', 
      name: chirp3Voices.hebrew[voiceGender]
    };
  }
}

// Hebrew pronunciation fixes
const hebrewPronunciationFixes: Record<string, string> = {
  'בכיף': 'בְּכֵיף',
  'בוקר': 'בּוֹקֶר',
  'סבבה': 'סַבָּבָה',
  'אחלה': 'אַחְלָה',
  'יאללה': 'יַאלְלָה',
  'בסדר': 'בְּסֵדֶר',
  'תודה': 'תּוֹדָה',
  'סליחה': 'סְלִיחָה',
  'בבקשה': 'בְּבַקָּשָׁה',
  'נהדר': 'נֶהְדָּר',
  'מעולה': 'מְעֻלֶּה',
  'בטח': 'בֶּטַח',
  'רגע': 'רֶגַע',
};

function fixHebrewPronunciation(text: string): string {
  let fixedText = text;
  for (const [word, nikud] of Object.entries(hebrewPronunciationFixes)) {
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    fixedText = fixedText.replace(regex, nikud);
  }
  if (fixedText !== text) {
    console.log('🔤 Pronunciation fixes applied:', text, '→', fixedText);
  }
  return fixedText;
}

// Synthesize speech using Google TTS
async function synthesizeSpeech(
  text: string,
  accessToken: string,
  voiceGender: 'FEMALE' | 'MALE' = 'FEMALE',
  detectedLanguage: string = 'he-IL',
  sttConfidence: number = 1.0
): Promise<string> {
  console.log('🔊 Synthesizing speech in', detectedLanguage, ':', text);
  
  const isHebrew = detectedLanguage === 'he-IL' || detectedLanguage.startsWith('he');
  const processedText = isHebrew ? fixHebrewPronunciation(text) : text;
  
  const voiceConfig = getVoiceForLanguage(detectedLanguage, voiceGender, sttConfidence);
  console.log('🎤 Using voice:', voiceConfig.name);
  
  const ttsUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  
  const response = await fetch(ttsUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text: processedText },
      voice: {
        languageCode: voiceConfig.languageCode,
        name: voiceConfig.name,
      },
      audioConfig: {
        audioEncoding: 'MULAW',
        sampleRateHertz: 8000,
        effectsProfileId: ['telephony-class-application'],
        speakingRate: 1.0,
      },
    }),
  });

  const data = await response.json();
  
  // Fallback to Wavenet if Chirp 3 HD not available
  if (data.error) {
    console.log('⚠️ Chirp3-HD unavailable, trying Wavenet fallback:', data.error.message);
    
    const fallbackMap: Record<string, Record<string, string>> = {
      'he-IL': { FEMALE: 'he-IL-Wavenet-A', MALE: 'he-IL-Wavenet-D' },
      'ar-XA': { FEMALE: 'ar-XA-Wavenet-A', MALE: 'ar-XA-Wavenet-B' },
      'en-US': { FEMALE: 'en-US-Wavenet-F', MALE: 'en-US-Wavenet-D' },
    };
    
    const langFallback = fallbackMap[voiceConfig.languageCode] || fallbackMap['he-IL'];
    const fallbackVoice = langFallback[voiceGender] || langFallback['FEMALE'];
    
    console.log('🔄 Using fallback voice:', fallbackVoice);
    
    const fallbackResponse = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { text: processedText },
        voice: {
          languageCode: voiceConfig.languageCode,
          name: fallbackVoice,
        },
        audioConfig: {
          audioEncoding: 'MULAW',
          sampleRateHertz: 8000,
          effectsProfileId: ['telephony-class-application'],
          speakingRate: 1.0,
        },
      }),
    });
    
    const fallbackData = await fallbackResponse.json();
    if (fallbackData.error) {
      console.error('❌ TTS fallback also failed:', fallbackData.error);
      throw new Error('TTS synthesis failed');
    }
    
    return fallbackData.audioContent;
  }

  return data.audioContent;
}

// Send synthesized audio to Twilio
function sendAudioToTwilio(socket: WebSocket, streamSid: string, audioBase64: string): boolean {
  if (socket.readyState !== WebSocket.OPEN) {
    console.error('❌ WebSocket not open, cannot send audio');
    return false;
  }
  
  const chunkSize = 160;
  const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  
  console.log('📤 Sending audio to Twilio, total bytes:', audioBytes.length);
  
  let chunksSent = 0;
  for (let i = 0; i < audioBytes.length; i += chunkSize) {
    const chunk = audioBytes.slice(i, Math.min(i + chunkSize, audioBytes.length));
    const chunkBase64 = btoa(String.fromCharCode(...chunk));
    
    socket.send(JSON.stringify({
      event: 'media',
      streamSid: streamSid,
      media: {
        payload: chunkBase64,
      },
    }));
    chunksSent++;
  }
  
  console.log('✅ Sent', chunksSent, 'audio chunks to Twilio');
  
  socket.send(JSON.stringify({
    event: 'mark',
    streamSid: streamSid,
    mark: { name: 'audio_complete' },
  }));
  
  return true;
}

// Send audio to Twilio WITHOUT mark - for fillers that shouldn't block the response
function sendFillerAudioWithoutMark(
  socket: WebSocket, 
  streamSid: string, 
  audioBase64: string
): void {
  if (socket.readyState !== WebSocket.OPEN) {
    console.error('❌ WebSocket not open for filler');
    return;
  }
  
  const chunkSize = 160;
  const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  
  console.log('🔊 Sending filler audio (no mark), bytes:', audioBytes.length);
  
  for (let i = 0; i < audioBytes.length; i += chunkSize) {
    const chunk = audioBytes.slice(i, Math.min(i + chunkSize, audioBytes.length));
    const chunkBase64 = btoa(String.fromCharCode(...chunk));
    
    socket.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: chunkBase64 },
    }));
  }
}

// Quick filler words for immediate feedback
const QUICK_FILLERS = {
  'he-IL': ['אוקיי', 'טוב', 'רגע'],
  'ar-XA': ['طيب', 'تمام', 'اوكي'],
  'en-US': ['Okay', 'Right', 'Sure'],
};

// Week 1 A2: Send immediate filler word ONLY if >650ms without audio
async function sendImmediateFiller(
  socket: WebSocket,
  state: ConversationState,
  accessToken: string
): Promise<void> {
  if (state.turnCount === 0 || state.isAgentSpeaking) {
    return;
  }
  
  // Week 1 A2: Only send filler if >650ms have passed since last voice
  const timeSinceLastVoice = Date.now() - state.lastVoiceTime;
  if (timeSinceLastVoice < 650) {
    console.log('⏭️ Skipping filler - only', timeSinceLastVoice, 'ms since voice');
    return;
  }
  
  // 50% chance to send filler (reduced from 60%)
  if (Math.random() > 0.5) {
    return;
  }
  
  const lang = state.detectedLanguage || 'he-IL';
  const fillers = QUICK_FILLERS[lang as keyof typeof QUICK_FILLERS] || QUICK_FILLERS['he-IL'];
  const filler = fillers[Math.floor(Math.random() * fillers.length)];
  
  console.log('⚡ Sending immediate filler after', timeSinceLastVoice, 'ms:', filler);
  
  try {
    const fillerAudio = await synthesizeSpeech(
      filler,
      accessToken,
      state.voiceGender,
      lang,
      1.0
    );
    
    sendFillerAudioWithoutMark(socket, state.streamSid, fillerAudio);
    await new Promise(r => setTimeout(r, 150));
  } catch (err) {
    console.error('⚠️ Failed to send filler:', err);
  }
}

// Stream response in sentences for faster time-to-first-audio
async function streamResponseInSentences(
  response: string,
  accessToken: string,
  state: ConversationState,
  socket: WebSocket,
  detectedLanguage: string
): Promise<void> {
  const sentenceDelimiters = /([.!?،。؟]+)/;
  const parts = response.split(sentenceDelimiters);
  
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i] + (parts[i + 1] || '');
    if (sentence.trim().length > 0) {
      sentences.push(sentence.trim());
    }
  }
  
  if (sentences.length <= 1 || response.length < 50) {
    const audio = await synthesizeSpeech(
      response,
      accessToken,
      state.voiceGender,
      detectedLanguage,
      state.sttConfidence
    );
    sendAudioToTwilio(socket, state.streamSid, audio);
    return;
  }
  
  console.log('🎯 Streaming', sentences.length, 'sentences for faster response');
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    
    const audio = await synthesizeSpeech(
      sentence,
      accessToken,
      state.voiceGender,
      detectedLanguage,
      state.sttConfidence
    );
    
    if (i < sentences.length - 1) {
      const chunkSize = 160;
      const audioBytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
      
      for (let j = 0; j < audioBytes.length; j += chunkSize) {
        const chunk = audioBytes.slice(j, Math.min(j + chunkSize, audioBytes.length));
        const chunkBase64 = btoa(String.fromCharCode(...chunk));
        
        socket.send(JSON.stringify({
          event: 'media',
          streamSid: state.streamSid,
          media: { payload: chunkBase64 },
        }));
      }
      
      console.log('📤 Sent sentence', i + 1, '/', sentences.length);
    } else {
      sendAudioToTwilio(socket, state.streamSid, audio);
      console.log('📤 Sent final sentence', i + 1, '/', sentences.length);
    }
  }
}

// ===== STREAMING-BASED AUDIO PROCESSING =====
// Process audio using streaming manager for faster transcription
async function processAudioWithStreaming(
  state: ConversationState,
  accessToken: string,
  socket: WebSocket
): Promise<void> {
  if (state.isProcessing) {
    return;
  }
  
  state.isProcessing = true;
  const processingStartTime = Date.now();
  
  console.log('🚀 STREAMING: Processing audio with streaming STT...');
  
  try {
    // Get transcript from streaming manager
    const result = await stopStreamingAndTranscribe(
      state.streamingSTT,
      accessToken,
      state.projectId,
      state.language === 'he' ? 'he-IL' : state.language === 'ar' ? 'ar-XA' : 'en-US',
      state.phraseHints
    );
    
    const sttTime = Date.now() - processingStartTime;
    console.log(`⚡ STT completed in ${sttTime}ms`);
    
    if (result && result.transcript) {
      const transcript = result.transcript;
      const detectedLanguage = result.language;
      const confidence = result.confidence;
      
      console.log('📝 Transcript:', transcript, '| Lang:', detectedLanguage, '| Conf:', (confidence*100).toFixed(0) + '%');
      
      // Store confidence in state
      state.sttConfidence = confidence;
      
      // Validation: Check for low-confidence short transcripts
      const hebrewWords = /[א-ת]{2,}/g;
      const hebrewMatches = transcript.match(hebrewWords);
      const hasHebrewContent = hebrewMatches !== null && hebrewMatches.length >= 1;
      
      if (!hasHebrewContent && confidence < 0.30 && transcript.length < 6) {
        console.log('⚠️ Ignoring very low confidence short transcript:', transcript);
        state.isProcessing = false;
        return;
      }
      
      // Check greeting grace period
      const GREETING_GRACE_PERIOD_MS = 1200;
      if (state.greetingSentAt > 0 && Date.now() - state.greetingSentAt < GREETING_GRACE_PERIOD_MS) {
        console.log('⏳ In greeting grace period, ignoring transcript:', transcript);
        state.isProcessing = false;
        return;
      }
      
      // Update detected language
      state.detectedLanguage = detectedLanguage;
      
      // Detect gender from transcript
      if (!state.detectedGender) {
        const malePatterns = /\b(אני רוצה|אני צריך|אני מחפש|אני שמח|קוראים לי|שמי|אני מדבר|רציתי)\b/;
        const femalePatterns = /\b(אני רוצה|אני צריכה|אני מחפשת|אני שמחה|קוראים לי|שמי|אני מדברת|רציתי)\b/;
        const maleNames = /\b(עומר|דני|יוסי|אבי|משה|דוד|יעקב|אריאל|רון|עידו|גיל|אסף|שי|תומר|יניב|אייל|גל)\b/i;
        const femaleNames = /\b(רונית|שרה|מיכל|חנה|רחל|לאה|יעל|נועה|מאיה|שירה|עדי|ליאת|טל|דנה|הילה|אורית)\b/i;
        
        if (femalePatterns.test(transcript) && transcript.includes('ה')) {
          state.detectedGender = 'female';
          console.log('👩 Detected female caller from patterns');
        } else if (femaleNames.test(transcript)) {
          state.detectedGender = 'female';
          console.log('👩 Detected female caller from name');
        } else if (maleNames.test(transcript)) {
          state.detectedGender = 'male';
          console.log('👨 Detected male caller from name');
        } else if (malePatterns.test(transcript)) {
          state.detectedGender = 'male';
          console.log('👨 Detected male caller from patterns');
        }
      }
      
      // Add user message to history
      state.conversationHistory.push({
        role: 'user',
        text: transcript,
        timestamp: Date.now()
      });
      state.turnCount++;
      
      // Week 1 A4: Try FAQ Router first before LLM
      const faqMatch = matchFAQ(transcript, state.businessInfo, detectedLanguage);
      
      let aiResult: { response: string; extractedName?: string; extractedPhone?: string; extractedTopic?: string };
      let aiTime = 0;
      
      if (faqMatch.response && faqMatch.confidence > 0.8) {
        // FAQ match - bypass LLM entirely
        console.log(`🎯 FAQ Router: Bypassed LLM for intent "${faqMatch.intent}"`);
        aiResult = { 
          response: faqMatch.response,
          ...extractCustomerInfo(transcript)
        };
        aiTime = 0;
      } else {
        // No FAQ match - use LLM
        const aiStartTime = Date.now();
        aiResult = await getAIResponse(transcript, state);
        aiTime = Date.now() - aiStartTime;
        console.log(`🤖 AI response in ${aiTime}ms:`, aiResult.response);
      }
      
      // Update customer info
      if (aiResult.extractedName && !state.customerName) {
        state.customerName = aiResult.extractedName;
      }
      if (aiResult.extractedPhone && !state.customerPhone) {
        state.customerPhone = aiResult.extractedPhone;
      }
      if (aiResult.extractedTopic) {
        if (!state.customerTopic) {
          state.customerTopic = aiResult.extractedTopic;
        }
        if (!state.customerRequests.includes(aiResult.extractedTopic)) {
          state.customerRequests.push(aiResult.extractedTopic);
        }
      }
      
      // Add agent response to history
      state.conversationHistory.push({
        role: 'agent',
        text: aiResult.response,
        timestamp: Date.now()
      });
      
      // Save to database
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        await supabase.from('calls')
          .update({ 
            transcript: state.conversationHistory,
            customer_name: state.customerName,
            customer_topic: state.customerTopic,
          })
          .eq('user_id', state.userId)
          .neq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1);
      } catch (dbErr) {
        console.error('⚠️ Error saving transcript:', dbErr);
      }
      
      // Mark agent as speaking
      state.isAgentSpeaking = true;
      
      // Synthesize and send response
      const ttsStartTime = Date.now();
      await streamResponseInSentences(
        aiResult.response,
        accessToken,
        state,
        socket,
        detectedLanguage
      );
      const ttsTime = Date.now() - ttsStartTime;
      
      const totalTime = Date.now() - processingStartTime;
      console.log(`⏱️ STREAMING TOTAL: ${totalTime}ms (STT: ${sttTime}ms, AI: ${aiTime}ms, TTS: ${ttsTime}ms)`);
      
      // Reset failure counter
      state.consecutiveSTTFailures = 0;
      
    } else {
      console.log('⚠️ STREAMING: No transcript returned');
      
      state.consecutiveSTTFailures++;
      console.log('📊 Consecutive STT failures:', state.consecutiveSTTFailures);
      
      if (state.consecutiveSTTFailures >= 2 && !state.isAgentSpeaking) {
        console.log('🔄 Sending fallback prompt due to STT failures');
        
        const fallbackPrompts: Record<string, string> = {
          'he-IL': 'סליחה, לא שמעתי טוב. אפשר לחזור על זה?',
          'ar-XA': 'عفوا، لم أسمعك جيدا. ممكن تعيد؟',
          'en-US': 'Sorry, I didn\'t catch that. Could you repeat?',
        };
        const fallbackPrompt = fallbackPrompts[state.detectedLanguage] || fallbackPrompts['he-IL'];
        
        state.isAgentSpeaking = true;
        const fallbackAudio = await synthesizeSpeech(
          fallbackPrompt,
          accessToken,
          state.voiceGender,
          state.detectedLanguage,
          1.0
        );
        sendAudioToTwilio(socket, state.streamSid, fallbackAudio);
        
        state.consecutiveSTTFailures = 0;
      }
    }
  } catch (err) {
    console.error('❌ Error in streaming processing:', err);
  } finally {
    state.isProcessing = false;
  }
}

// Build phrase hints from business data - MULTILINGUAL
function buildPhraseHints(profile: any, script: any): string[] {
  const hints: string[] = [
    // Hebrew business terms
    'פגישה',
    'תור',
    'הזמנה',
    'מחיר',
    'שירות',
    'יועץ',
    'ייעוץ',
    // Hebrew greetings
    'שלום',
    'היי',
    'בוקר טוב',
    'ערב טוב',
    'תודה',
    'בבקשה',
    
    // Arabic greetings and common phrases
    'مرحبا',
    'اهلا',
    'شلون',
    'كيف حالك',
    'شكرا',
    'عفوا',
    'صباح الخير',
    'مساء الخير',
    // Arabic business terms
    'موعد',
    'دور',
    'حجز',
    'سعر',
    'خدمة',
    // Arabic time expressions
    'بكرا',
    'اليوم',
    'الساعة',
    'بعد الظهر',
    'الصبح',
    // Arabic conversation
    'ايوا',
    'اه',
    'لا',
    'اكيد',
    'طيب',
    'ماشي',
    'تمام',
    'يعني',
    'بدي',
    'عايز',
    
    // English common phrases
    'appointment',
    'schedule',
    'booking',
    'price',
    'service',
    'tomorrow',
    'today',
  ];
  
  if (profile?.business_name) {
    hints.push(profile.business_name);
  }
  
  if (script?.services) {
    try {
      const services = typeof script.services === 'string' 
        ? JSON.parse(script.services) 
        : script.services;
      
      if (Array.isArray(services)) {
        services.forEach((service: any) => {
          if (typeof service === 'string') {
            hints.push(service);
          } else if (service?.name) {
            hints.push(service.name);
          }
        });
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  if (script?.phrase_hints) {
    try {
      const customHints = typeof script.phrase_hints === 'string'
        ? JSON.parse(script.phrase_hints)
        : script.phrase_hints;
      
      if (Array.isArray(customHints)) {
        hints.push(...customHints);
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  console.log('📢 Phrase hints (', hints.length, 'terms including Hebrew, Arabic, English)');
  return hints;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = req.headers.get('upgrade');
  
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(req);
    
    let state: ConversationState | null = null;
    let accessToken: string | null = null;
    
    // VAD-based endpoint detection constants - Week 1 A3: Dynamic silence thresholds
    const DEFAULT_SILENCE_MS = 420;              // Faster default (was 500)
    const PAUSE_WORD_SILENCE_MS = 750;           // Extended for pause words
    const MAX_UTTERANCE_MS = 12000;
    const MIN_SPEECH_MS = 350;                   // Reduced from 400ms
    const MIN_AUDIO_BYTES = 1600;
    
    socket.onopen = () => {
      console.log('WebSocket connection opened');
    };

    socket.onmessage = async (event) => {
      try {
        const message: TwilioMediaMessage = JSON.parse(event.data);
        
        switch (message.event) {
          case 'connected':
            console.log('Twilio Media Stream connected');
            break;
            
          case 'start':
            console.log('Stream started:', message.start);
            
            const params = message.start?.customParameters || {};
            const userId = params.userId || '';
            const agentId = params.agentId || '';
            const callSid = message.start?.callSid || '';
            const streamSid = message.start?.streamSid || '';
            
            console.log('Stream params:', { userId, agentId, callSid, streamSid });
            
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            const supabase = createClient(supabaseUrl, supabaseKey);
            
            const { data: profile } = await supabase
              .from('profiles')
              .select('*')
              .eq('user_id', userId)
              .single();
              
            const { data: script } = await supabase
              .from('scripts')
              .select('*')
              .eq('user_id', userId)
              .eq('is_active', true)
              .single();
            
            const credentialsJson = Deno.env.get('GOOGLE_CLOUD_CREDENTIALS');
            if (!credentialsJson) {
              console.error('GOOGLE_CLOUD_CREDENTIALS not set');
              socket.close();
              return;
            }
            
            const credentials = JSON.parse(credentialsJson);
            const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID') || credentials.project_id;
            accessToken = await getAccessToken(credentials);
            
            const businessInfo: BusinessInfo = {
              name: profile?.business_name || 'העסק',
              services: script?.services ? JSON.stringify(script.services) : '',
              faq: script?.faq ? JSON.stringify(script.faq) : '',
              customPrompt: script?.custom_prompt || '',
              phoneNumber: profile?.phone_number || '',
            };
            
            const phraseHints = buildPhraseHints(profile, script);
            
            // Create streaming STT manager
            const streamingSTT = createStreamingSTTManager();
            
            state = {
              userId,
              agentId: agentId || profile?.dialogflow_agent_id || '',
              sessionId: `session-${callSid}`,
              callSid,
              streamSid,
              audioBuffer: [],
              isProcessing: false,
              lastAudioTime: Date.now(),
              credentials,
              projectId,
              greeting: script?.greeting_message || 'שלום, איך אוכל לעזור?',
              language: script?.language || 'he',
              isAgentSpeaking: false,
              interruptedText: null,
              conversationHistory: [],
              customerName: null,
              customerPhone: null,
              customerTopic: null,
              customerRequests: [],
              turnCount: 0,
              lastTTSEndTime: 0,
              echoGracePeriodMs: 400,
              isUserSpeaking: false,
              lastVoiceTime: 0,
              speechStartTime: null,
              noiseFloor: 500,
              noiseFloorSamples: 0,
              totalBufferBytes: 0,
              detectedLanguage: script?.language === 'he' ? 'he-IL' : script?.language === 'ar' ? 'ar-XA' : 'en-US',
              voiceGender: script?.agent_voice_gender === 'male' ? 'MALE' : 'FEMALE',
              sttConfidence: 1.0,
              detectedGender: null,
              greetingSentAt: 0,
              businessInfo,
              phraseHints,
              consecutiveSTTFailures: 0,
              streamingSTT, // NEW: Streaming STT manager
            };
            
            // Send greeting
            if (accessToken && state) {
              const greetingState = state;
              const greetingToken = accessToken;
              
              synthesizeSpeech(greetingState.greeting, greetingToken, greetingState.voiceGender)
                .then(greetingAudio => {
                  setTimeout(() => {
                    try {
                      greetingState.isAgentSpeaking = true;
                      greetingState.greetingSentAt = Date.now();
                      console.log('🎙️ Sending greeting after 300ms delay:', greetingState.greeting);
                      const sent = sendAudioToTwilio(socket, greetingState.streamSid, greetingAudio);
                      if (!sent) {
                        console.error('❌ Failed to send greeting - WebSocket not ready');
                        greetingState.isAgentSpeaking = false;
                      } else {
                        console.log('✅ Greeting sent successfully');
                      }
                    } catch (err) {
                      console.error('Error sending greeting:', err);
                      greetingState.isAgentSpeaking = false;
                    }
                  }, 300);
                })
                .catch(err => {
                  console.error('Error pre-synthesizing greeting:', err);
                });
            }
            
            // Log call start
            if (state) {
              await supabase.from('calls').insert({
                user_id: userId,
                caller_phone: state.customerPhone || null,
                call_type: 'voice',
                status: 'in_progress',
                language: state.language,
              });
            }
            
            break;
            
          case 'media':
            if (!state) break;
            
            const now = Date.now();
            
            if (message.media?.payload) {
              const audioBytes = Uint8Array.from(atob(message.media.payload), c => c.charCodeAt(0));
              const vad = detectVoiceActivity(message.media.payload, state.noiseFloor);
              
              // Calibrate noise floor
              if (state.noiseFloorSamples < 20 && !vad.hasVoice) {
                state.noiseFloor = (state.noiseFloor * state.noiseFloorSamples + vad.energy) / (state.noiseFloorSamples + 1);
                state.noiseFloorSamples++;
                if (state.noiseFloorSamples === 20) {
                  console.log('🎚️ Noise floor calibrated:', state.noiseFloor.toFixed(0));
                }
              }
              
              // Echo suppression check
              const timeSinceTTS = now - state.lastTTSEndTime;
              const isInEchoGracePeriod = state.lastTTSEndTime > 0 && timeSinceTTS < state.echoGracePeriodMs;
              
              // BARGE-IN detection
              if (state.isAgentSpeaking && vad.hasVoice && !state.isProcessing && !isInEchoGracePeriod) {
                console.log('🎤 Barge-in detected! Energy:', vad.energy.toFixed(0));
                
                clearTwilioAudio(socket, state.streamSid);
                state.isAgentSpeaking = false;
                state.lastTTSEndTime = now;
                
                // Start streaming session for barge-in
                startStreamingSTT(state.streamingSTT, accessToken!, state.detectedLanguage, state.phraseHints);
                feedAudioToStreaming(state.streamingSTT, audioBytes);
                
                state.isUserSpeaking = true;
                state.speechStartTime = now;
                state.lastVoiceTime = now;
              }
              
              // LISTEN when agent is not speaking
              if (!state.isAgentSpeaking && !isInEchoGracePeriod) {
                
                if (vad.hasVoice) {
                  state.lastVoiceTime = now;
                  
                  if (!state.isUserSpeaking) {
                    state.isUserSpeaking = true;
                    state.speechStartTime = now;
                    
                    // START streaming session
                    console.log('🟢 STREAMING: Utterance START - Energy:', vad.energy.toFixed(0));
                    startStreamingSTT(state.streamingSTT, accessToken!, state.detectedLanguage, state.phraseHints);
                  }
                  
                  // Feed audio to streaming manager
                  feedAudioToStreaming(state.streamingSTT, audioBytes);
                } else if (state.isUserSpeaking && state.streamingSTT.isActive) {
                  // Continue feeding even during brief silence (for natural pauses)
                  feedAudioToStreaming(state.streamingSTT, audioBytes);
                }
                
                state.lastAudioTime = now;
                
                // END OF UTTERANCE detection - Week 1 A3: Dynamic VAD
                if (state.isUserSpeaking && state.lastVoiceTime > 0) {
                  const silenceDuration = now - state.lastVoiceTime;
                  const speechDuration = state.speechStartTime ? now - state.speechStartTime : 0;
                  
                  // Week 1 A3: Dynamic silence threshold based on pause words
                  const interimTranscript = state.streamingSTT.interimTranscript || '';
                  const hasPauseWord = PAUSE_WORDS_REGEX.test(interimTranscript);
                  const dynamicSilenceThreshold = hasPauseWord ? PAUSE_WORD_SILENCE_MS : DEFAULT_SILENCE_MS;
                  
                  const hasEnoughSilence = silenceDuration >= dynamicSilenceThreshold;
                  const hasMinSpeechDuration = speechDuration >= MIN_SPEECH_MS;
                  const hasEnoughAudio = state.streamingSTT.chunkCount >= (MIN_AUDIO_BYTES / 160);
                  const isMaxDuration = speechDuration >= MAX_UTTERANCE_MS;
                  
                  if ((hasEnoughSilence && hasMinSpeechDuration && hasEnoughAudio) || isMaxDuration) {
                    console.log('🟡 STREAMING: Utterance END - Silence:', silenceDuration, 'ms (threshold:', dynamicSilenceThreshold, 'ms), Duration:', speechDuration, 'ms');
                    
                    state.isUserSpeaking = false;
                    state.speechStartTime = null;
                    
                    // Send immediate filler
                    await sendImmediateFiller(socket, state, accessToken!);
                    
                    // Process using streaming manager
                    await processAudioWithStreaming(state, accessToken!, socket);
                  }
                }
                
                // Discard silent buffers
                if (!state.isUserSpeaking && state.streamingSTT.isActive) {
                  const timeSinceLastAudio = now - state.lastAudioTime;
                  if (timeSinceLastAudio > DEFAULT_SILENCE_MS) {
                    console.log('🗑️ STREAMING: Discarding silent buffer');
                    state.streamingSTT.isActive = false;
                    state.streamingSTT.audioChunksBuffer = [];
                  }
                }
              }
            }
            break;
            
          case 'mark':
            console.log('🔔 Mark received:', message.mark?.name);
            if (message.mark?.name === 'audio_complete' && state) {
              state.lastTTSEndTime = Date.now();
              state.isAgentSpeaking = false;
              state.isUserSpeaking = false;
              state.speechStartTime = null;
              state.lastVoiceTime = 0;
              
              // Reset streaming manager
              state.streamingSTT.isActive = false;
              state.streamingSTT.audioChunksBuffer = [];
              
              console.log('✅ Agent finished speaking, ready to listen');
            }
            break;
            
          case 'stop':
            console.log('Stream stopped');
            
            // Generate call summary and finalize call record
            if (state && state.conversationHistory.length > 0) {
              try {
                const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
                const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                const supabase = createClient(supabaseUrl, supabaseKey);
                
                const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
                let callSummary = '';
                
                console.log('📊 Call stats - History:', state.conversationHistory.length, 'messages');
                
                if (lovableApiKey && state.conversationHistory.length >= 1) {
                  const summaryPrompt = `סכם את השיחה הטלפונית הבאה ב-2-3 משפטים קצרים בעברית. התמקד בעיקר: מה הלקוח רצה ומה סוכם.

שיחה:
${state.conversationHistory.map(h => `${h.role === 'user' ? 'לקוח' : 'נציג'}: ${h.text}`).join('\n')}`;

                  try {
                    const summaryResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${lovableApiKey}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        model: 'google/gemini-3-flash-preview',
                        messages: [
                          { role: 'system', content: 'אתה מסכם שיחות טלפוניות. ענה בעברית בלבד, בקצרה ובתמציתיות.' },
                          { role: 'user', content: summaryPrompt }
                        ],
                        max_tokens: 150,
                        temperature: 0.3,
                      })
                    });
                    
                    if (summaryResponse.ok) {
                      const summaryData = await summaryResponse.json();
                      callSummary = summaryData.choices?.[0]?.message?.content || '';
                      console.log('📝 Generated call summary:', callSummary);
                    }
                  } catch (summaryErr) {
                    console.error('⚠️ Error generating summary:', summaryErr);
                  }
                }
                
                const callDuration = state.conversationHistory.length > 0
                  ? Math.floor((Date.now() - state.conversationHistory[0].timestamp) / 1000)
                  : 0;
                
                const { error: finalError } = await supabase.from('calls')
                  .update({ 
                    status: 'completed',
                    transcript: state.conversationHistory,
                    call_summary: callSummary || null,
                    customer_name: state.customerName,
                    customer_topic: state.customerTopic,
                    duration_seconds: callDuration,
                    summary: callSummary || null,
                  })
                  .eq('user_id', state.userId)
                  .neq('status', 'completed')
                  .order('created_at', { ascending: false })
                  .limit(1);
                
                if (finalError) {
                  console.error('❌ Failed to finalize call:', finalError.message);
                } else {
                  console.log('✅ Call finalized - Duration:', callDuration, 's, Turns:', state.turnCount);
                }
              } catch (finalErr) {
                console.error('⚠️ Error finalizing call:', finalErr);
              }
            }
            break;
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    socket.onerror = (e) => {
      console.error('WebSocket error:', e);
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
    };

    return response;
  }

  // Regular HTTP response
  return new Response(
    JSON.stringify({
      status: 'ok',
      message: 'Twilio Media Stream Handler - Week 1 Optimizations',
      version: '4.0.0-week1',
      features: [
        'A1: LLM hardening (temp 0.35, max_tokens 140, 180-char truncation)',
        'A2: Smart bridging (650ms threshold)',
        'A3: Dynamic VAD (420ms default, 750ms for pause words)',
        'A4: FAQ Router (hours, address, whatsapp, prices, cancel)'
      ]
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
