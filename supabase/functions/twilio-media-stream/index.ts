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
    // noiseFloor * 6 instead of * 4 = less sensitive to noise spikes
    const VOICE_THRESHOLD_MULTIPLIER = 6;  // Increased from 4 to reduce false positives
    const MIN_VOICE_ENERGY = 2500;         // Increased from 1500 to filter phone line noise
    
    const threshold = Math.max(noiseFloor * VOICE_THRESHOLD_MULTIPLIER, MIN_VOICE_ENERGY);
    const hasVoice = rms > threshold;
    
    return { hasVoice, energy: rms };
  } catch {
    return { hasVoice: false, energy: 0 };
  }
}

// Calculate energy of a single audio chunk for trimming
function calculateChunkEnergy(chunk: Uint8Array): number {
  let sumSquares = 0;
  for (let i = 0; i < chunk.length; i++) {
    const linear16Sample = MULAW_DECODE_TABLE[chunk[i]];
    sumSquares += linear16Sample * linear16Sample;
  }
  return Math.sqrt(sumSquares / chunk.length);
}

// Trim silence from beginning and end of audio buffer
function trimSilenceFromAudio(audioBuffer: Uint8Array[], noiseFloor: number): Uint8Array[] {
  if (audioBuffer.length === 0) return audioBuffer;
  
  // Threshold for speech detection during trimming
  const ENERGY_THRESHOLD = Math.max(noiseFloor * 5, 2000);
  
  // Find where speech starts (skip leading silence)
  let startIndex = 0;
  for (let i = 0; i < audioBuffer.length; i++) {
    const energy = calculateChunkEnergy(audioBuffer[i]);
    if (energy > ENERGY_THRESHOLD) {
      startIndex = Math.max(0, i - 2); // Keep 2 chunks before for context
      break;
    }
  }
  
  // Find where speech ends (trim trailing silence)
  let endIndex = audioBuffer.length - 1;
  for (let i = audioBuffer.length - 1; i >= startIndex; i--) {
    const energy = calculateChunkEnergy(audioBuffer[i]);
    if (energy > ENERGY_THRESHOLD) {
      endIndex = Math.min(audioBuffer.length - 1, i + 3); // Keep 3 chunks after
      break;
    }
  }
  
  const originalLength = audioBuffer.length;
  const trimmedBuffer = audioBuffer.slice(startIndex, endIndex + 1);
  
  if (trimmedBuffer.length < originalLength) {
    console.log(`✂️ Trimmed audio: ${startIndex}-${endIndex} of ${originalLength} chunks (removed ${originalLength - trimmedBuffer.length} silence chunks)`);
  }
  
  return trimmedBuffer;
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
  console.log('🎤 Transcribing with V1 default model (Hebrew supported), audio length:', mulawAudioBase64.length);
  
  // Use stable V1 API with default model (phone_call doesn't support Hebrew)
  const sttUrl = 'https://speech.googleapis.com/v1/speech:recognize';
  
  // Build speech contexts for better business term recognition
  const speechContexts = phraseHints.length > 0 ? [{
    phrases: phraseHints.slice(0, 500), // Max 500 phrases
    boost: 15
  }] : [];
  
  // Build config with enhanced model for English only
  // Add alternative languages for automatic detection of Hebrew, Arabic, and English
  const alternativeLanguages = ['he-IL', 'ar-XA', 'en-US'].filter(l => l !== primaryLanguage);
  
  const config: any = {
    encoding: 'MULAW',
    sampleRateHertz: 8000,
    languageCode: primaryLanguage,
    alternativeLanguageCodes: alternativeLanguages, // Enables Arabic and English detection!
    enableAutomaticPunctuation: true,
    profanityFilter: false,
  };
  
  console.log('🌍 STT languages: primary', primaryLanguage, '| alternatives:', alternativeLanguages.join(', '));
  
  // Use enhanced telephony model only for English (phone_call doesn't support Hebrew/Arabic)
  if (primaryLanguage === 'en-US') {
    config.model = 'phone_call';
    config.useEnhanced = true;
    console.log('📞 Using enhanced phone_call model for English');
  }
  
  const requestBody: any = {
    config,
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
// Supports Hebrew, Arabic, and English based on detected customer language
// Supports both male and female agent voices with appropriate grammar
function buildSystemPrompt(state: ConversationState): string {
  const { businessInfo, customerName, voiceGender, detectedLanguage } = state;
  
  // Agent's own gender - affects how the agent refers to itself
  const isAgentFemale = voiceGender === 'FEMALE';
  
  // Detect customer language for response matching
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
❌ لا: "انا سعيد جدا لمساعدتك اليوم في اي سؤال"
✅ نعم: "اهلا! كيف ممكن اساعدك؟"

❌ لا: "سأقوم بفحص المواعيد المتاحة لك"
✅ نعم: "طيب لحظة ابص. امتى فاضي؟"

## قوانين:
1. أبدا لا تقول انك AI/ذكاء اصطناعي
2. ${customerName ? `اسم الزبون: ${customerName}. استخدم الاسم بطبيعية` : 'اسأل عن الاسم اذا ما قال'}
3. ردود قصيرة! هاي مكالمة تلفون مش ايميل
4. ${isAgentFemale ? 'ما بتعرفي' : 'ما بتعرف'} شي؟ "خليني اتأكد وبرجعلك" - وبس
5. بدون ايموجي

## عن المصلحة:
${businessInfo.name}
${businessInfo.phoneNumber ? `تلفون: ${businessInfo.phoneNumber}` : ''}
${businessInfo.services ? `خدمات: ${businessInfo.services}` : ''}

${businessInfo.faq ? `## أسئلة شائعة:\n${businessInfo.faq}` : ''}

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
  
  // Customer's gender - affects how agent addresses the customer
  const customerGenderContext = state.detectedGender === 'male' 
    ? 'הלקוח גבר - פני אליו בלשון זכר (תשמע, אתה, לך)' 
    : state.detectedGender === 'female'
    ? 'הלקוחה אישה - פני אליה בלשון נקבה (תשמעי, את, לך)'
    : 'לא ברור מגדר הלקוח - השתמשי בניסוח ניטרלי עד שיתברר';
  
  return `${agentRole} ${businessInfo.name}. ${agentSpeakStyle}

## סגנון הדיבור שלך:
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
  // Hebrew fillers - contextual based on situation
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
  
  // Don't add fillers to very short responses or greetings
  if (response.length < 20 || turnCount === 0) {
    return response;
  }
  
  // Skip if response already starts with a filler
  const allFillers = [...hebrewFillers.thinking, ...hebrewFillers.confirming, 
                      ...arabicFillers.thinking, ...englishFillers.thinking];
  const startsWithFiller = allFillers.some(f => 
    response.startsWith(f.replace('...', '').replace(',', ''))
  );
  if (startsWithFiller) {
    return response;
  }
  
  // Choose filler based on response content and language
  const lang = detectedLanguage?.toLowerCase() || 'he';
  let fillers: string[];
  
  if (lang.startsWith('ar')) {
    // Arabic
    if (response.includes('؟') || response.includes('?')) {
      fillers = arabicFillers.thinking;
    } else {
      fillers = [...arabicFillers.confirming, ...arabicFillers.responding];
    }
  } else if (lang.startsWith('en')) {
    // English
    if (response.includes('?')) {
      fillers = englishFillers.thinking;
    } else {
      fillers = [...englishFillers.confirming, ...englishFillers.responding];
    }
  } else {
    // Hebrew (default)
    if (response.includes('?') || response.includes('?')) {
      fillers = hebrewFillers.thinking;
    } else if (response.startsWith('כן') || response.startsWith('בטח') || response.startsWith('לא')) {
      // Already has a natural start
      return response;
    } else {
      // Mix of confirming and transitioning based on turn count
      fillers = turnCount % 2 === 0 
        ? hebrewFillers.confirming 
        : hebrewFillers.transitioning;
    }
  }
  
  // Random selection (30% chance to add filler for naturalness)
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

// Get voice configuration based on detected language - using Chirp 3 HD (best quality)
function getVoiceForLanguage(
  detectedLanguage: string, 
  voiceGender: 'FEMALE' | 'MALE',
  sttConfidence: number = 1.0
): { languageCode: string; name: string } {
  
  // Chirp 3 HD voices - Google's highest quality multilingual voices
  const chirp3Voices = {
    hebrew: {
      FEMALE: 'he-IL-Chirp3-HD-Aoede',   // Warm, natural female
      MALE: 'he-IL-Chirp3-HD-Charon'     // Deep, professional male
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
  
  // Fallback to Wavenet if Chirp 3 HD not available
  const wavenetFallback = {
    hebrew: { FEMALE: 'he-IL-Wavenet-A', MALE: 'he-IL-Wavenet-D' },
    arabic: { FEMALE: 'ar-XA-Wavenet-A', MALE: 'ar-XA-Wavenet-B' },
    english: { FEMALE: 'en-US-Wavenet-F', MALE: 'en-US-Wavenet-D' }
  };
  
  // If low confidence - always use Hebrew voice
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

// ===== Hebrew Pronunciation Fixes =====
// Map problematic words to their nikud (vocalized) versions for better TTS pronunciation
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

// Fix Hebrew pronunciation before sending to TTS
function fixHebrewPronunciation(text: string): string {
  let fixedText = text;
  for (const [word, nikud] of Object.entries(hebrewPronunciationFixes)) {
    // Replace whole words only (not partial matches)
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    fixedText = fixedText.replace(regex, nikud);
  }
  if (fixedText !== text) {
    console.log('🔤 Pronunciation fixes applied:', text, '→', fixedText);
  }
  return fixedText;
}

// ===== SIMPLIFIED: Plain text for TTS to avoid SSML parsing issues =====
// Removed complex SSML that was being read as text ("480 milliseconds")
function buildSimpleSSML(text: string): string {
  // Just wrap in speak tags with basic prosody - no complex breaks
  return `<speak><prosody rate="0.95">${text}</prosody></speak>`;
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
  
  // Apply Hebrew pronunciation fixes for better TTS output
  const isHebrew = detectedLanguage === 'he-IL' || detectedLanguage.startsWith('he');
  const processedText = isHebrew ? fixHebrewPronunciation(text) : text;
  
  const voiceConfig = getVoiceForLanguage(detectedLanguage, voiceGender, sttConfidence);
  console.log('🎤 Using voice:', voiceConfig.name, '| STT confidence:', (sttConfidence*100).toFixed(0) + '%');
  
  // Use v1 API with plain text - more reliable than v1beta1 with SSML
  const ttsUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  
  console.log('📝 TTS input text:', processedText);
  
  const response = await fetch(ttsUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text: processedText },  // Use pronunciation-fixed text
      voice: {
        languageCode: voiceConfig.languageCode,
        name: voiceConfig.name,
      },
      audioConfig: {
        audioEncoding: 'MULAW',
        sampleRateHertz: 8000,
        effectsProfileId: ['telephony-class-application'],
        speakingRate: 1.0,   // Natural rate for Chirp 3 HD
        // NOTE: No pitch parameter - Chirp3-HD doesn't support it!
      },
    }),
  });

  const data = await response.json();
  
  // Fallback to Wavenet if Chirp 3 HD not available
  if (data.error) {
    console.log('⚠️ Chirp3-HD unavailable, trying Wavenet fallback:', data.error.message);
    
    // Wavenet fallback mapping
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
        input: { text: processedText },  // Use pronunciation-fixed text in fallback too
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
    if (fallbackData.audioContent) {
      console.log('✅ Wavenet fallback succeeded');
      return fallbackData.audioContent;
    } else {
      console.error('❌ Fallback also failed:', fallbackData.error);
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
): boolean {
  // Check WebSocket state before sending
  if (socket.readyState !== WebSocket.OPEN) {
    console.error('❌ WebSocket not open, state:', socket.readyState, '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');
    return false;
  }
  
  const chunkSize = 160; // 160 bytes = 20ms at 8kHz MULAW
  const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  
  console.log('🔊 Sending TTS audio to Twilio, total bytes:', audioBytes.length, 'WebSocket state: OPEN');
  
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
  
  // Send mark to know when audio finished playing
  socket.send(JSON.stringify({
    event: 'mark',
    streamSid: streamSid,
    mark: { name: 'audio_complete' },
  }));
  
  return true;
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
    // Use full audio buffer (no trimming - was causing STT failures)
    const audioBuffer = state.audioBuffer;
    
    // Calculate total bytes
    let totalBytes = 0;
    for (const chunk of audioBuffer) {
      totalBytes += chunk.length;
    }
    
    // Combine audio chunks
    const combinedMulaw = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of audioBuffer) {
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
      // OPTIMIZED: Lower confidence threshold with smart validation
      // Only reject if BOTH confidence is very low AND transcript is very short
      const hebrewWords = /[א-ת]{2,}/g;
      const hebrewMatches = transcript.match(hebrewWords);
      const hasHebrewContent = hebrewMatches !== null && hebrewMatches.length >= 1;
      
      // Accept if Hebrew content detected, even with lower confidence
      if (!hasHebrewContent && confidence < 0.30 && transcript.length < 6) {
        console.log('⚠️ Ignoring very low confidence short transcript:', transcript, '| Confidence:', (confidence*100).toFixed(0) + '%');
        return;
      }
      
      // OPTIMIZED: Shorter grace period after greeting (1200ms instead of 2000ms)
      const GREETING_GRACE_PERIOD_MS = 1200;
      if (state.greetingSentAt > 0 && Date.now() - state.greetingSentAt < GREETING_GRACE_PERIOD_MS) {
        console.log('⏳ In greeting grace period, ignoring transcript:', transcript);
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
      
      // Save transcript and customer info to database
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // Format transcript entry
        const transcriptEntry = {
          role: 'user' as const,
          text: transcript,
          timestamp: Date.now()
        };
        const agentEntry = {
          role: 'agent' as const, 
          text: result.response,
          timestamp: Date.now()
        };
        
        // Find any non-completed call for this user (handles status variations)
        const { error: updateError } = await supabase.from('calls')
          .update({ 
            transcript: state.conversationHistory,
            customer_name: state.customerName,
            customer_topic: state.customerTopic,
          })
          .eq('user_id', state.userId)
          .neq('status', 'completed')  // Match any non-completed status
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (updateError) {
          console.error('❌ Database update failed:', updateError.message);
        } else {
          console.log('💾 Saved transcript to database - history:', state.conversationHistory.length, 'entries');
        }
      } catch (dbErr) {
        console.error('⚠️ Error saving transcript:', dbErr);
      }
      
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
      // Reset failure counter on successful transcription
      state.consecutiveSTTFailures = 0;
    } else {
      console.log('⚠️ No transcript returned from STT');
      
      // Track consecutive failures and send fallback prompt
      state.consecutiveSTTFailures++;
      console.log('📊 Consecutive STT failures:', state.consecutiveSTTFailures);
      
      if (state.consecutiveSTTFailures >= 2 && !state.isAgentSpeaking) {
        console.log('🔄 Sending fallback prompt due to STT failures');
        
        // Choose fallback prompt based on language
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
        
        // Reset counter after sending fallback
        state.consecutiveSTTFailures = 0;
      }
    }
  } catch (err) {
    console.error('❌ Error processing audio:', err);
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
    
    // VAD-based endpoint detection constants - OPTIMIZED for low latency
    const END_OF_UTTERANCE_SILENCE_MS = 800;   // Reduced from 1200ms for faster response
    const MAX_UTTERANCE_MS = 12000;             // Max utterance length
    const MIN_SPEECH_MS = 500;                  // Filter short bursts
    const MIN_AUDIO_BYTES = 2000;               // Require enough audio data
    
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
              // Echo suppression - OPTIMIZED for faster responses
              lastTTSEndTime: 0,
              echoGracePeriodMs: 500,  // Reduced from 800ms
              // VAD state
              isUserSpeaking: false,
              lastVoiceTime: 0,
              speechStartTime: null,
              noiseFloor: 500,
              noiseFloorSamples: 0,
              totalBufferBytes: 0,
              // Multi-language detection
              detectedLanguage: script?.language === 'he' ? 'he-IL' : script?.language === 'ar' ? 'ar-XA' : 'en-US',
              // Load voice gender from script settings (default to FEMALE)
              voiceGender: script?.agent_voice_gender === 'male' ? 'MALE' : 'FEMALE',
              sttConfidence: 1.0,
              // Gender detection (neutral until detected)
              detectedGender: null,
              // Grace period for listening after greeting
              greetingSentAt: 0,
              // Business info
              businessInfo,
              phraseHints,
              // STT failure tracking
              consecutiveSTTFailures: 0,
            };
            
            // OPTIMIZED: Send greeting much faster (300ms instead of 1000ms)
            if (accessToken && state) {
              const greetingState = state;
              const greetingToken = accessToken;
              
              // Pre-synthesize greeting immediately (don't wait for setTimeout)
              synthesizeSpeech(greetingState.greeting, greetingToken, greetingState.voiceGender)
                .then(greetingAudio => {
                  // Send after brief delay for WebSocket to stabilize
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
                        console.log('✅ Greeting sent successfully (optimized)');
                      }
                    } catch (err) {
                      console.error('Error sending greeting:', err);
                      greetingState.isAgentSpeaking = false;
                    }
                  }, 300); // OPTIMIZED: 300ms instead of 1000ms
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
            
            // Generate call summary and finalize call record
            if (state && state.conversationHistory.length > 0) {
              try {
                const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
                const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                const supabase = createClient(supabaseUrl, supabaseKey);
                
                // Generate AI summary of the call
                const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
                let callSummary = '';
                
                console.log('📊 Call stats - History:', state.conversationHistory.length, 'messages, API key:', lovableApiKey ? 'present' : 'missing');
                
                // Generate summary if we have at least 1 message (even short calls deserve summaries)
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
                
                // Calculate call duration
                const callDuration = state.conversationHistory.length > 0
                  ? Math.floor((Date.now() - state.conversationHistory[0].timestamp) / 1000)
                  : 0;
                
                // Update call record with final data - match any non-completed status
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
                  .neq('status', 'completed')  // Match any non-completed status
                  .order('created_at', { ascending: false })
                  .limit(1);
                
                if (finalError) {
                  console.error('❌ Failed to finalize call:', finalError.message);
                } else {
                  console.log('✅ Call finalized - Duration:', callDuration, 's, Turns:', state.turnCount, ', Summary:', callSummary ? 'Yes' : 'No');
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
      message: 'Twilio Media Stream WebSocket Handler - MAXIMUM QUALITY',
      usage: 'Connect via WebSocket for real-time audio streaming',
      version: '2.0',
      features: [
        'Google STT V1 (phone_call for English)',
        'Lovable AI (Gemini 3 Flash Preview)',
        'Studio/Neural2 TTS Voices (Highest Quality)',
        'Enhanced SSML with prosody',
        'Phrase Hints for business terms',
        'VAD-based Endpointing',
        'Barge-in Support',
        'Full Transcript Saving',
        'AI Call Summarization',
        'Customer Info Extraction'
      ],
    }),
    { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
