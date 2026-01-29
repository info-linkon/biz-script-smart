import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * UTF-8 safe base64url encoding
 */
function stringToBase64url(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate HMAC-SHA256 signature using Web Crypto API
 */
async function sign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a session token for Media Bridge authentication
 */
async function generateSessionToken(
  userId: string,
  agentId: string,
  callSid: string,
  secret: string,
  expiryMs: number = 5 * 60 * 1000 // 5 minutes default
): Promise<string> {
  const payload = {
    userId,
    agentId,
    callSid,
    exp: Date.now() + expiryMs,
    jti: `${Date.now()}-${crypto.randomUUID().substring(0, 8)}`
  };

  const payloadB64 = stringToBase64url(JSON.stringify(payload));
  const signature = await sign(payloadB64, secret);

  return `${payloadB64}.${signature}`;
}

// This function handles incoming Twilio calls and bridges them to Dialogflow CX
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
    const mediaBridgeUrl = Deno.env.get('MEDIA_BRIDGE_URL');
    const mediaBridgeSecret = Deno.env.get('MEDIA_BRIDGE_SECRET') || '';
    
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

    // If this is the initial call (no speech result), start the call
    if (!speechResult) {
      const greeting = script?.greeting_message || 
        (language === 'he' ? `שלום, הגעת ל${profile?.business_name || 'העסק'}. איך אוכל לעזור לך?` :
         language === 'ar' ? `مرحبا، وصلت إلى ${profile?.business_name || 'العمل'}. كيف يمكنني مساعدتك؟` :
         `Hello, you've reached ${profile?.business_name || 'our business'}. How can I help you?`);

      console.log(`[BRIDGE] Call initiated for user ${userId} from ${from}`);

      // Generate session token for Media Bridge authentication
      const agentId = profile?.dialogflow_agent_id || '';
      const sessionToken = await generateSessionToken(
        userId,
        agentId,
        callSid,
        mediaBridgeSecret
      );

      // Build stream URL - use Media Bridge if configured, otherwise fallback to Edge Function
      let streamUrl: string;
      if (mediaBridgeUrl) {
        // Connect directly to Media Bridge on Cloud Run
        streamUrl = mediaBridgeUrl.replace('https://', 'wss://');
      } else {
        // Fallback to Edge Function (limited to 60s)
        streamUrl = `wss://${supabaseUrl.replace('https://', '')}/functions/v1/twilio-media-stream`;
      }

       // TwiML with sessionToken in customParameters for secure authentication.
       // IMPORTANT: If the WebSocket closes immediately (e.g. auth/connectivity issue),
       // Twilio will continue to the verbs below, preventing an immediate hangup.
       const fallbackIntro = language === 'he'
         ? 'יש בעיה זמנית בחיבור. נמשיך בשיחה רגילה. איך אפשר לעזור?'
         : language === 'ar'
           ? 'هناك مشكلة مؤقتة في الاتصال. سنواصل المكالمة بشكل عادي. كيف يمكنني مساعدتك؟'
           : 'Temporary connection issue. Continuing in standard mode. How can I help?';

       const twiml = `<?xml version="1.0" encoding="UTF-8"?>
 <Response>
   <Connect>
     <Stream url="${streamUrl}">
       <Parameter name="sessionToken" value="${sessionToken}" />
       <Parameter name="userId" value="${userId}" />
       <Parameter name="agentId" value="${agentId}" />
       <Parameter name="language" value="${langCode}" />
       <Parameter name="greeting" value="${encodeURIComponent(greeting)}" />
     </Stream>
   </Connect>

   <!-- Fallback path: only runs if <Connect><Stream> ends (e.g. WS disconnect) -->
   <Say language="${langCode}" voice="${voiceName}">${fallbackIntro}</Say>
   <Gather input="speech" language="${langCode}" speechTimeout="auto" action="${supabaseUrl}/functions/v1/twilio-dialogflow-bridge" method="POST">
     <Say language="${langCode}" voice="${voiceName}"></Say>
   </Gather>
   <Say language="${langCode}" voice="${voiceName}">${language === 'he' ? 'תודה שהתקשרת. להתראות!' : 'Thank you for calling. Goodbye!'}</Say>
 </Response>`;
      
      console.log('📄 TwiML Response (token generated):', { 
        streamUrl, 
        hasToken: !!sessionToken,
        userId,
        agentId: agentId.substring(0, 10) + '...'
      });
      
      return new Response(twiml, { 
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' } 
      });
    }

    // Process speech with Dialogflow CX (for non-streaming fallback)
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
