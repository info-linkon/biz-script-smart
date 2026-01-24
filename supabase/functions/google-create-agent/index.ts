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

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

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
  
  // Import the private key
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

  // Exchange JWT for access token
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
    const credentialsJson = Deno.env.get('GOOGLE_CLOUD_CREDENTIALS');
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!credentialsJson || !projectId) {
      return new Response(
        JSON.stringify({ error: 'Google Cloud credentials not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials: GoogleCredentials = JSON.parse(credentialsJson);

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

    // Get user profile and active script
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if agent already exists
    if (profile.dialogflow_agent_id) {
      return new Response(
        JSON.stringify({ 
          agent_id: profile.dialogflow_agent_id,
          message: 'Agent already exists'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get active script
    const { data: script } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    // Get access token
    const accessToken = await getAccessToken(credentials);

    // Determine language settings
    const language = script?.language || 'he';
    const languageCode = language === 'he' ? 'he-IL' : language === 'ar' ? 'ar-XA' : 'en-US';

    // Build the system prompt
    const systemPrompt = buildSystemPrompt(profile, script, language);

    // Create Dialogflow CX Agent
    const location = 'global'; // or specific region like 'us-central1'
    const agentDisplayName = `${profile.business_name || 'Business'} Agent`;
    
    const agentPayload = {
      displayName: agentDisplayName,
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
            [languageCode]: "chirp_2" // Using Chirp for better Hebrew/Arabic support
          }
        }
      },
      textToSpeechSettings: {
        synthesizeSpeechConfigs: {
          [languageCode]: {
            voice: {
              name: language === 'he' ? 'he-IL-Wavenet-A' : language === 'ar' ? 'ar-XA-Wavenet-A' : 'en-US-Wavenet-D'
            },
            audioEncoding: "OUTPUT_AUDIO_ENCODING_LINEAR_16"
          }
        }
      }
    };

    const createAgentResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/projects/${projectId}/locations/${location}/agents`,
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
      console.error('Failed to create agent:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to create Dialogflow agent', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const agentData = await createAgentResponse.json();
    const agentId = agentData.name.split('/').pop();

    // Create the Default Start Flow with our system prompt
    const defaultFlowName = `${agentData.name}/flows/00000000-0000-0000-0000-000000000000`;
    
    // Update the default flow with our configuration
    const flowPayload = {
      displayName: "Default Start Flow",
      description: "Main conversation flow",
      transitionRoutes: [],
      eventHandlers: [
        {
          event: "sys.no-match-default",
          triggerFulfillment: {
            messages: [
              {
                text: {
                  text: [language === 'he' ? 
                    "סליחה, לא הבנתי. אפשר לחזור על זה?" : 
                    language === 'ar' ? 
                    "عذراً، لم أفهم. هل يمكنك إعادة ذلك؟" : 
                    "Sorry, I didn't understand. Could you repeat that?"]
                }
              }
            ]
          }
        },
        {
          event: "sys.no-input-default",
          triggerFulfillment: {
            messages: [
              {
                text: {
                  text: [language === 'he' ? 
                    "האם אתה עדיין שם?" : 
                    language === 'ar' ? 
                    "هل ما زلت هناك؟" : 
                    "Are you still there?"]
                }
              }
            ]
          }
        }
      ],
      nluSettings: {
        modelType: "MODEL_TYPE_ADVANCED",
        classificationThreshold: 0.3
      }
    };

    await fetch(
      `https://dialogflow.googleapis.com/v3/${defaultFlowName}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(flowPayload)
      }
    );

    // Create webhook for scheduling
    const webhookUrl = `${supabaseUrl}/functions/v1/google-webhook`;
    
    const webhookPayload = {
      displayName: "Business Actions Webhook",
      genericWebService: {
        uri: webhookUrl,
        requestHeaders: {
          "x-agent-user-id": userId
        }
      },
      timeout: "30s"
    };

    const webhookResponse = await fetch(
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

    let webhookId = null;
    if (webhookResponse.ok) {
      const webhookData = await webhookResponse.json();
      webhookId = webhookData.name;
    }

    // Create intents
    const intents = [
      // Greeting intent
      {
        displayName: "greeting",
        trainingPhrases: language === 'he' ? [
          { parts: [{ text: "שלום" }], repeatCount: 1 },
          { parts: [{ text: "היי" }], repeatCount: 1 },
          { parts: [{ text: "בוקר טוב" }], repeatCount: 1 },
          { parts: [{ text: "ערב טוב" }], repeatCount: 1 },
          { parts: [{ text: "אהלן" }], repeatCount: 1 },
          { parts: [{ text: "הלו" }], repeatCount: 1 },
          { parts: [{ text: "צהריים טובים" }], repeatCount: 1 },
          { parts: [{ text: "מה שלומך" }], repeatCount: 1 },
          { parts: [{ text: "מה נשמע" }], repeatCount: 1 }
        ] : language === 'ar' ? [
          { parts: [{ text: "مرحبا" }], repeatCount: 1 },
          { parts: [{ text: "السلام عليكم" }], repeatCount: 1 },
          { parts: [{ text: "صباح الخير" }], repeatCount: 1 },
          { parts: [{ text: "مساء الخير" }], repeatCount: 1 },
          { parts: [{ text: "أهلا" }], repeatCount: 1 }
        ] : [
          { parts: [{ text: "Hello" }], repeatCount: 1 },
          { parts: [{ text: "Hi" }], repeatCount: 1 },
          { parts: [{ text: "Good morning" }], repeatCount: 1 },
          { parts: [{ text: "Good evening" }], repeatCount: 1 },
          { parts: [{ text: "Hey" }], repeatCount: 1 }
        ]
      },
      // Schedule appointment intent - expanded
      {
        displayName: "schedule.appointment",
        trainingPhrases: language === 'he' ? [
          { parts: [{ text: "אני רוצה לקבוע פגישה" }], repeatCount: 1 },
          { parts: [{ text: "אפשר לקבוע תור" }], repeatCount: 1 },
          { parts: [{ text: "מתי יש לכם מקום פנוי" }], repeatCount: 1 },
          { parts: [{ text: "אני רוצה להזמין תור" }], repeatCount: 1 },
          { parts: [{ text: "אני צריך לקבוע תור" }], repeatCount: 1 },
          { parts: [{ text: "יש תור פנוי" }], repeatCount: 1 },
          { parts: [{ text: "אני רוצה לבוא אליכם" }], repeatCount: 1 },
          { parts: [{ text: "איך אפשר לקבוע" }], repeatCount: 1 },
          { parts: [{ text: "בוא נקבע פגישה" }], repeatCount: 1 },
          { parts: [{ text: "אפשר להזמין" }], repeatCount: 1 },
          { parts: [{ text: "רוצה לקבוע" }], repeatCount: 1 },
          { parts: [{ text: "צריך תור" }], repeatCount: 1 },
          { parts: [{ text: "אפשר לקבוע משהו" }], repeatCount: 1 },
          { parts: [{ text: "אני מעוניין לקבוע" }], repeatCount: 1 },
          { parts: [{ text: "אפשר להירשם" }], repeatCount: 1 }
        ] : language === 'ar' ? [
          { parts: [{ text: "أريد حجز موعد" }], repeatCount: 1 },
          { parts: [{ text: "هل يمكنني حجز موعد" }], repeatCount: 1 },
          { parts: [{ text: "أحتاج إلى موعد" }], repeatCount: 1 },
          { parts: [{ text: "هل هناك موعد متاح" }], repeatCount: 1 },
          { parts: [{ text: "أريد أن آتي إليكم" }], repeatCount: 1 }
        ] : [
          { parts: [{ text: "I want to schedule an appointment" }], repeatCount: 1 },
          { parts: [{ text: "Can I book a meeting" }], repeatCount: 1 },
          { parts: [{ text: "I need to make an appointment" }], repeatCount: 1 },
          { parts: [{ text: "Is there an available slot" }], repeatCount: 1 },
          { parts: [{ text: "I'd like to book" }], repeatCount: 1 },
          { parts: [{ text: "Can I schedule something" }], repeatCount: 1 }
        ],
        parameters: [
          {
            id: "customer_name",
            entityType: "@sys.person",
            isList: false,
            redact: false
          },
          {
            id: "date_time",
            entityType: "@sys.date-time",
            isList: false,
            redact: false
          }
        ]
      },
      // Check availability intent - expanded
      {
        displayName: "check.availability",
        trainingPhrases: language === 'he' ? [
          { parts: [{ text: "מתי אתם פנויים" }], repeatCount: 1 },
          { parts: [{ text: "מה הזמינות שלכם" }], repeatCount: 1 },
          { parts: [{ text: "מתי אפשר לבוא" }], repeatCount: 1 },
          { parts: [{ text: "באיזה שעות אתם עובדים" }], repeatCount: 1 },
          { parts: [{ text: "מה שעות הפעילות" }], repeatCount: 1 },
          { parts: [{ text: "עד מתי אתם פתוחים" }], repeatCount: 1 },
          { parts: [{ text: "מתי אתם פותחים" }], repeatCount: 1 },
          { parts: [{ text: "באיזה ימים אתם עובדים" }], repeatCount: 1 },
          { parts: [{ text: "אתם פתוחים היום" }], repeatCount: 1 },
          { parts: [{ text: "אתם עובדים בשבת" }], repeatCount: 1 },
          { parts: [{ text: "מתי אתם סוגרים" }], repeatCount: 1 },
          { parts: [{ text: "אתם פתוחים עכשיו" }], repeatCount: 1 },
          { parts: [{ text: "מה השעות שלכם" }], repeatCount: 1 },
          { parts: [{ text: "באיזה שעות אתם פתוחים" }], repeatCount: 1 },
          { parts: [{ text: "מתי אפשר להגיע" }], repeatCount: 1 },
          { parts: [{ text: "יש לכם פנוי היום" }], repeatCount: 1 },
          { parts: [{ text: "יש מקום היום" }], repeatCount: 1 },
          { parts: [{ text: "אתם עובדים בערב" }], repeatCount: 1 },
          { parts: [{ text: "אתם עובדים בבוקר" }], repeatCount: 1 }
        ] : language === 'ar' ? [
          { parts: [{ text: "متى تكونون متاحين" }], repeatCount: 1 },
          { parts: [{ text: "ما هي أوقات العمل" }], repeatCount: 1 },
          { parts: [{ text: "في أي ساعات تعملون" }], repeatCount: 1 },
          { parts: [{ text: "هل أنتم مفتوحون اليوم" }], repeatCount: 1 },
          { parts: [{ text: "متى تفتحون" }], repeatCount: 1 },
          { parts: [{ text: "متى تغلقون" }], repeatCount: 1 }
        ] : [
          { parts: [{ text: "When are you available" }], repeatCount: 1 },
          { parts: [{ text: "What are your working hours" }], repeatCount: 1 },
          { parts: [{ text: "What time do you open" }], repeatCount: 1 },
          { parts: [{ text: "What time do you close" }], repeatCount: 1 },
          { parts: [{ text: "Are you open today" }], repeatCount: 1 },
          { parts: [{ text: "Do you work on weekends" }], repeatCount: 1 }
        ]
      },
      // Business info intent - expanded
      {
        displayName: "business.info",
        trainingPhrases: language === 'he' ? [
          { parts: [{ text: "מה השירותים שלכם" }], repeatCount: 1 },
          { parts: [{ text: "ספר לי על העסק" }], repeatCount: 1 },
          { parts: [{ text: "מה אתם מציעים" }], repeatCount: 1 },
          { parts: [{ text: "איפה אתם נמצאים" }], repeatCount: 1 },
          { parts: [{ text: "מה הכתובת שלכם" }], repeatCount: 1 },
          { parts: [{ text: "כמה זה עולה" }], repeatCount: 1 },
          { parts: [{ text: "מה המחירים" }], repeatCount: 1 },
          { parts: [{ text: "איך מגיעים אליכם" }], repeatCount: 1 },
          { parts: [{ text: "מה אתם עושים" }], repeatCount: 1 },
          { parts: [{ text: "מה העסק שלכם" }], repeatCount: 1 },
          { parts: [{ text: "איזה שירותים יש לכם" }], repeatCount: 1 },
          { parts: [{ text: "מה אפשר לעשות אצלכם" }], repeatCount: 1 },
          { parts: [{ text: "יש לכם מחירון" }], repeatCount: 1 },
          { parts: [{ text: "כמה עולה טיפול" }], repeatCount: 1 }
        ] : language === 'ar' ? [
          { parts: [{ text: "ما هي خدماتكم" }], repeatCount: 1 },
          { parts: [{ text: "أخبرني عن العمل" }], repeatCount: 1 },
          { parts: [{ text: "أين أنتم" }], repeatCount: 1 },
          { parts: [{ text: "ما هو العنوان" }], repeatCount: 1 },
          { parts: [{ text: "كم يكلف" }], repeatCount: 1 },
          { parts: [{ text: "ما هي الأسعار" }], repeatCount: 1 }
        ] : [
          { parts: [{ text: "What services do you offer" }], repeatCount: 1 },
          { parts: [{ text: "Tell me about your business" }], repeatCount: 1 },
          { parts: [{ text: "Where are you located" }], repeatCount: 1 },
          { parts: [{ text: "What is your address" }], repeatCount: 1 },
          { parts: [{ text: "How much does it cost" }], repeatCount: 1 },
          { parts: [{ text: "What are your prices" }], repeatCount: 1 }
        ]
      },
      // Thanks intent
      {
        displayName: "thanks",
        trainingPhrases: language === 'he' ? [
          { parts: [{ text: "תודה" }], repeatCount: 1 },
          { parts: [{ text: "תודה רבה" }], repeatCount: 1 },
          { parts: [{ text: "מעולה תודה" }], repeatCount: 1 },
          { parts: [{ text: "אחלה תודה" }], repeatCount: 1 },
          { parts: [{ text: "מושלם תודה" }], repeatCount: 1 },
          { parts: [{ text: "יופי תודה" }], repeatCount: 1 }
        ] : language === 'ar' ? [
          { parts: [{ text: "شكرا" }], repeatCount: 1 },
          { parts: [{ text: "شكرا جزيلا" }], repeatCount: 1 },
          { parts: [{ text: "ممتاز شكرا" }], repeatCount: 1 }
        ] : [
          { parts: [{ text: "Thank you" }], repeatCount: 1 },
          { parts: [{ text: "Thanks" }], repeatCount: 1 },
          { parts: [{ text: "Great thanks" }], repeatCount: 1 }
        ]
      },
      // Goodbye intent
      {
        displayName: "goodbye",
        trainingPhrases: language === 'he' ? [
          { parts: [{ text: "להתראות" }], repeatCount: 1 },
          { parts: [{ text: "ביי" }], repeatCount: 1 },
          { parts: [{ text: "יום טוב" }], repeatCount: 1 },
          { parts: [{ text: "שיהיה יום טוב" }], repeatCount: 1 },
          { parts: [{ text: "נתראה" }], repeatCount: 1 },
          { parts: [{ text: "תהיה בריא" }], repeatCount: 1 },
          { parts: [{ text: "כל טוב" }], repeatCount: 1 }
        ] : language === 'ar' ? [
          { parts: [{ text: "مع السلامة" }], repeatCount: 1 },
          { parts: [{ text: "باي" }], repeatCount: 1 },
          { parts: [{ text: "إلى اللقاء" }], repeatCount: 1 },
          { parts: [{ text: "يوم سعيد" }], repeatCount: 1 }
        ] : [
          { parts: [{ text: "Goodbye" }], repeatCount: 1 },
          { parts: [{ text: "Bye" }], repeatCount: 1 },
          { parts: [{ text: "Have a good day" }], repeatCount: 1 },
          { parts: [{ text: "See you" }], repeatCount: 1 }
        ]
      }
    ];

    for (const intent of intents) {
      await fetch(
        `https://dialogflow.googleapis.com/v3/${agentData.name}/intents`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(intent)
        }
      );
    }

    // Create a generative agent with our system prompt
    const generativeSettings = {
      generativeSettings: {
        fallbackSettings: {
          selectedPrompt: systemPrompt,
          promptTemplates: [
            {
              displayName: "Main Prompt",
              promptText: systemPrompt,
              frozen: false
            }
          ]
        }
      }
    };

    await fetch(
      `https://dialogflow.googleapis.com/v3/${agentData.name}/generativeSettings?updateMask=fallbackSettings`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(generativeSettings)
      }
    );

    // Save agent ID to profile
    await supabase
      .from('profiles')
      .update({ 
        dialogflow_agent_id: agentId,
        voice_provider: 'google'
      })
      .eq('user_id', userId);

    return new Response(
      JSON.stringify({ 
        success: true,
        agent_id: agentId,
        agent_name: agentData.name,
        webhook_id: webhookId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error creating Dialogflow agent:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildSystemPrompt(profile: any, script: any, language: string): string {
  const businessName = profile?.business_name || 'העסק';
  const businessType = profile?.business_type || 'עסק';
  const services = script?.services || [];
  const faq = script?.faq || [];
  const tone = script?.tone || 'friendly';
  const businessHours = script?.business_hours || '';
  const customPrompt = script?.custom_prompt || '';

  const toneInstructions: Record<string, Record<string, string>> = {
    he: {
      friendly: 'דבר בצורה חמה וידידותית',
      professional: 'דבר בצורה מקצועית ורשמית',
      casual: 'דבר בצורה קז\'ואלית ונינוחה',
      formal: 'דבר בצורה רשמית ומכובדת'
    },
    ar: {
      friendly: 'تحدث بطريقة ودية ودافئة',
      professional: 'تحدث بشكل مهني ورسمي',
      casual: 'تحدث بشكل عفوي ومريح',
      formal: 'تحدث بشكل رسمي ومحترم'
    },
    en: {
      friendly: 'Speak in a warm and friendly manner',
      professional: 'Speak professionally and formally',
      casual: 'Speak casually and relaxed',
      formal: 'Speak formally and respectfully'
    }
  };

  if (language === 'he') {
    return `אתה עוזר וירטואלי של ${businessName}, ${businessType}.

${toneInstructions.he[tone] || toneInstructions.he.friendly}

מידע על העסק:
- שם העסק: ${businessName}
- סוג העסק: ${businessType}
${businessHours ? `- שעות פעילות: ${businessHours}` : ''}
${services.length > 0 ? `- שירותים: ${services.join(', ')}` : ''}

${faq.length > 0 ? `שאלות נפוצות:\n${faq.map((f: any) => `ש: ${f.question}\nת: ${f.answer}`).join('\n\n')}` : ''}

${customPrompt ? `הוראות נוספות:\n${customPrompt}` : ''}

משימות עיקריות:
1. ברך את הלקוח בחביבות
2. ענה על שאלות לגבי העסק והשירותים
3. עזור לקבוע פגישות - בדוק זמינות ואסוף פרטי לקוח
4. אם אינך יודע תשובה, הצע ללקוח להשאיר הודעה

חשוב מאוד:
- דבר תמיד בעברית באותיות עבריות בלבד (א-ת)
- אסור בשום פנים לכתוב עברית באותיות לטיניות
- היה קצר וענייני
- היה אדיב ומקצועי`;
  } else if (language === 'ar') {
    return `أنت المساعد الافتراضي لـ ${businessName}، ${businessType}.

${toneInstructions.ar[tone] || toneInstructions.ar.friendly}

معلومات العمل:
- اسم العمل: ${businessName}
- نوع العمل: ${businessType}
${businessHours ? `- ساعات العمل: ${businessHours}` : ''}
${services.length > 0 ? `- الخدمات: ${services.join(', ')}` : ''}

${faq.length > 0 ? `الأسئلة الشائعة:\n${faq.map((f: any) => `س: ${f.question}\nج: ${f.answer}`).join('\n\n')}` : ''}

${customPrompt ? `تعليمات إضافية:\n${customPrompt}` : ''}

المهام الرئيسية:
1. رحب بالعميل بلطف
2. أجب عن الأسئلة المتعلقة بالعمل والخدمات
3. ساعد في حجز المواعيد
4. إذا كنت لا تعرف الإجابة، اقترح على العميل ترك رسالة`;
  } else {
    return `You are the virtual assistant of ${businessName}, a ${businessType}.

${toneInstructions.en[tone] || toneInstructions.en.friendly}

Business Information:
- Business Name: ${businessName}
- Business Type: ${businessType}
${businessHours ? `- Business Hours: ${businessHours}` : ''}
${services.length > 0 ? `- Services: ${services.join(', ')}` : ''}

${faq.length > 0 ? `FAQ:\n${faq.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}` : ''}

${customPrompt ? `Additional Instructions:\n${customPrompt}` : ''}

Main Tasks:
1. Greet the customer warmly
2. Answer questions about the business and services
3. Help schedule appointments
4. If you don't know the answer, offer to take a message`;
  }
}
