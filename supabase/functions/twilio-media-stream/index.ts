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
  customerTopic: string | null;  // What the customer is looking for
  customerRequests: string[];     // Accumulated requests/interests
  turnCount: number;
  // Echo suppression
  lastTTSEndTime: number;
  echoGracePeriodMs: number;
  // NEW: Proper VAD state
  isUserSpeaking: boolean;
  lastVoiceTime: number;
  speechStartTime: number | null;
  noiseFloor: number;
  noiseFloorSamples: number;
  totalBufferBytes: number;
  // Multi-language detection
  detectedLanguage: string;
  voiceGender: 'FEMALE' | 'MALE';
  sttConfidence: number;  // Track STT confidence for TTS voice selection
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

// Voice Activity Detection - PROPER energy calculation using decoded Linear16
function detectVoiceActivity(audioPayload: string, noiseFloor: number): { hasVoice: boolean; energy: number } {
  try {
    const audioBytes = Uint8Array.from(atob(audioPayload), c => c.charCodeAt(0));
    
    // Calculate RMS energy using DECODED Linear16 values (not raw MULAW bytes!)
    let sumSquares = 0;
    for (let i = 0; i < audioBytes.length; i++) {
      const linear16Sample = MULAW_DECODE_TABLE[audioBytes[i]];
      sumSquares += linear16Sample * linear16Sample;
    }
    const rms = Math.sqrt(sumSquares / audioBytes.length);
    
    // Adaptive threshold: voice if energy exceeds noise floor by significant margin
    // For Linear16, typical noise floor is ~100-500, voice is 2000+
    const VOICE_THRESHOLD_DELTA = 1500; // Energy above noise floor to count as voice
    const MIN_VOICE_ENERGY = 800; // Absolute minimum for voice
    
    const threshold = Math.max(noiseFloor + VOICE_THRESHOLD_DELTA, MIN_VOICE_ENERGY);
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

  // Import private key
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

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// Convert mulaw to linear16 for Google STT
function mulawToLinear16(mulawData: Uint8Array): Int16Array {
  const linear16 = new Int16Array(mulawData.length);
  for (let i = 0; i < mulawData.length; i++) {
    linear16[i] = MULAW_DECODE_TABLE[mulawData[i]];
  }
  return linear16;
}

// Convert linear16 to mulaw for Twilio
function linear16ToMulaw(linear16Data: Int16Array): Uint8Array {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;
  
  const mulaw = new Uint8Array(linear16Data.length);
  
  for (let i = 0; i < linear16Data.length; i++) {
    let sample = linear16Data[i];
    const sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > MULAW_MAX) sample = MULAW_MAX;
    sample = sample + MULAW_BIAS;
    
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
    
    const mantissa = (sample >> (exponent + 3)) & 0x0F;
    mulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xFF;
  }
  
  return mulaw;
}

// Perform speech-to-text using Google Cloud with multi-language detection
async function transcribeAudio(
  mulawAudioBase64: string, 
  accessToken: string, 
  projectId: string,
  primaryLanguage: string = 'he-IL'
): Promise<{ transcript: string | null; detectedLanguage: string; confidence: number }> {
  console.log('🎤 Transcribing audio, MULAW base64 length:', mulawAudioBase64.length);
  
  const sttUrl = `https://speech.googleapis.com/v1/speech:recognize`;
  
  // Multi-language detection: primary language + alternatives
  const response = await fetch(sttUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      config: {
        encoding: 'MULAW',
        sampleRateHertz: 8000,
        languageCode: primaryLanguage,
        // Enable multi-language detection
        alternativeLanguageCodes: ['en-US', 'ar-XA'],
        model: 'telephony_short',
        useEnhanced: true,
      },
      audio: {
        content: mulawAudioBase64,
      },
    }),
  });

  const data = await response.json();
  console.log('📝 STT response:', JSON.stringify(data));

  if (data.results && data.results[0]?.alternatives?.[0]?.transcript) {
    const transcript = data.results[0].alternatives[0].transcript;
    const confidence = data.results[0].alternatives[0].confidence || 0;
    let detectedLanguage = data.results[0].languageCode || primaryLanguage;
    
    // CONFIDENCE FILTER: If non-Hebrew with low confidence, default to Hebrew
    if (detectedLanguage !== 'he-IL' && confidence < 0.5) {
      console.log(`⚠️ Low confidence (${(confidence*100).toFixed(0)}%) for ${detectedLanguage}, defaulting to he-IL`);
      detectedLanguage = 'he-IL';
    }
    
    console.log('🗣️ Transcript:', transcript, '| Language:', detectedLanguage, '| Confidence:', (confidence*100).toFixed(0) + '%');
    return { transcript, detectedLanguage, confidence };
  }
  
  console.log('❌ No transcript in response');
  return { transcript: null, detectedLanguage: primaryLanguage, confidence: 0 };
}

// Query Dialogflow CX with context and detected language
async function queryDialogflow(
  text: string,
  sessionId: string,
  agentId: string,
  accessToken: string,
  projectId: string,
  conversationHistory: { role: string; text: string }[] = [],
  customerName: string | null = null,
  detectedLanguage: string = 'he-IL'
): Promise<{ response: string; extractedName?: string; extractedPhone?: string; extractedTopic?: string }> {
  console.log('🤖 Querying Dialogflow with:', text);
  
  const dialogflowUrl = `https://global-dialogflow.googleapis.com/v3/projects/${projectId}/locations/global/agents/${agentId}/sessions/${sessionId}:detectIntent`;
  
  // Build query parameters with context
  const queryParams: Record<string, any> = {};
  
  // Add conversation context as parameters
  if (conversationHistory.length > 0) {
    queryParams['conversation_context'] = conversationHistory
      .slice(-5) // Last 5 turns
      .map(h => `${h.role === 'user' ? 'לקוח' : 'סוכן'}: ${h.text}`)
      .join('\n');
  }
  
  if (customerName) {
    queryParams['customer_name'] = customerName;
  }
  
  const response = await fetch(dialogflowUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queryInput: {
        text: { text },
        // Use detected language for Dialogflow (extract base language code)
        languageCode: detectedLanguage?.split('-')[0] || 'he',
      },
      queryParams: {
        parameters: queryParams
      }
    }),
  });

  const data = await response.json();
  console.log('🤖 Dialogflow response:', JSON.stringify(data));

  // Extract customer name from response if mentioned - MULTI-LANGUAGE
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
  
  // Arabic name patterns
  const arabicNamePatterns = [
    /(?:اسمي|أنا)\s+([\u0600-\u06FF]{2,20})/,
    /^([\u0600-\u06FF]{2,20})\s+(?:هنا|يتحدث)/
  ];
  
  // Try all patterns based on detected language
  const allNamePatterns = [...hebrewNamePatterns, ...englishNamePatterns, ...arabicNamePatterns];
  
  for (const pattern of allNamePatterns) {
    const match = text.match(pattern);
    if (match) {
      extractedName = match[1];
      console.log('📛 Extracted customer name:', extractedName);
      break;
    }
  }
  
  // Topic extraction patterns - what is the customer looking for?
  const topicPatterns = [
    // Hebrew
    /(?:אני מחפש|אני צריך|אני רוצה|מעוניין ב|רוצה לדעת על|שאלה לגבי|בקשר ל)\s*(.+?)(?:[.,?!]|$)/,
    /(?:מתעניין ב|צריך עזרה עם|יש לי שאלה על)\s*(.+?)(?:[.,?!]|$)/,
    // English
    /(?:i need|i want|i'm looking for|interested in|question about|regarding)\s+(.+?)(?:[.,?!]|$)/i,
    /(?:can you help me with|tell me about)\s+(.+?)(?:[.,?!]|$)/i,
    // Arabic
    /(?:أريد|أبحث عن|أحتاج|سؤال حول)\s+([\u0600-\u06FF\s]+?)(?:[.,?!]|$)/
  ];
  
  for (const pattern of topicPatterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 3) {
      extractedTopic = match[1].trim();
      console.log('📌 Extracted topic:', extractedTopic);
      break;
    }
  }
  
  // Check for phone number
  const phonePattern = /(\d{9,10}|0\d{1,2}[-\s]?\d{7})/;
  const phoneMatch = text.match(phonePattern);
  if (phoneMatch) {
    extractedPhone = phoneMatch[1].replace(/[-\s]/g, '');
    console.log('📞 Extracted phone:', extractedPhone);
  }

  let responseText = 'סליחה, לא הבנתי. אפשר לחזור?';
  
    if (data.queryResult?.responseMessages) {
      for (const msg of data.queryResult.responseMessages) {
        if (msg.text?.text?.[0]) {
          responseText = msg.text.text[0];
          break;
        }
      }
    }
    
    // Filter unwanted "AI assistant" responses
    const unwantedPhrases = [
      'בתור עוזר AI',
      'כעוזר AI',
      'אני עוזר AI',
      'בתור עוזר בינה מלאכותית',
      'as an AI assistant',
      'as an AI',
      'I am an AI'
    ];
    
    const containsUnwanted = unwantedPhrases.some(phrase => 
      responseText.toLowerCase().includes(phrase.toLowerCase())
    );
    
    if (containsUnwanted) {
      console.log('⚠️ Filtering unwanted AI response:', responseText.substring(0, 80));
      // Replace with friendly alternative
      if (customerName) {
        responseText = `שלום ${customerName}! איך אוכל לעזור לך היום?`;
      } else {
        responseText = 'שלום! איך אוכל לעזור לך היום?';
      }
    }
  
  // Personalize response with customer name if available
  if (customerName && responseText.includes('לקוח')) {
    responseText = responseText.replace(/לקוח/g, customerName);
  }
  
  return { response: responseText, extractedName, extractedPhone, extractedTopic };
}

// Get voice configuration based on detected language
function getVoiceForLanguage(
  detectedLanguage: string, 
  voiceGender: 'FEMALE' | 'MALE',
  sttConfidence: number = 1.0
): { languageCode: string; name: string } {
  
  // If low confidence - always use Hebrew voice
  if (sttConfidence < 0.5 || !detectedLanguage) {
    console.log('🎤 Low confidence or no language, using Hebrew voice');
    return { 
      languageCode: 'he-IL', 
      name: voiceGender === 'FEMALE' ? 'he-IL-Studio-A' : 'he-IL-Studio-B' 
    };
  }
  
  const lang = detectedLanguage.toLowerCase();
  
  // Only use detected language if confidence is high
  if (lang.startsWith('en')) {
    return { 
      languageCode: 'en-US', 
      name: voiceGender === 'FEMALE' ? 'en-US-Studio-O' : 'en-US-Studio-M' 
    };
  } else if (lang.startsWith('ar')) {
    return { 
      languageCode: 'ar-XA', 
      name: voiceGender === 'FEMALE' ? 'ar-XA-Wavenet-A' : 'ar-XA-Wavenet-B' 
    };
  } else {
    // Default to Hebrew
    return { 
      languageCode: 'he-IL', 
      name: voiceGender === 'FEMALE' ? 'he-IL-Studio-A' : 'he-IL-Studio-B' 
    };
  }
}

// Synthesize speech using Google TTS with language-aware voice selection
async function synthesizeSpeech(
  text: string,
  accessToken: string,
  voiceGender: 'FEMALE' | 'MALE' = 'FEMALE',
  detectedLanguage: string = 'he-IL',
  sttConfidence: number = 1.0
): Promise<string> {
  console.log('🔊 Synthesizing speech in', detectedLanguage, ':', text);
  
  // Get appropriate voice for detected language WITH confidence check
  const voiceConfig = getVoiceForLanguage(detectedLanguage, voiceGender, sttConfidence);
  console.log('🎤 Using voice:', voiceConfig.name, 'for language:', voiceConfig.languageCode, '| STT confidence:', (sttConfidence*100).toFixed(0) + '%');
  
  // Use v1beta1 for Studio voices (Chirp 3 - highest quality)
  const ttsUrl = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
  
  // Add SSML for more natural speech with pauses and prosody
  const ssmlText = `<speak>
    <prosody rate="medium" pitch="0st">
      ${text.replace(/\./g, '.<break time="300ms"/>')
            .replace(/,/g, ',<break time="150ms"/>')
            .replace(/\?/g, '?<break time="400ms"/>')}
    </prosody>
  </speak>`;
  
  const response = await fetch(ttsUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { ssml: ssmlText },
      voice: {
        languageCode: voiceConfig.languageCode,
        name: voiceConfig.name,
      },
      audioConfig: {
        audioEncoding: 'MULAW',
        sampleRateHertz: 8000,
        effectsProfileId: ['telephony-class-application'],
        speakingRate: 0.95,
      },
    }),
  });

  const data = await response.json();
  
  // Fallback to Wavenet if Studio not available
  if (data.error) {
    console.log('⚠️ Studio voice not available, falling back to Wavenet:', data.error.message);
    
    // Fallback voice names
    const fallbackVoice = detectedLanguage.startsWith('en') 
      ? 'en-US-Wavenet-F' 
      : detectedLanguage.startsWith('ar')
        ? 'ar-XA-Wavenet-A'
        : 'he-IL-Wavenet-A';
    
    const fallbackResponse = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: voiceConfig.languageCode,
          name: fallbackVoice,
        },
        audioConfig: {
          audioEncoding: 'MULAW',
          sampleRateHertz: 8000,
          effectsProfileId: ['telephony-class-application'],
        },
      }),
    });
    
    const fallbackData = await fallbackResponse.json();
    if (fallbackData.audioContent) {
      return fallbackData.audioContent;
    }
  }
  
  if (data.audioContent) {
    return data.audioContent;
  }
  
  throw new Error('Failed to synthesize speech: ' + JSON.stringify(data));
}

// Send audio to Twilio via WebSocket
function sendAudioToTwilio(
  socket: WebSocket, 
  streamSid: string, 
  audioBase64: string
): void {
  // Split audio into chunks (Twilio expects 20ms chunks = 160 bytes at 8kHz MULAW)
  const chunkSize = 160; // 160 bytes = 20ms at 8kHz MULAW
  const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  
  console.log('🔊 Sending TTS audio, total bytes:', audioBytes.length);
  
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
  }
  
  // Send mark to know when audio finished playing
  socket.send(JSON.stringify({
    event: 'mark',
    streamSid: streamSid,
    mark: { name: 'audio_complete' },
  }));
}

// Process audio buffer and get response
async function processAudioBuffer(
  state: ConversationState,
  accessToken: string,
  socket: WebSocket
): Promise<void> {
  if (state.isProcessing || state.audioBuffer.length === 0) {
    return;
  }
  
  state.isProcessing = true;
  console.log('🔄 Processing audio buffer, chunks:', state.audioBuffer.length, 'bytes:', state.totalBufferBytes);
  
  try {
    // Combine all audio chunks into single buffer
    const combinedMulaw = new Uint8Array(state.totalBufferBytes);
    let offset = 0;
    for (const chunk of state.audioBuffer) {
      combinedMulaw.set(chunk, offset);
      offset += chunk.length;
    }
    
    console.log('📦 Combined MULAW audio bytes:', combinedMulaw.length);
    
    // Clear buffer
    state.audioBuffer = [];
    state.totalBufferBytes = 0;
    
    // Convert to base64 and send to STT (MULAW directly!)
    const mulawBase64 = btoa(String.fromCharCode(...combinedMulaw));
    
    // Refresh token if needed
    if (!accessToken) {
      accessToken = await getAccessToken(state.credentials);
    }
    
    // Transcribe with multi-language detection
    const { transcript, detectedLanguage, confidence } = await transcribeAudio(
      mulawBase64, 
      accessToken, 
      state.projectId,
      state.language === 'he' ? 'he-IL' : state.language === 'ar' ? 'ar-XA' : 'en-US'
    );
    console.log('📝 Transcript:', transcript, '| Language:', detectedLanguage, '| Confidence:', (confidence*100).toFixed(0) + '%');
    
    // Store confidence in state for TTS voice selection
    state.sttConfidence = confidence;
    
    if (transcript) {
      // Update detected language in state for future TTS
      state.detectedLanguage = detectedLanguage;
      
      // Add user message to conversation history
      state.conversationHistory.push({
        role: 'user',
        text: transcript,
        timestamp: Date.now()
      });
      state.turnCount++;
      
      // Query Dialogflow with context and detected language
      const result = await queryDialogflow(
        transcript,
        state.sessionId,
        state.agentId,
        accessToken,
        state.projectId,
        state.conversationHistory,
        state.customerName,
        detectedLanguage
      );
      
      // Update customer info if extracted
      if (result.extractedName && !state.customerName) {
        state.customerName = result.extractedName;
        console.log('📛 Customer identified:', state.customerName);
      }
      if (result.extractedPhone && !state.customerPhone) {
        state.customerPhone = result.extractedPhone;
        console.log('📞 Phone captured:', state.customerPhone);
      }
      if (result.extractedTopic) {
        // Update topic or add to requests list
        if (!state.customerTopic) {
          state.customerTopic = result.extractedTopic;
        }
        // Add to requests list if not already there
        if (!state.customerRequests.includes(result.extractedTopic)) {
          state.customerRequests.push(result.extractedTopic);
          console.log('📌 Added customer request:', result.extractedTopic);
        }
      }
      
      // Add agent response to history
      state.conversationHistory.push({
        role: 'agent',
        text: result.response,
        timestamp: Date.now()
      });
      
      console.log('🤖 Agent response:', result.response);
      
      // Mark agent as speaking before sending audio
      state.isAgentSpeaking = true;
      
      // Synthesize and send response in the detected language (with confidence for voice selection)
      const responseAudio = await synthesizeSpeech(
        result.response, 
        accessToken, 
        state.voiceGender,
        detectedLanguage,
        state.sttConfidence
      );
      sendAudioToTwilio(socket, state.streamSid, responseAudio);
    } else {
      console.log('⚠️ No transcript returned from STT');
    }
  } catch (err) {
    console.error('❌ Error processing audio:', err);
  } finally {
    state.isProcessing = false;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = req.headers.get('upgrade');
  
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    // WebSocket upgrade for Twilio Media Streams
    const { socket, response } = Deno.upgradeWebSocket(req);
    
    let state: ConversationState | null = null;
    let accessToken: string | null = null;
    
    // VAD-based endpoint detection constants
    const END_OF_UTTERANCE_SILENCE_MS = 1200; // Silence duration to trigger processing
    const MAX_UTTERANCE_MS = 12000; // Maximum utterance length before force-processing
    const MIN_SPEECH_MS = 300; // Minimum speech duration to consider valid
    const MIN_AUDIO_BYTES = 1600; // Minimum audio bytes (200ms at 8kHz)
    
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
            
            // Initialize conversation state from custom parameters
            const params = message.start?.customParameters || {};
            const userId = params.userId || '';
            const agentId = params.agentId || '';
            const callSid = message.start?.callSid || '';
            const streamSid = message.start?.streamSid || '';
            
            console.log('Stream params:', { userId, agentId, callSid, streamSid });
            
            // Get Google credentials
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            const supabase = createClient(supabaseUrl, supabaseKey);
            
            // Get user profile and script
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
            
            // Get credentials
            const credentialsJson = Deno.env.get('GOOGLE_CLOUD_CREDENTIALS');
            if (!credentialsJson) {
              console.error('GOOGLE_CLOUD_CREDENTIALS not set');
              socket.close();
              return;
            }
            
            const credentials = JSON.parse(credentialsJson);
            const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID') || credentials.project_id;
            accessToken = await getAccessToken(credentials);
            
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
              // Barge-in support
              isAgentSpeaking: false,
              interruptedText: null,
              // Conversation context
              conversationHistory: [],
              customerName: null,
              customerPhone: null,
              customerTopic: null,
              customerRequests: [],
              turnCount: 0,
              // Echo suppression
              lastTTSEndTime: 0,
              echoGracePeriodMs: 600,
              // NEW: Proper VAD state
              isUserSpeaking: false,
              lastVoiceTime: 0,
              speechStartTime: null,
              noiseFloor: 500, // Initial estimate, will calibrate
              noiseFloorSamples: 0,
              totalBufferBytes: 0,
              // Multi-language detection - initialize with script language
              detectedLanguage: script?.language === 'he' ? 'he-IL' : script?.language === 'ar' ? 'ar-XA' : 'en-US',
              voiceGender: 'FEMALE',
              sttConfidence: 1.0,  // Default to high confidence
            };
            
            // Send initial greeting
            if (accessToken && state) {
              try {
                state.isAgentSpeaking = true;
                console.log('🎙️ Sending greeting:', state.greeting);
                const greetingAudio = await synthesizeSpeech(state.greeting, accessToken);
                sendAudioToTwilio(socket, state.streamSid, greetingAudio);
              } catch (err) {
                console.error('Error sending greeting:', err);
                if (state) state.isAgentSpeaking = false;
              }
            }
            
            // Log call start
            if (state) {
              await supabase.from('calls').insert({
                user_id: userId,
                call_type: 'inbound',
                status: 'in-progress',
                language: state.language,
              });
            }
            
            break;
            
          case 'media':
            if (!state) break;
            
            const now = Date.now();
            
            if (message.media?.payload) {
              // Decode chunk for proper handling
              const audioBytes = Uint8Array.from(atob(message.media.payload), c => c.charCodeAt(0));
              
              // Check for voice activity with proper VAD
              const vad = detectVoiceActivity(message.media.payload, state.noiseFloor);
              
              // Calibrate noise floor from first few silent chunks
              if (state.noiseFloorSamples < 20 && !vad.hasVoice) {
                // Running average of noise floor
                state.noiseFloor = (state.noiseFloor * state.noiseFloorSamples + vad.energy) / (state.noiseFloorSamples + 1);
                state.noiseFloorSamples++;
                if (state.noiseFloorSamples === 20) {
                  console.log('🎚️ Noise floor calibrated:', state.noiseFloor.toFixed(0));
                }
              }
              
              // Echo suppression: Check if we're still in the grace period after TTS
              const timeSinceTTS = now - state.lastTTSEndTime;
              const isInEchoGracePeriod = state.lastTTSEndTime > 0 && timeSinceTTS < state.echoGracePeriodMs;
              
              // BARGE-IN: If agent is speaking and user starts talking (not echo)
              if (state.isAgentSpeaking && vad.hasVoice && !state.isProcessing && !isInEchoGracePeriod) {
                console.log('🎤 Barge-in detected! Energy:', vad.energy.toFixed(0), 'Threshold:', (state.noiseFloor + 1500).toFixed(0));
                
                // Stop agent audio immediately
                clearTwilioAudio(socket, state.streamSid);
                state.isAgentSpeaking = false;
                state.lastTTSEndTime = now;
                
                // Start capturing the interruption
                state.audioBuffer = [audioBytes];
                state.totalBufferBytes = audioBytes.length;
                state.isUserSpeaking = true;
                state.speechStartTime = now;
                state.lastVoiceTime = now;
              }
              
              // LISTEN: When agent is not speaking
              if (!state.isAgentSpeaking && !isInEchoGracePeriod) {
                
                // Update voice detection state
                if (vad.hasVoice) {
                  state.lastVoiceTime = now;
                  
                  // Start of new utterance
                  if (!state.isUserSpeaking) {
                    state.isUserSpeaking = true;
                    state.speechStartTime = now;
                    state.audioBuffer = [];
                    state.totalBufferBytes = 0;
                    console.log('🟢 Utterance START - Energy:', vad.energy.toFixed(0));
                  }
                }
                
                // Buffer audio while user is speaking (or might be speaking)
                if (state.isUserSpeaking || state.audioBuffer.length > 0) {
                  state.audioBuffer.push(audioBytes);
                  state.totalBufferBytes += audioBytes.length;
                  state.lastAudioTime = now;
                }
                
                // Log state periodically (every ~1 second)
                if (state.audioBuffer.length > 0 && state.audioBuffer.length % 50 === 0) {
                  const speechDuration = state.speechStartTime ? now - state.speechStartTime : 0;
                  const silenceDuration = now - state.lastVoiceTime;
                  console.log('📊 Audio state:', {
                    isUserSpeaking: state.isUserSpeaking,
                    bufferBytes: state.totalBufferBytes,
                    energy: vad.energy.toFixed(0),
                    noiseFloor: state.noiseFloor.toFixed(0),
                    speechMs: speechDuration,
                    silenceMs: silenceDuration,
                    hasVoice: vad.hasVoice
                  });
                }
                
                // END OF UTTERANCE DETECTION
                if (state.isUserSpeaking && state.lastVoiceTime > 0) {
                  const silenceDuration = now - state.lastVoiceTime;
                  const speechDuration = state.speechStartTime ? now - state.speechStartTime : 0;
                  
                  // Process if:
                  // 1. Enough silence after speech
                  // 2. Speech was long enough to be valid
                  // 3. We have enough audio data
                  const hasEnoughSilence = silenceDuration >= END_OF_UTTERANCE_SILENCE_MS;
                  const hasMinSpeechDuration = speechDuration >= MIN_SPEECH_MS;
                  const hasEnoughAudio = state.totalBufferBytes >= MIN_AUDIO_BYTES;
                  
                  // Force process if utterance is too long
                  const isMaxDuration = speechDuration >= MAX_UTTERANCE_MS;
                  
                  if ((hasEnoughSilence && hasMinSpeechDuration && hasEnoughAudio) || isMaxDuration) {
                    console.log('🟡 Utterance END - Silence:', silenceDuration, 'ms, Duration:', speechDuration, 'ms, Bytes:', state.totalBufferBytes);
                    
                    // Reset speaking state
                    state.isUserSpeaking = false;
                    state.speechStartTime = null;
                    
                    // Process the audio
                    await processAudioBuffer(state, accessToken!, socket);
                  }
                }
                
                // Handle case where we've been listening but no voice detected at all
                // (user might have started buffering but stopped talking)
                if (!state.isUserSpeaking && state.audioBuffer.length > 0) {
                  const timeSinceLastAudio = now - state.lastAudioTime;
                  if (timeSinceLastAudio > END_OF_UTTERANCE_SILENCE_MS) {
                    // Discard buffer if no speech was detected
                    console.log('🗑️ Discarding silent buffer, chunks:', state.audioBuffer.length);
                    state.audioBuffer = [];
                    state.totalBufferBytes = 0;
                  }
                }
              }
            }
            break;
            
          case 'mark':
            console.log('🔔 Mark received:', message.mark?.name);
            if (message.mark?.name === 'audio_complete' && state) {
              // Mark when TTS ended for echo suppression
              state.lastTTSEndTime = Date.now();
              
              // IMMEDIATELY start listening
              state.isAgentSpeaking = false;
              state.isUserSpeaking = false;
              state.speechStartTime = null;
              state.lastVoiceTime = 0;
              state.audioBuffer = [];
              state.totalBufferBytes = 0;
              
              console.log('✅ Agent finished speaking, ready to listen');
            }
            break;
            
          case 'stop':
            console.log('Stream stopped');
            break;
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
    };

    return response;
  }
  
  // Regular HTTP request - return info
  return new Response(
    JSON.stringify({ 
      message: 'Twilio Media Stream WebSocket Handler',
      usage: 'Connect via WebSocket for real-time audio streaming',
      features: ['Real-time STT (MULAW)', 'Dialogflow CX', 'TTS', 'VAD-based Endpointing', 'Barge-in'],
    }),
    { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
