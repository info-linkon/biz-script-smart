import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// This bridge now supports TWO modes:
// 1. Real-time Streaming (via WebSocket Media Streams) - for natural conversation
// 2. Record-based (via process-recording) - fallback for debugging

const USE_STREAMING = true; // Set to false to use Record-based flow

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This function handles incoming Twilio calls and bridges them to Dialogflow CX
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse Twilio webhook data
    const formData = await req.formData();
    const callSid = formData.get('CallSid') as string;
    const from = formData.get('From') as string;
    const to = formData.get('To') as string;
    const speechResult = formData.get('SpeechResult') as string;

    console.log('Twilio call received:', { callSid, from, to, speechResult });

    // Find the phone number owner
    const { data: phoneRecord } = await supabase
      .from('phone_numbers')
      .select('user_id')
      .eq('phone_number', to)
      .eq('is_active', true)
      .maybeSingle();

    if (!phoneRecord) {
      // Return a simple message if no owner found
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="he-IL" voice="Google.he-IL-Wavenet-A">מצטערים, המספר הזה לא פעיל כרגע. נסה שוב מאוחר יותר.</Say>
  <Hangup/>
</Response>`;
      return new Response(twiml, { 
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' } 
      });
    }

    const userId = phoneRecord.user_id;

    // Get user's Dialogflow agent and script
    const { data: profile } = await supabase
      .from('profiles')
      .select('dialogflow_agent_id, business_name')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: script } = await supabase
      .from('scripts')
      .select('language, greeting_message')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    const language = script?.language || 'he';
    const voiceName = language === 'he' ? 'Google.he-IL-Wavenet-A' : 
                      language === 'ar' ? 'Google.ar-XA-Wavenet-A' : 
                      'Google.en-US-Wavenet-D';
    const langCode = language === 'he' ? 'he-IL' : language === 'ar' ? 'ar-XA' : 'en-US';

    // If this is the initial call (no speech result), greet and start conversation
    if (!speechResult) {
      const greeting = script?.greeting_message || 
        (language === 'he' ? `שלום, הגעת ל${profile?.business_name || 'העסק'}. איך אוכל לעזור לך?` :
         language === 'ar' ? `مرحبا، وصلت إلى ${profile?.business_name || 'العمل'}. كيف يمكنني مساعدتك؟` :
         `Hello, you've reached ${profile?.business_name || 'our business'}. How can I help you?`);

      // Note: Call record is created by twilio-media-stream to avoid duplicates
      console.log(`[BRIDGE] Call initiated for user ${userId} from ${from}`);

      let twiml: string;
      
      if (USE_STREAMING) {
        // Real-time streaming mode - uses WebSocket for natural conversation
        // The greeting will be sent via WebSocket, but we say a brief intro first
        const streamUrl = `wss://${supabaseUrl.replace('https://', '')}/functions/v1/twilio-media-stream`;
        
        // <Connect><Stream> is bidirectional by default
        // Audio can be sent back through the same WebSocket using media events
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="agentId" value="${profile?.dialogflow_agent_id || ''}" />
      <Parameter name="language" value="${language}" />
      <Parameter name="greeting" value="${encodeURIComponent(greeting)}" />
    </Stream>
  </Connect>
</Response>`;
        
        console.log('📄 TwiML Response being sent:', twiml);
      } else {
        // Record-based mode - uses process-recording for Hebrew/Arabic recognition
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="${langCode}" voice="${voiceName}">${greeting}</Say>
  <Record maxLength="15" playBeep="true" timeout="2" 
    action="${supabaseUrl}/functions/v1/process-recording" 
    recordingStatusCallback="${supabaseUrl}/functions/v1/process-recording"/>
  <Say language="${langCode}" voice="${voiceName}">${language === 'he' ? 'לא שמעתי אותך. להתראות!' : 'I didn\'t hear you. Goodbye!'}</Say>
</Response>`;
      }
      
      return new Response(twiml, { 
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' } 
      });
    }

    // Process speech with Dialogflow CX (simplified - using detect intent)
    // For full implementation, you'd use the Dialogflow CX streaming API
    const credentialsJson = Deno.env.get('GOOGLE_CLOUD_CREDENTIALS');
    if (!credentialsJson || !projectId || !profile?.dialogflow_agent_id) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="${langCode}" voice="${voiceName}">${language === 'he' ? 'מצטער, יש בעיה טכנית. נסה שוב מאוחר יותר.' : 'Sorry, technical issue. Please try again later.'}</Say>
  <Hangup/>
</Response>`;
      return new Response(twiml, { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } });
    }

    // Call Dialogflow CX Detect Intent API
    const credentials = JSON.parse(credentialsJson);
    const accessToken = await getAccessToken(credentials);
    
    const sessionId = callSid;
    const detectIntentUrl = `https://dialogflow.googleapis.com/v3/projects/${projectId}/locations/global/agents/${profile.dialogflow_agent_id}/sessions/${sessionId}:detectIntent`;

    const detectResponse = await fetch(detectIntentUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        queryInput: {
          text: { text: speechResult },
          languageCode: langCode
        }
      })
    });

    let responseText = language === 'he' ? 'מצטער, לא הבנתי. אפשר לחזור על זה?' : 'Sorry, I didn\'t understand. Could you repeat?';
    
    if (detectResponse.ok) {
      const detectData = await detectResponse.json();
      const messages = detectData.queryResult?.responseMessages || [];
      const textMessages = messages.filter((m: any) => m.text?.text?.length > 0);
      if (textMessages.length > 0) {
        responseText = textMessages.map((m: any) => m.text.text.join(' ')).join(' ');
      }
    }

    // Continue the conversation
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="${langCode}" voice="${voiceName}">${responseText}</Say>
  <Gather input="speech" language="${langCode}" speechTimeout="auto" action="${supabaseUrl}/functions/v1/twilio-dialogflow-bridge" method="POST">
    <Say language="${langCode}" voice="${voiceName}"></Say>
  </Gather>
  <Say language="${langCode}" voice="${voiceName}">${language === 'he' ? 'תודה שהתקשרת. להתראות!' : 'Thank you for calling. Goodbye!'}</Say>
</Response>`;

    return new Response(twiml, { 
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' } 
    });

  } catch (error) {
    console.error('Bridge error:', error);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="he-IL">מצטער, אירעה שגיאה. להתראות.</Say>
  <Hangup/>
</Response>`;
    return new Response(twiml, { 
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' } 
    });
  }
});

async function getAccessToken(credentials: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: credentials.token_uri,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/dialogflow"
  };

  const encoder = new TextEncoder();
  const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signatureInput = `${base64Header}.${base64Payload}`;

  const pemContents = credentials.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(signatureInput));
  const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const jwt = `${signatureInput}.${base64Signature}`;

  const tokenResponse = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}
