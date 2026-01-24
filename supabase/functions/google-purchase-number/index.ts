import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GoogleCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

async function getAccessToken(credentials: GoogleCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: credentials.token_uri,
    iat: now,
    exp: expiry,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/dialogflow"
  };

  const encoder = new TextEncoder();
  const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signatureInput = `${base64Header}.${base64Payload}`;
  
  const privateKeyPem = credentials.private_key;
  const pemContents = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');
  
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
    encoder.encode(signatureInput)
  );
  
  const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const jwt = `${signatureInput}.${base64Signature}`;

  const tokenResponse = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const credentialsJson = Deno.env.get('GOOGLE_CLOUD_CREDENTIALS');
    const googleProjectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!twilioAccountSid || !twilioAuthToken) {
      return new Response(
        JSON.stringify({ error: 'Twilio credentials not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!credentialsJson || !googleProjectId) {
      return new Response(
        JSON.stringify({ error: 'Google Cloud credentials not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.user.id;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { country_code = 'IL', voice_id } = body;

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'Profile not found. Please complete your profile first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials: GoogleCredentials = JSON.parse(credentialsJson);

    // Step 1: Create Dialogflow agent if not exists
    let dialogflowAgentId = profile.dialogflow_agent_id;
    
    if (!dialogflowAgentId) {
      console.log('Creating Dialogflow agent...');
      
      const accessToken = await getAccessToken(credentials);
      
      // Get active script for agent configuration
      const { data: script } = await supabase
        .from('scripts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      const language = script?.language || 'he';
      const languageCode = language === 'he' ? 'he-IL' : language === 'ar' ? 'ar-XA' : 'en-US';
      
      // Determine voice to use
      const voiceToUse = voice_id || (language === 'he' ? 'he-IL-Chirp3-HD-Aoede' : language === 'ar' ? 'ar-XA-Chirp3-HD-Aoede' : 'en-US-Chirp3-HD-Aoede');

      const agentPayload = {
        displayName: `${profile.business_name || 'Business'} Agent`,
        defaultLanguageCode: languageCode,
        timeZone: 'Asia/Jerusalem',
        description: `AI Agent for ${profile.business_name}`,
        speechToTextSettings: {
          enableSpeechAdaptation: true
        },
        advancedSettings: {
          speechSettings: {
            endpointerSensitivity: 50,
            noSpeechTimeout: "5s",
            useTimeoutBasedEndpointing: true,
            models: {
              [languageCode]: "chirp_2"
            }
          }
        },
        textToSpeechSettings: {
          synthesizeSpeechConfigs: {
            [languageCode]: {
              voice: { name: voiceToUse },
              audioEncoding: "OUTPUT_AUDIO_ENCODING_LINEAR_16"
            }
          }
        }
      };

      const createAgentResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/projects/${googleProjectId}/locations/global/agents`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(agentPayload)
        }
      );

      if (!createAgentResponse.ok) {
        const errorText = await createAgentResponse.text();
        console.error('Failed to create Dialogflow agent:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to create AI agent', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const agentData = await createAgentResponse.json();
      dialogflowAgentId = agentData.name.split('/').pop();
      
      // Create webhook for the agent
      const webhookPayload = {
        displayName: "Business Actions Webhook",
        genericWebService: {
          uri: `${supabaseUrl}/functions/v1/google-webhook`,
          requestHeaders: {
            "x-agent-user-id": userId
          }
        },
        timeout: "30s"
      };

      await fetch(
        `https://dialogflow.googleapis.com/v3/${agentData.name}/webhooks`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(webhookPayload)
        }
      );

      // Update profile with agent ID
      await supabase
        .from('profiles')
        .update({ 
          dialogflow_agent_id: dialogflowAgentId,
          voice_provider: 'google'
        })
        .eq('user_id', userId);
      
      console.log('Dialogflow agent created:', dialogflowAgentId);
    }

    // Step 2: Search for available phone numbers
    console.log('Searching for available phone numbers in', country_code);
    
    const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
    
    // Map country codes to Twilio format
    const countryMapping: Record<string, string> = {
      'IL': 'IL',
      'US': 'US',
      'GB': 'GB',
      'DE': 'DE',
      'FR': 'FR'
    };
    
    const twilioCountry = countryMapping[country_code] || 'US';
    
    const searchResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/AvailablePhoneNumbers/${twilioCountry}/Local.json?PageSize=1`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${twilioAuth}`,
        }
      }
    );

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Failed to search phone numbers:', errorText);
      return new Response(
        JSON.stringify({ error: 'No phone numbers available in this region', details: errorText }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const searchData = await searchResponse.json();
    
    if (!searchData.available_phone_numbers || searchData.available_phone_numbers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No phone numbers available in this region. Please try a different country.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const selectedNumber = searchData.available_phone_numbers[0];
    console.log('Found available number:', selectedNumber.phone_number);

    // Step 3: Purchase the number
    const voiceWebhookUrl = `${supabaseUrl}/functions/v1/twilio-dialogflow-bridge`;
    
    const purchaseResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/IncomingPhoneNumbers.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${twilioAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          PhoneNumber: selectedNumber.phone_number,
          VoiceUrl: voiceWebhookUrl,
          VoiceMethod: 'POST',
          FriendlyName: `${profile.business_name || 'Business'} - Dialogflow Agent`
        })
      }
    );

    if (!purchaseResponse.ok) {
      const errorText = await purchaseResponse.text();
      console.error('Twilio purchase error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to purchase phone number', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const purchaseData = await purchaseResponse.json();
    console.log('Number purchased:', purchaseData.phone_number);

    // Step 4: Save phone number to database
    const { data: phoneRecord, error: phoneError } = await supabase
      .from('phone_numbers')
      .insert({
        user_id: userId,
        phone_number: purchaseData.phone_number,
        country_code: country_code,
        twilio_sid: purchaseData.sid,
        elevenlabs_phone_id: purchaseData.sid, // Using Twilio SID as the ID
        status: 'active',
        is_active: true,
        monthly_cost: 2.00,
        purchased_at: new Date().toISOString()
      })
      .select()
      .single();

    if (phoneError) {
      console.error('Error saving phone number:', phoneError);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        phone_number: purchaseData.phone_number,
        twilio_sid: purchaseData.sid,
        dialogflow_agent_id: dialogflowAgentId,
        phone_record: phoneRecord,
        message: 'Phone number purchased and AI agent configured successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error purchasing phone number:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
