import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get Google Cloud access token from service account credentials
async function getAccessToken(credentials: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claimB64 = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsignedToken = `${headerB64}.${claimB64}`;

  // Import the private key
  const pemContents = credentials.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const jwt = `${unsignedToken}.${signatureB64}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// Call Dialogflow CX to get response
async function callDialogflow(
  accessToken: string,
  projectId: string,
  agentId: string,
  sessionId: string,
  text: string,
  languageCode: string
): Promise<{ responseText: string; endInteraction: boolean }> {
  const location = 'global';
  const url = `https://dialogflow.googleapis.com/v3/projects/${projectId}/locations/${location}/agents/${agentId}/sessions/${sessionId}:detectIntent`;

  console.log('Calling Dialogflow with text:', text);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queryInput: {
        text: { text },
        languageCode,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Dialogflow error:', response.status, errorText);
    throw new Error(`Dialogflow error: ${response.status}`);
  }

  const data = await response.json();
  console.log('Dialogflow response:', JSON.stringify(data));

  const responseMessages = data.queryResult?.responseMessages || [];
  let responseText = '';
  
  for (const msg of responseMessages) {
    if (msg.text?.text) {
      responseText += msg.text.text.join(' ') + ' ';
    }
  }

  const endInteraction = data.queryResult?.currentPage?.displayName === 'End Session' ||
    data.queryResult?.diagnosticInfo?.['end_conversation'] === true;

  return { 
    responseText: responseText.trim() || 'מצטער, לא הצלחתי להבין. אפשר לנסות שוב?',
    endInteraction 
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    
    // Get Twilio recording data
    const recordingUrl = formData.get('RecordingUrl') as string;
    const recordingSid = formData.get('RecordingSid') as string;
    const callSid = formData.get('CallSid') as string;
    const from = formData.get('From') as string | null;
    const to = formData.get('To') as string | null;

    console.log('Processing recording:', { recordingSid, callSid, from, to, recordingUrl });

    // If this is just a status callback without from/to, ignore it
    if (!to && recordingUrl) {
      console.log('Status callback received, ignoring');
      return new Response('OK', { headers: corsHeaders });
    }

    if (!recordingUrl) {
      console.log('No recording URL, returning gather');
      // Return TwiML to gather again
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="Google.he-IL-Wavenet-A" language="he-IL">לא שמעתי. אפשר לחזור?</Say>
          <Record maxLength="15" playBeep="true" timeout="2" 
            action="${Deno.env.get('SUPABASE_URL')}/functions/v1/process-recording"
            recordingStatusCallback="${Deno.env.get('SUPABASE_URL')}/functions/v1/process-recording"/>
        </Response>`;
      return new Response(twiml, {
        headers: { ...corsHeaders, 'Content-Type': 'application/xml' },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get Google Cloud credentials
    const credentialsJson = Deno.env.get('GOOGLE_CLOUD_CREDENTIALS');
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');

    if (!credentialsJson || !projectId) {
      throw new Error('Google Cloud credentials not configured');
    }

    const credentials = JSON.parse(credentialsJson);
    const accessToken = await getAccessToken(credentials);

    // Normalize phone number for lookup
    const normalizedTo = to ? to.replace(/\s+/g, '').replace(/-/g, '') : '';
    
    // Get phone number and user info
    const { data: phoneData, error: phoneError } = await supabase
      .from('phone_numbers')
      .select('user_id')
      .or(`phone_number.eq.${normalizedTo},phone_number.eq.${to}`)
      .eq('is_active', true)
      .maybeSingle();

    if (phoneError || !phoneData) {
      console.error('Phone lookup error:', phoneError);
      throw new Error('Phone number not found');
    }

    // Get user's profile and script
    const { data: profile } = await supabase
      .from('profiles')
      .select('dialogflow_agent_id')
      .eq('user_id', phoneData.user_id)
      .single();

    const { data: script } = await supabase
      .from('scripts')
      .select('language')
      .eq('user_id', phoneData.user_id)
      .eq('is_active', true)
      .maybeSingle();

    const agentId = profile?.dialogflow_agent_id;
    const language = script?.language || 'he';
    const languageCode = language === 'he' ? 'he-IL' : language === 'ar' ? 'ar-IL' : 'en-US';

    if (!agentId) {
      throw new Error('No Dialogflow agent configured');
    }

    // Download recording from Twilio
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    
    // Minimal wait for recording availability (reduced from 1000ms)
    await new Promise(resolve => setTimeout(resolve, 300));

    // Fetch the recording audio
    const audioUrl = `${recordingUrl}.wav`;
    console.log('Fetching audio from:', audioUrl);
    
    const audioResponse = await fetch(audioUrl, {
      headers: {
        'Authorization': 'Basic ' + btoa(`${twilioAccountSid}:${twilioAuthToken}`),
      },
    });

    if (!audioResponse.ok) {
      console.error('Failed to fetch recording:', audioResponse.status);
      throw new Error('Failed to fetch recording');
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    console.log('Audio fetched, size:', audioBuffer.byteLength);

    // Send to Google Cloud Speech-to-Text
    const sttResponse = await fetch(
      'https://speech.googleapis.com/v1/speech:recognize',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 8000,
            languageCode: 'he-IL', // Fixed to Hebrew only - no alternativeLanguageCodes to avoid confusion
            model: 'telephony_short', // Optimized for short recordings
            useEnhanced: true, // Higher accuracy
          },
          audio: { content: audioBase64 },
        }),
      }
    );

    if (!sttResponse.ok) {
      const sttError = await sttResponse.text();
      console.error('STT error:', sttResponse.status, sttError);
      throw new Error('Speech-to-text failed');
    }

    const sttData = await sttResponse.json();
    console.log('STT response:', JSON.stringify(sttData));

    const transcript = sttData.results?.[0]?.alternatives?.[0]?.transcript || '';
    console.log('Transcript:', transcript);

    if (!transcript) {
      // No speech detected, ask again
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="Google.he-IL-Wavenet-A" language="he-IL">לא שמעתי. אפשר לחזור?</Say>
          <Record maxLength="15" playBeep="true" timeout="2" 
            action="${supabaseUrl}/functions/v1/process-recording"
            recordingStatusCallback="${supabaseUrl}/functions/v1/process-recording"/>
        </Response>`;
      return new Response(twiml, {
        headers: { ...corsHeaders, 'Content-Type': 'application/xml' },
      });
    }

    // Send transcript to Dialogflow
    const dialogflowResult = await callDialogflow(
      accessToken,
      projectId,
      agentId,
      callSid,
      transcript,
      languageCode
    );

    console.log('Dialogflow result:', dialogflowResult);

    // Generate TwiML response
    let twiml: string;
    
    if (dialogflowResult.endInteraction) {
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="Google.he-IL-Wavenet-A" language="he-IL">${dialogflowResult.responseText}</Say>
          <Hangup/>
        </Response>`;
    } else {
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="Google.he-IL-Wavenet-A" language="he-IL">${dialogflowResult.responseText}</Say>
          <Record maxLength="15" playBeep="true" timeout="2" 
            action="${supabaseUrl}/functions/v1/process-recording"
            recordingStatusCallback="${supabaseUrl}/functions/v1/process-recording"/>
        </Response>`;
    }

    console.log('Returning TwiML:', twiml);

    return new Response(twiml, {
      headers: { ...corsHeaders, 'Content-Type': 'application/xml' },
    });

  } catch (error) {
    console.error('Error processing recording:', error);
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say voice="Google.he-IL-Wavenet-A" language="he-IL">מצטער, אירעה שגיאה. אנא נסה שוב מאוחר יותר.</Say>
        <Hangup/>
      </Response>`;

    return new Response(twiml, {
      headers: { ...corsHeaders, 'Content-Type': 'application/xml' },
    });
  }
});
