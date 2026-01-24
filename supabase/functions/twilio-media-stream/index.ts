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
  // Business info for AI prompting
  businessInfo: BusinessInfo;
  // Phrase hints for STT
  phraseHints: string[];
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

// Voice Activity Detection
function detectVoiceActivity(audioPayload: string, noiseFloor: number): { hasVoice: boolean; energy: number } {
  try {
    const audioBytes = Uint8Array.from(atob(audioPayload), c => c.charCodeAt(0));
    
    let sumSquares = 0;
    for (let i = 0; i < audioBytes.length; i++) {
      const linear16Sample = MULAW_DECODE_TABLE[audioBytes[i]];
      sumSquares += linear16Sample * linear16Sample;
    }
    const rms = Math.sqrt(sumSquares / audioBytes.length);
    
    const VOICE_THRESHOLD_DELTA = 1500;
    const MIN_VOICE_ENERGY = 800;
    
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

// ===== STABLE: Speech-to-Text using Google Cloud V1 API with phone_call model =====
async function transcribeAudio(
  mulawAudioBase64: string, 
  accessToken: string, 
  projectId: string,
  primaryLanguage: string = 'he-IL',
  phraseHints: string[] = []
): Promise<{ transcript: string | null; detectedLanguage: string; confidence: number }> {
  console.log('🎤 Transcribing with V1 phone_call model, audio length:', mulawAudioBase64.length);
  
  // Use stable V1 API with enhanced phone_call model
  const sttUrl = 'https://speech.googleapis.com/v1/speech:recognize';
  
  // Build speech contexts for better business term recognition
  const speechContexts = phraseHints.length > 0 ? [{
    phrases: phraseHints.slice(0, 500), // Max 500 phrases
    boost: 15
  }] : [];
  
  const requestBody: any = {
    config: {
      encoding: 'MULAW',
      sampleRateHertz: 8000,
      languageCode: primaryLanguage,
      alternativeLanguageCodes: ['en-US', 'ar-XA'],
      model: 'phone_call', // Optimized for telephony
      useEnhanced: true,   // Enhanced model for better accuracy
      enableAutomaticPunctuation: true,
      profanityFilter: false,
    },
    audio: {
      content: mulawAudioBase64,
    },
  };
  
  // Add speech contexts only if we have hints
  if (speechContexts.length > 0) {
    requestBody.config.speechContexts = speechContexts;
    console.log('📋 Using', phraseHints.length, 'phrase hints for recognition');
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
    console.log('📝 V1 STT Response:', JSON.stringify(data).substring(0, 800));

    // Check for API errors
    if (data.error) {
      console.error('❌ STT API Error:', data.error.message);
      return { transcript: null, detectedLanguage: primaryLanguage, confidence: 0 };
    }

    // Parse response
    if (data.results && data.results[0]?.alternatives?.[0]?.transcript) {
      const transcript = data.results[0].alternatives[0].transcript;
      const confidence = data.results[0].alternatives[0].confidence || 0.8;
      let detectedLanguage = data.results[0].languageCode || primaryLanguage;
      
      // Hebrew word indicators - override Arabic detection when Hebrew greeting detected
      const hebrewIndicators = ['שלום', 'היי', 'בוקר', 'ערב', 'אלו', 'מה', 'איך', 'כן', 'לא', 'תודה', 'בבקשה', 'סליחה', 'רגע'];
      const containsHebrew = hebrewIndicators.some(word => transcript.includes(word));
      
      // Override Arabic detection to Hebrew if Hebrew words found
      if (containsHebrew && detectedLanguage.startsWith('ar')) {
        console.log('🔄 Detected Hebrew in Arabic transcript, switching to he-IL');
        detectedLanguage = 'he-IL';
      }
      
      // Confidence filter: default to Hebrew if non-Hebrew with low confidence
      if (detectedLanguage !== 'he-IL' && confidence < 0.5) {
        console.log(`⚠️ Low confidence (${(confidence*100).toFixed(0)}%) for ${detectedLanguage}, defaulting to he-IL`);
        detectedLanguage = 'he-IL';
      }
      
      console.log('✅ Transcript:', transcript, '| Lang:', detectedLanguage, '| Confidence:', (confidence*100).toFixed(0) + '%');
      return { transcript, detectedLanguage, confidence };
    }
    
    // No results found
    console.log('⚠️ No speech detected in audio');
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
        max_tokens: 200,  // Keep responses short for phone
        temperature: 0.7,
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

// Build system prompt from business info
function buildSystemPrompt(state: ConversationState): string {
  const { businessInfo, customerName } = state;
  
  return `אתה נציג טלפוני מקצועי ואדיב של ${businessInfo.name}.

## כללים קריטיים:
1. לעולם אל תאמר "בתור עוזר AI", "כמודל שפה", "אני בינה מלאכותית" או משפטים דומים
2. הזדהה תמיד כנציג אנושי של ${businessInfo.name}
3. ${customerName ? `שם הלקוח: ${customerName} - השתמש בשם שלו בטבעיות` : 'שאל בנימוס את שם הלקוח אם טרם הזדהה'}
4. ענה בצורה קצרה וידידותית - זו שיחת טלפון! מקסימום 2-3 משפטים
5. אם הלקוח שואל משהו שאתה לא יודע - הצע שנציג יחזור אליו
6. דבר בעברית טבעית ורהוטה, כמו ישראלי אמיתי
7. אל תשתמש בסמיילים או סימנים מיוחדים

## על העסק:
${businessInfo.name}
${businessInfo.phoneNumber ? `טלפון: ${businessInfo.phoneNumber}` : ''}

## השירותים שלנו:
${businessInfo.services || 'שירותים מקצועיים ללקוחותינו'}

## שאלות נפוצות:
${businessInfo.faq || 'אנחנו כאן לעזור בכל שאלה'}

## הנחיות נוספות מהעסק:
${businessInfo.customPrompt || 'שים דגש על שירות לקוחות מעולה'}

## היסטוריית השיחה:
${state.customerTopic ? `הלקוח מתעניין ב: ${state.customerTopic}` : ''}
${state.customerRequests.length > 0 ? `בקשות נוספות: ${state.customerRequests.join(', ')}` : ''}
תור מספר: ${state.turnCount + 1}`;
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
      // Return a generic friendly response
      return 'שלום! איך אוכל לעזור לך היום?';
    }
  }
  
  return response;
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
      name: voiceGender === 'FEMALE' ? 'he-IL-Wavenet-A' : 'he-IL-Wavenet-B' 
    };
  }
  
  const lang = detectedLanguage.toLowerCase();
  
  if (lang.startsWith('en')) {
    return { 
      languageCode: 'en-US', 
      name: voiceGender === 'FEMALE' ? 'en-US-Wavenet-F' : 'en-US-Wavenet-D' 
    };
  } else if (lang.startsWith('ar')) {
    return { 
      languageCode: 'ar-XA', 
      name: voiceGender === 'FEMALE' ? 'ar-XA-Wavenet-A' : 'ar-XA-Wavenet-B' 
    };
  } else {
    return { 
      languageCode: 'he-IL', 
      name: voiceGender === 'FEMALE' ? 'he-IL-Wavenet-A' : 'he-IL-Wavenet-B' 
    };
  }
}

// ===== UPGRADED: Enhanced SSML for more natural speech =====
function buildEnhancedSSML(text: string): string {
  let ssmlText = text
    // Better pauses after punctuation
    .replace(/\./g, '.<break time="380ms"/>')
    .replace(/,/g, ',<break time="200ms"/>')
    .replace(/\?/g, '?<break time="480ms"/>')
    .replace(/!/g, '!<break time="350ms"/>')
    .replace(/:/g, ':<break time="250ms"/>')
    // Emphasis on question words (Hebrew)
    .replace(/(מה|איך|למה|מתי|איפה|מי|האם|כמה)/g, '<emphasis level="moderate">$1</emphasis>')
    // Handle business names in English
    .replace(/\b(LINKON|CRM|API|SMS)\b/gi, '<say-as interpret-as="characters">$1</say-as>')
    // Numbers as ordinal/cardinal
    .replace(/(\d+)/g, '<say-as interpret-as="cardinal">$1</say-as>');
  
  return `<speak>
    <prosody rate="0.95" pitch="-1st">
      ${ssmlText}
    </prosody>
  </speak>`;
}

// Synthesize speech using Google TTS with enhanced SSML
async function synthesizeSpeech(
  text: string,
  accessToken: string,
  voiceGender: 'FEMALE' | 'MALE' = 'FEMALE',
  detectedLanguage: string = 'he-IL',
  sttConfidence: number = 1.0
): Promise<string> {
  console.log('🔊 Synthesizing speech in', detectedLanguage, ':', text);
  
  const voiceConfig = getVoiceForLanguage(detectedLanguage, voiceGender, sttConfidence);
  console.log('🎤 Using voice:', voiceConfig.name, '| STT confidence:', (sttConfidence*100).toFixed(0) + '%');
  
  // Use v1beta1 for Studio voices (Chirp 3 - highest quality)
  const ttsUrl = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
  
  // Enhanced SSML for natural speech
  const ssmlText = buildEnhancedSSML(text);
  
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
        input: { text },  // Use plain text for fallback
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
    // Combine all audio chunks
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
    
    // Convert to base64
    const mulawBase64 = btoa(String.fromCharCode(...combinedMulaw));
    
    // Refresh token if needed
    if (!accessToken) {
      accessToken = await getAccessToken(state.credentials);
    }
    
    // Transcribe with Chirp 2 + phrase hints
    const { transcript, detectedLanguage, confidence } = await transcribeAudio(
      mulawBase64, 
      accessToken, 
      state.projectId,
      state.language === 'he' ? 'he-IL' : state.language === 'ar' ? 'ar-XA' : 'en-US',
      state.phraseHints
    );
    console.log('📝 Transcript:', transcript, '| Language:', detectedLanguage, '| Confidence:', (confidence*100).toFixed(0) + '%');
    
    // Store confidence in state
    state.sttConfidence = confidence;
    
    if (transcript) {
      // Update detected language
      state.detectedLanguage = detectedLanguage;
      
      // Add user message to history
      state.conversationHistory.push({
        role: 'user',
        text: transcript,
        timestamp: Date.now()
      });
      state.turnCount++;
      
      // Get AI response using Lovable AI (replaces Dialogflow)
      const result = await getAIResponse(transcript, state);
      
      // Update customer info
      if (result.extractedName && !state.customerName) {
        state.customerName = result.extractedName;
        console.log('📛 Customer identified:', state.customerName);
      }
      if (result.extractedPhone && !state.customerPhone) {
        state.customerPhone = result.extractedPhone;
        console.log('📞 Phone captured:', state.customerPhone);
      }
      if (result.extractedTopic) {
        if (!state.customerTopic) {
          state.customerTopic = result.extractedTopic;
        }
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
      
      // Mark agent as speaking
      state.isAgentSpeaking = true;
      
      // Synthesize and send response
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

// Build phrase hints from business data
function buildPhraseHints(profile: any, script: any): string[] {
  const hints: string[] = [
    // Common business terms
    'פגישה',
    'תור',
    'הזמנה',
    'מחיר',
    'שירות',
    'יועץ',
    'ייעוץ',
  ];
  
  // Add business name if available
  if (profile?.business_name) {
    hints.push(profile.business_name);
  }
  
  // Add service names from script
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
  
  // Add custom terms from script if defined
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
  
  console.log('📢 Phrase hints:', hints);
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
    
    // VAD-based endpoint detection constants
    const END_OF_UTTERANCE_SILENCE_MS = 1200;
    const MAX_UTTERANCE_MS = 12000;
    const MIN_SPEECH_MS = 300;
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
            
            // Initialize state from custom parameters
            const params = message.start?.customParameters || {};
            const userId = params.userId || '';
            const agentId = params.agentId || '';
            const callSid = message.start?.callSid || '';
            const streamSid = message.start?.streamSid || '';
            
            console.log('Stream params:', { userId, agentId, callSid, streamSid });
            
            // Get Supabase client
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
            
            // Build business info for AI prompting
            const businessInfo: BusinessInfo = {
              name: profile?.business_name || 'העסק',
              services: script?.services ? JSON.stringify(script.services) : '',
              faq: script?.faq ? JSON.stringify(script.faq) : '',
              customPrompt: script?.custom_prompt || '',
              phoneNumber: profile?.phone_number || '',
            };
            
            // Build phrase hints for STT
            const phraseHints = buildPhraseHints(profile, script);
            
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
              // VAD state
              isUserSpeaking: false,
              lastVoiceTime: 0,
              speechStartTime: null,
              noiseFloor: 500,
              noiseFloorSamples: 0,
              totalBufferBytes: 0,
              // Multi-language detection
              detectedLanguage: script?.language === 'he' ? 'he-IL' : script?.language === 'ar' ? 'ar-XA' : 'en-US',
              voiceGender: 'FEMALE',
              sttConfidence: 1.0,
              // Business info
              businessInfo,
              phraseHints,
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
                
                state.audioBuffer = [audioBytes];
                state.totalBufferBytes = audioBytes.length;
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
                    state.audioBuffer = [];
                    state.totalBufferBytes = 0;
                    console.log('🟢 Utterance START - Energy:', vad.energy.toFixed(0));
                  }
                }
                
                // Buffer audio
                if (state.isUserSpeaking || state.audioBuffer.length > 0) {
                  state.audioBuffer.push(audioBytes);
                  state.totalBufferBytes += audioBytes.length;
                  state.lastAudioTime = now;
                }
                
                // END OF UTTERANCE detection
                if (state.isUserSpeaking && state.lastVoiceTime > 0) {
                  const silenceDuration = now - state.lastVoiceTime;
                  const speechDuration = state.speechStartTime ? now - state.speechStartTime : 0;
                  
                  const hasEnoughSilence = silenceDuration >= END_OF_UTTERANCE_SILENCE_MS;
                  const hasMinSpeechDuration = speechDuration >= MIN_SPEECH_MS;
                  const hasEnoughAudio = state.totalBufferBytes >= MIN_AUDIO_BYTES;
                  const isMaxDuration = speechDuration >= MAX_UTTERANCE_MS;
                  
                  if ((hasEnoughSilence && hasMinSpeechDuration && hasEnoughAudio) || isMaxDuration) {
                    console.log('🟡 Utterance END - Silence:', silenceDuration, 'ms, Duration:', speechDuration, 'ms');
                    
                    state.isUserSpeaking = false;
                    state.speechStartTime = null;
                    
                    await processAudioBuffer(state, accessToken!, socket);
                  }
                }
                
                // Discard silent buffers
                if (!state.isUserSpeaking && state.audioBuffer.length > 0) {
                  const timeSinceLastAudio = now - state.lastAudioTime;
                  if (timeSinceLastAudio > END_OF_UTTERANCE_SILENCE_MS) {
                    console.log('🗑️ Discarding silent buffer');
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
              state.lastTTSEndTime = Date.now();
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
      features: [
        'Chirp 2 STT (V2 API)',
        'Lovable AI (Gemini 2.5 Flash)',
        'Enhanced SSML TTS',
        'Phrase Hints',
        'VAD-based Endpointing',
        'Barge-in Support'
      ],
    }),
    { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
