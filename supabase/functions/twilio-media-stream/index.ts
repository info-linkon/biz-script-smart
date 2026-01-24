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
  audioBuffer: string[];
  isProcessing: boolean;
  silenceStart: number | null;
  lastAudioTime: number;
  credentials: any;
  projectId: string;
  greeting: string;
  language: string;
  // Barge-in support
  isAgentSpeaking: boolean;
  interruptedText: string | null;
  vadHistory: number[]; // Track recent audio energy for voice detection
  // Conversation context for memory
  conversationHistory: { role: 'user' | 'agent'; text: string; timestamp: number }[];
  customerName: string | null;
  customerPhone: string | null;
  turnCount: number;
  // Echo suppression
  lastTTSEndTime: number; // When TTS finished sending
  echoGracePeriodMs: number; // ms to ignore audio after TTS (prevents echo detection)
}

// Voice Activity Detection - detect if audio contains speech
function detectVoiceActivity(audioPayload: string): { hasVoice: boolean; energy: number } {
  try {
    const audioBytes = Uint8Array.from(atob(audioPayload), c => c.charCodeAt(0));
    
    // Calculate RMS energy of the audio samples
    let sumSquares = 0;
    for (let i = 0; i < audioBytes.length; i++) {
      // Mulaw samples are centered around 127-128, convert to signed
      const sample = audioBytes[i] - 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / audioBytes.length);
    
    // Threshold for voice detection (tuned for telephony audio)
    const VOICE_THRESHOLD = 15; // Adjust based on testing
    const hasVoice = rms > VOICE_THRESHOLD;
    
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

// Perform speech-to-text using Google Cloud
async function transcribeAudio(
  audioBase64: string, 
  accessToken: string, 
  projectId: string
): Promise<string | null> {
  console.log('Transcribing audio, length:', audioBase64.length);
  
  const sttUrl = `https://speech.googleapis.com/v1/speech:recognize`;
  
  const response = await fetch(sttUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 8000,
        languageCode: 'he-IL',
        model: 'telephony_short',
        useEnhanced: true,
      },
      audio: {
        content: audioBase64,
      },
    }),
  });

  const data = await response.json();
  console.log('STT response:', JSON.stringify(data));

  if (data.results && data.results[0]?.alternatives?.[0]?.transcript) {
    return data.results[0].alternatives[0].transcript;
  }
  
  return null;
}

// Query Dialogflow CX with context
async function queryDialogflow(
  text: string,
  sessionId: string,
  agentId: string,
  accessToken: string,
  projectId: string,
  conversationHistory: { role: string; text: string }[] = [],
  customerName: string | null = null
): Promise<{ response: string; extractedName?: string; extractedPhone?: string }> {
  console.log('Querying Dialogflow with:', text);
  
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
        languageCode: 'he',
      },
      queryParams: {
        parameters: queryParams
      }
    }),
  });

  const data = await response.json();
  console.log('Dialogflow response:', JSON.stringify(data));

  // Extract customer name from response if mentioned
  let extractedName: string | undefined;
  let extractedPhone: string | undefined;
  
  // Check for name extraction from introduction patterns
  const namePatterns = [
    /(?:אני|שמי|קוראים לי)\s+([א-ת]+)/,
    /^([א-ת]+)\s+(?:פה|כאן|מדבר)/
  ];
  
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      extractedName = match[1];
      console.log('Extracted customer name:', extractedName);
      break;
    }
  }
  
  // Check for phone number
  const phonePattern = /(\d{9,10}|0\d{1,2}[-\s]?\d{7})/;
  const phoneMatch = text.match(phonePattern);
  if (phoneMatch) {
    extractedPhone = phoneMatch[1].replace(/[-\s]/g, '');
    console.log('Extracted phone:', extractedPhone);
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
  
  // Personalize response with customer name if available
  if (extractedName && !customerName) {
    // First time we learn the name - already handled by intent
  } else if (customerName && responseText.includes('לקוח')) {
    // Replace generic 'לקוח' with actual name
    responseText = responseText.replace(/לקוח/g, customerName);
  }
  
  return { response: responseText, extractedName, extractedPhone };
}

// Synthesize speech using Google TTS with Studio/Journey voices (Chirp 3)
async function synthesizeSpeech(
  text: string,
  accessToken: string,
  voiceGender: 'FEMALE' | 'MALE' = 'FEMALE'
): Promise<string> {
  console.log('Synthesizing speech:', text);
  
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
        // Studio voices (Chirp 3) - highest quality, most natural
        languageCode: 'he-IL',
        name: voiceGender === 'FEMALE' ? 'he-IL-Studio-A' : 'he-IL-Studio-B',
      },
      audioConfig: {
        audioEncoding: 'MULAW',
        sampleRateHertz: 8000,
        // Enhanced audio profile for telephony
        effectsProfileId: ['telephony-class-application'],
        // Slightly slower for clarity
        speakingRate: 0.95,
      },
    }),
  });

  const data = await response.json();
  
  // Fallback to Wavenet if Studio not available
  if (data.error) {
    console.log('Studio voice not available, falling back to Wavenet:', data.error.message);
    
    const fallbackResponse = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: 'he-IL',
          name: 'he-IL-Wavenet-A',
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
  // Split audio into chunks (Twilio expects 20ms chunks = 160 samples at 8kHz)
  const chunkSize = 160 * 2; // 160 samples * 2 bytes per sample for mulaw encoding consideration
  const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  
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
    const SILENCE_THRESHOLD_MS = 1500; // 1.5 seconds of silence triggers processing
    let silenceTimer: number | null = null;
    
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
              silenceStart: null,
              lastAudioTime: Date.now(),
              credentials,
              projectId,
              greeting: script?.greeting_message || 'שלום, איך אוכל לעזור?',
              language: script?.language || 'he',
              // Barge-in support
              isAgentSpeaking: false,
              interruptedText: null,
              vadHistory: [],
              // Conversation context
              conversationHistory: [],
              customerName: null,
              customerPhone: null,
              turnCount: 0,
              // Echo suppression - prevent detecting TTS audio as user speech
              lastTTSEndTime: 0,
              echoGracePeriodMs: 800, // 800ms grace period after TTS ends
            };
            
            // Send initial greeting
            if (accessToken && state) {
              try {
                state.isAgentSpeaking = true;
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
            
            // Collect audio chunks
            if (message.media?.payload) {
              // Check for voice activity (for barge-in detection)
              const vad = detectVoiceActivity(message.media.payload);
              
              // Keep rolling window of VAD history (last 5 chunks ~100ms)
              state.vadHistory.push(vad.energy);
              if (state.vadHistory.length > 5) {
                state.vadHistory.shift();
              }
              
              // Calculate average energy over recent history
              const avgEnergy = state.vadHistory.reduce((a, b) => a + b, 0) / state.vadHistory.length;
              const hasConsistentVoice = avgEnergy > 15 && state.vadHistory.length >= 4; // Higher threshold, more samples
              
              // Echo suppression: Check if we're still in the grace period after TTS
              const timeSinceTTS = Date.now() - state.lastTTSEndTime;
              const isInEchoGracePeriod = timeSinceTTS < state.echoGracePeriodMs;
              
              // BARGE-IN: If agent is speaking and user starts talking (not echo)
              if (state.isAgentSpeaking && hasConsistentVoice && !state.isProcessing && !isInEchoGracePeriod) {
                console.log('🎤 Barge-in detected! User interrupted agent. Energy:', avgEnergy.toFixed(1), 'TimeSinceTTS:', timeSinceTTS);
                
                // Stop agent audio immediately
                clearTwilioAudio(socket, state.streamSid);
                state.isAgentSpeaking = false;
                state.lastTTSEndTime = Date.now(); // Reset to prevent immediate re-trigger
                
                // Clear any pending silence timer
                if (silenceTimer) {
                  clearTimeout(silenceTimer);
                  silenceTimer = null;
                }
                
                // Reset audio buffer to capture the interruption
                state.audioBuffer = [];
                state.vadHistory = [];
              }
              
              // Only buffer audio when agent is not speaking (or after barge-in)
              if (!state.isAgentSpeaking) {
                state.audioBuffer.push(message.media.payload);
                state.lastAudioTime = Date.now();
                
                // Reset silence detection
                if (silenceTimer) {
                  clearTimeout(silenceTimer);
                }
                
                // Start silence detection - process after silence
                silenceTimer = setTimeout(async () => {
                  if (!state || state.isProcessing || state.audioBuffer.length === 0) return;
                  
                  state.isProcessing = true;
                  console.log('Processing audio buffer, chunks:', state.audioBuffer.length);
                  
                  try {
                    // Combine all audio chunks
                    const combinedAudio = state.audioBuffer.join('');
                    state.audioBuffer = [];
                    
                    // Decode mulaw and convert to linear16
                    const mulawBytes = Uint8Array.from(atob(combinedAudio), c => c.charCodeAt(0));
                    const linear16 = mulawToLinear16(mulawBytes);
                    const linear16Bytes = new Uint8Array(linear16.buffer);
                    const linear16Base64 = btoa(String.fromCharCode(...linear16Bytes));
                    
                    // Refresh token if needed
                    if (!accessToken) {
                      accessToken = await getAccessToken(state.credentials);
                    }
                    
                    // Transcribe
                    const transcript = await transcribeAudio(linear16Base64, accessToken, state.projectId);
                    console.log('Transcript:', transcript);
                    
                    if (transcript) {
                      // Add user message to conversation history
                      state.conversationHistory.push({
                        role: 'user',
                        text: transcript,
                        timestamp: Date.now()
                      });
                      state.turnCount++;
                      
                      // Query Dialogflow with context
                      const result = await queryDialogflow(
                        transcript,
                        state.sessionId,
                        state.agentId,
                        accessToken,
                        state.projectId,
                        state.conversationHistory,
                        state.customerName
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
                      
                      // Add agent response to history
                      state.conversationHistory.push({
                        role: 'agent',
                        text: result.response,
                        timestamp: Date.now()
                      });
                      
                      console.log('Agent response:', result.response);
                      
                      // Mark agent as speaking before sending audio
                      state.isAgentSpeaking = true;
                      state.vadHistory = []; // Reset VAD for barge-in detection
                      
                      // Synthesize and send response
                      const responseAudio = await synthesizeSpeech(result.response, accessToken);
                      sendAudioToTwilio(socket, state.streamSid, responseAudio);
                    }
                  } catch (err) {
                    console.error('Error processing audio:', err);
                  } finally {
                    state.isProcessing = false;
                  }
                }, SILENCE_THRESHOLD_MS);
              }
            }
            break;
            
          case 'mark':
            console.log('Mark received:', message.mark?.name);
            // When audio playback completes, add grace period before listening
            if (message.mark?.name === 'audio_complete' && state) {
              // Mark when TTS ended for echo suppression
              state.lastTTSEndTime = Date.now();
              
              // Wait grace period before accepting user input (clear any echo/noise)
              setTimeout(() => {
                if (state) {
                  state.isAgentSpeaking = false;
                  state.audioBuffer = []; // Clear any audio captured during echo period
                  state.vadHistory = [];
                  console.log('✅ Agent finished speaking, grace period complete, ready to listen');
                }
              }, 400); // 400ms grace period before listening
            }
            break;
            
          case 'stop':
            console.log('Stream stopped');
            if (silenceTimer) {
              clearTimeout(silenceTimer);
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
      if (silenceTimer) {
        clearTimeout(silenceTimer);
      }
    };

    return response;
  }
  
  // Regular HTTP request - return info
  return new Response(
    JSON.stringify({ 
      message: 'Twilio Media Stream WebSocket Handler',
      usage: 'Connect via WebSocket for real-time audio streaming',
      features: ['Real-time STT', 'Dialogflow CX', 'TTS', 'Barge-in support'],
    }),
    { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
