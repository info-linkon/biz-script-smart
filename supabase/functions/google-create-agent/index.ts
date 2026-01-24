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
    const dialogflowLanguageCode = language === 'he' ? 'he' : language === 'ar' ? 'ar' : 'en';

    // Build the system prompt
    const systemPrompt = buildSystemPrompt(profile, script, language);

    // Create Dialogflow CX Agent with Generative AI enabled
    const location = 'global';
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
            [languageCode]: "chirp_2"
          }
        }
      },
      textToSpeechSettings: {
        synthesizeSpeechConfigs: {
          [languageCode]: {
            voice: {
              name: script?.voice_id || (language === 'he' ? 'he-IL-Wavenet-A' : language === 'ar' ? 'ar-XA-Wavenet-A' : 'en-US-Wavenet-D')
            },
            audioEncoding: "OUTPUT_AUDIO_ENCODING_LINEAR_16"
          }
        }
      },
      // Enable Generative AI features
      genAppBuilderSettings: {
        engine: `projects/${projectId}/locations/global/collections/default_collection/engines/default_search`
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

    // Create webhook for business actions
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

    let webhookName = null;
    if (webhookResponse.ok) {
      const webhookData = await webhookResponse.json();
      webhookName = webhookData.name;
    }

    // Get the default flow
    const defaultFlowName = `${agentData.name}/flows/00000000-0000-0000-0000-000000000000`;
    
    // Create intents with responses
    const intents = getIntentsWithRoutes(language, script);
    const createdIntents: Record<string, string> = {};

    for (const intent of intents) {
      const intentResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${agentData.name}/intents`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            displayName: intent.displayName,
            trainingPhrases: intent.trainingPhrases
          })
        }
      );
      
      if (intentResponse.ok) {
        const intentData = await intentResponse.json();
        createdIntents[intent.displayName] = intentData.name;
      }
    }

    // Create FAQ intents from script
    const faqIntents = createFaqIntents(script?.faq || [], language);
    for (const faqIntent of faqIntents) {
      const faqResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${agentData.name}/intents`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            displayName: faqIntent.displayName,
            trainingPhrases: faqIntent.trainingPhrases
          })
        }
      );
      
      if (faqResponse.ok) {
        const faqData = await faqResponse.json();
        createdIntents[faqIntent.displayName] = faqData.name;
      }
    }

    // Update the default flow with transition routes
    const transitionRoutes = [];
    
    // Add routes for each intent
    for (const intent of [...intents, ...faqIntents]) {
      if (createdIntents[intent.displayName]) {
        transitionRoutes.push({
          intent: createdIntents[intent.displayName],
          triggerFulfillment: {
            messages: [
              {
                text: {
                  text: [intent.response]
                }
              }
            ],
            // Add webhook for action intents
            ...(intent.webhookTag && webhookName ? {
              webhook: webhookName,
              tag: intent.webhookTag
            } : {})
          }
        });
      }
    }

    // Update flow with routes and generative fallback
    const flowPayload = {
      displayName: "Default Start Flow",
      description: "Main conversation flow with generative AI fallback",
      transitionRoutes: transitionRoutes,
      eventHandlers: [
        {
          event: "sys.no-match-default",
          triggerFulfillment: {
            // Use Generative Fallback instead of static message
            setParameterActions: [
              {
                parameter: "use_generative",
                value: true
              }
            ],
            messages: []
          }
        },
        {
          event: "sys.no-input-default",
          triggerFulfillment: {
            messages: [
              {
                text: {
                  text: [language === 'he' ? 
                    "האם אתה עדיין שם? איך אוכל לעזור?" : 
                    language === 'ar' ? 
                    "هل ما زلت هناك؟ كيف يمكنني مساعدتك؟" : 
                    "Are you still there? How can I help you?"]
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

    // Configure Generative Settings with LLM model
    const generativeSettings = {
      languageCode: dialogflowLanguageCode,
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
        },
        generativeSafetySettings: {
          bannedPhrases: []
        },
        knowledgeConnectorSettings: {
          enabled: true,
          triggerFulfillment: {
            messages: []
          }
        },
        llmModelSettings: {
          model: "gemini-1.5-flash",
          promptText: systemPrompt
        }
      }
    };

    const generativeResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentData.name}/generativeSettings?updateMask=fallbackSettings,llmModelSettings,knowledgeConnectorSettings`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(generativeSettings)
      }
    );

    if (!generativeResponse.ok) {
      console.error('Failed to set generative settings:', await generativeResponse.text());
    }

    // Train the agent
    await fetch(
      `https://dialogflow.googleapis.com/v3/${agentData.name}/flows/${defaultFlowName.split('/').pop()}:train`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
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
        webhook_id: webhookName,
        intents_created: Object.keys(createdIntents).length,
        faq_intents: faqIntents.length,
        generative_enabled: true
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

interface IntentWithRoute {
  displayName: string;
  trainingPhrases: { parts: { text: string }[]; repeatCount: number }[];
  response: string;
  webhookTag?: string;
}

function getIntentsWithRoutes(language: string, script: any): IntentWithRoute[] {
  const businessName = script?.business_name || 'העסק';
  const greeting = script?.greeting_message || (language === 'he' ? 'שלום! איך אוכל לעזור לך היום?' : 'Hello! How can I help you today?');
  
  if (language === 'he') {
    return [
      {
        displayName: "greeting",
        trainingPhrases: [
          { parts: [{ text: "שלום" }], repeatCount: 1 },
          { parts: [{ text: "היי" }], repeatCount: 1 },
          { parts: [{ text: "בוקר טוב" }], repeatCount: 1 },
          { parts: [{ text: "ערב טוב" }], repeatCount: 1 },
          { parts: [{ text: "אהלן" }], repeatCount: 1 },
          { parts: [{ text: "הלו" }], repeatCount: 1 },
          { parts: [{ text: "מה שלומך" }], repeatCount: 1 },
          { parts: [{ text: "מה נשמע" }], repeatCount: 1 }
        ],
        response: greeting
      },
      {
        displayName: "introduction",
        trainingPhrases: [
          { parts: [{ text: "שלום אני אמיר" }], repeatCount: 1 },
          { parts: [{ text: "אני דוד" }], repeatCount: 1 },
          { parts: [{ text: "קוראים לי יוסי" }], repeatCount: 1 },
          { parts: [{ text: "שמי רונית" }], repeatCount: 1 },
          { parts: [{ text: "אני משה" }], repeatCount: 1 },
          { parts: [{ text: "זה דני" }], repeatCount: 1 },
          { parts: [{ text: "אני שרה" }], repeatCount: 1 }
        ],
        response: "נעים מאוד! במה אוכל לעזור לך היום?"
      },
      {
        displayName: "schedule.appointment",
        trainingPhrases: [
          { parts: [{ text: "אני רוצה לקבוע פגישה" }], repeatCount: 1 },
          { parts: [{ text: "אפשר לקבוע תור" }], repeatCount: 1 },
          { parts: [{ text: "אני רוצה להזמין תור" }], repeatCount: 1 },
          { parts: [{ text: "אני צריך לקבוע תור" }], repeatCount: 1 },
          { parts: [{ text: "בוא נקבע פגישה" }], repeatCount: 1 },
          { parts: [{ text: "אפשר להזמין" }], repeatCount: 1 },
          { parts: [{ text: "רוצה לקבוע" }], repeatCount: 1 },
          { parts: [{ text: "צריך תור" }], repeatCount: 1 }
        ],
        response: "בשמחה! בוא נבדוק מתי יש לנו מקום פנוי. לאיזה יום ושעה היית רוצה?",
        webhookTag: "check_availability"
      },
      {
        displayName: "check.availability",
        trainingPhrases: [
          { parts: [{ text: "מתי אתם פנויים" }], repeatCount: 1 },
          { parts: [{ text: "מה הזמינות שלכם" }], repeatCount: 1 },
          { parts: [{ text: "מתי אפשר לבוא" }], repeatCount: 1 },
          { parts: [{ text: "באיזה שעות אתם עובדים" }], repeatCount: 1 },
          { parts: [{ text: "מה שעות הפעילות" }], repeatCount: 1 },
          { parts: [{ text: "עד מתי אתם פתוחים" }], repeatCount: 1 },
          { parts: [{ text: "מתי אתם פותחים" }], repeatCount: 1 },
          { parts: [{ text: "אתם פתוחים היום" }], repeatCount: 1 },
          { parts: [{ text: "יש לכם פנוי היום" }], repeatCount: 1 }
        ],
        response: "בוא נבדוק את הזמינות שלנו...",
        webhookTag: "get_availability"
      },
      {
        displayName: "business.info",
        trainingPhrases: [
          { parts: [{ text: "מה השירותים שלכם" }], repeatCount: 1 },
          { parts: [{ text: "ספר לי על העסק" }], repeatCount: 1 },
          { parts: [{ text: "מה אתם מציעים" }], repeatCount: 1 },
          { parts: [{ text: "איפה אתם נמצאים" }], repeatCount: 1 },
          { parts: [{ text: "מה הכתובת שלכם" }], repeatCount: 1 },
          { parts: [{ text: "כמה זה עולה" }], repeatCount: 1 },
          { parts: [{ text: "מה המחירים" }], repeatCount: 1 },
          { parts: [{ text: "מה אתם עושים" }], repeatCount: 1 }
        ],
        response: "אשמח לספר לך על השירותים שלנו. איזה מידע אתה מחפש?"
      },
      {
        displayName: "thanks",
        trainingPhrases: [
          { parts: [{ text: "תודה" }], repeatCount: 1 },
          { parts: [{ text: "תודה רבה" }], repeatCount: 1 },
          { parts: [{ text: "מעולה תודה" }], repeatCount: 1 },
          { parts: [{ text: "אחלה תודה" }], repeatCount: 1 },
          { parts: [{ text: "יופי תודה" }], repeatCount: 1 },
          { parts: [{ text: "סבבה תודה" }], repeatCount: 1 }
        ],
        response: "בכיף! האם יש עוד משהו שאוכל לעזור?"
      },
      {
        displayName: "goodbye",
        trainingPhrases: [
          { parts: [{ text: "להתראות" }], repeatCount: 1 },
          { parts: [{ text: "ביי" }], repeatCount: 1 },
          { parts: [{ text: "יום טוב" }], repeatCount: 1 },
          { parts: [{ text: "שיהיה יום טוב" }], repeatCount: 1 },
          { parts: [{ text: "נתראה" }], repeatCount: 1 },
          { parts: [{ text: "כל טוב" }], repeatCount: 1 },
          { parts: [{ text: "לא צריך יותר" }], repeatCount: 1 }
        ],
        response: "תודה שפנית אלינו! יום נעים ונשמח לראותך שוב."
      },
      {
        displayName: "leave.message",
        trainingPhrases: [
          { parts: [{ text: "אני רוצה להשאיר הודעה" }], repeatCount: 1 },
          { parts: [{ text: "אפשר להשאיר הודעה" }], repeatCount: 1 },
          { parts: [{ text: "שיחזרו אליי" }], repeatCount: 1 },
          { parts: [{ text: "תבקשו שיחזרו אליי" }], repeatCount: 1 }
        ],
        response: "בטח! מה ההודעה שתרצה להשאיר?",
        webhookTag: "leave_message"
      }
    ];
  } else if (language === 'ar') {
    return [
      {
        displayName: "greeting",
        trainingPhrases: [
          { parts: [{ text: "مرحبا" }], repeatCount: 1 },
          { parts: [{ text: "السلام عليكم" }], repeatCount: 1 },
          { parts: [{ text: "صباح الخير" }], repeatCount: 1 },
          { parts: [{ text: "مساء الخير" }], repeatCount: 1 },
          { parts: [{ text: "أهلا" }], repeatCount: 1 }
        ],
        response: greeting
      },
      {
        displayName: "schedule.appointment",
        trainingPhrases: [
          { parts: [{ text: "أريد حجز موعد" }], repeatCount: 1 },
          { parts: [{ text: "هل يمكنني حجز موعد" }], repeatCount: 1 },
          { parts: [{ text: "أحتاج إلى موعد" }], repeatCount: 1 }
        ],
        response: "بكل سرور! دعني أتحقق من التوفر. متى تفضل؟",
        webhookTag: "check_availability"
      },
      {
        displayName: "check.availability",
        trainingPhrases: [
          { parts: [{ text: "متى تكونون متاحين" }], repeatCount: 1 },
          { parts: [{ text: "ما هي أوقات العمل" }], repeatCount: 1 },
          { parts: [{ text: "هل أنتم مفتوحون اليوم" }], repeatCount: 1 }
        ],
        response: "دعني أتحقق من التوفر...",
        webhookTag: "get_availability"
      },
      {
        displayName: "thanks",
        trainingPhrases: [
          { parts: [{ text: "شكرا" }], repeatCount: 1 },
          { parts: [{ text: "شكرا جزيلا" }], repeatCount: 1 }
        ],
        response: "على الرحب! هل هناك شيء آخر يمكنني مساعدتك به؟"
      },
      {
        displayName: "goodbye",
        trainingPhrases: [
          { parts: [{ text: "مع السلامة" }], repeatCount: 1 },
          { parts: [{ text: "باي" }], repeatCount: 1 },
          { parts: [{ text: "إلى اللقاء" }], repeatCount: 1 }
        ],
        response: "شكرا لتواصلك معنا! يوم سعيد!"
      }
    ];
  } else {
    return [
      {
        displayName: "greeting",
        trainingPhrases: [
          { parts: [{ text: "Hello" }], repeatCount: 1 },
          { parts: [{ text: "Hi" }], repeatCount: 1 },
          { parts: [{ text: "Good morning" }], repeatCount: 1 },
          { parts: [{ text: "Good evening" }], repeatCount: 1 },
          { parts: [{ text: "Hey" }], repeatCount: 1 }
        ],
        response: greeting
      },
      {
        displayName: "schedule.appointment",
        trainingPhrases: [
          { parts: [{ text: "I want to schedule an appointment" }], repeatCount: 1 },
          { parts: [{ text: "Can I book a meeting" }], repeatCount: 1 },
          { parts: [{ text: "I need to make an appointment" }], repeatCount: 1 }
        ],
        response: "Sure! Let me check availability. What day and time works for you?",
        webhookTag: "check_availability"
      },
      {
        displayName: "check.availability",
        trainingPhrases: [
          { parts: [{ text: "When are you available" }], repeatCount: 1 },
          { parts: [{ text: "What are your working hours" }], repeatCount: 1 },
          { parts: [{ text: "Are you open today" }], repeatCount: 1 }
        ],
        response: "Let me check our availability...",
        webhookTag: "get_availability"
      },
      {
        displayName: "thanks",
        trainingPhrases: [
          { parts: [{ text: "Thank you" }], repeatCount: 1 },
          { parts: [{ text: "Thanks" }], repeatCount: 1 }
        ],
        response: "You're welcome! Is there anything else I can help with?"
      },
      {
        displayName: "goodbye",
        trainingPhrases: [
          { parts: [{ text: "Goodbye" }], repeatCount: 1 },
          { parts: [{ text: "Bye" }], repeatCount: 1 },
          { parts: [{ text: "Have a good day" }], repeatCount: 1 }
        ],
        response: "Thank you for contacting us! Have a great day!"
      }
    ];
  }
}

function createFaqIntents(faq: any[], language: string): IntentWithRoute[] {
  if (!faq || faq.length === 0) return [];
  
  return faq.map((item: any, index: number) => ({
    displayName: `faq.${index + 1}`,
    trainingPhrases: [
      { parts: [{ text: item.question }], repeatCount: 1 },
      // Add variations of the question
      ...(item.question.length > 10 ? [
        { parts: [{ text: item.question.split(' ').slice(0, 3).join(' ') }], repeatCount: 1 }
      ] : [])
    ],
    response: item.answer
  }));
}

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

## סגנון התשובה
${toneInstructions.he[tone] || toneInstructions.he.friendly}

## מידע על העסק
- שם העסק: ${businessName}
- סוג העסק: ${businessType}
${businessHours ? `- שעות פעילות: ${businessHours}` : ''}
${services.length > 0 ? `- שירותים: ${services.join(', ')}` : ''}
${profile?.address ? `- כתובת: ${profile.address}` : ''}
${profile?.phone ? `- טלפון: ${profile.phone}` : ''}

${faq.length > 0 ? `## שאלות נפוצות\n${faq.map((f: any) => `ש: ${f.question}\nת: ${f.answer}`).join('\n\n')}` : ''}

${customPrompt ? `## הוראות מיוחדות\n${customPrompt}` : ''}

## משימות עיקריות
1. ברך את הלקוח בחמימות ושאל במה אתה יכול לעזור
2. ענה על שאלות לגבי העסק והשירותים בהתבסס על המידע שלמעלה
3. עזור לקבוע פגישות - בדוק זמינות ואסוף פרטי לקוח (שם, טלפון, סוג שירות)
4. אם הלקוח מציג את עצמו, ברך אותו בשמו
5. אם אינך יודע תשובה, הצע ללקוח להשאיר הודעה

## כללים חשובים
- דבר תמיד בעברית באותיות עבריות בלבד (א-ת)
- אסור בשום פנים לכתוב עברית באותיות לטיניות
- היה קצר וענייני - משפט או שניים לכל תשובה
- היה אדיב ומקצועי
- אל תמציא מידע שלא נמסר לך
- השתמש בשם הלקוח אם הוא הזדהה`;
  } else if (language === 'ar') {
    return `أنت المساعد الافتراضي لـ ${businessName}، ${businessType}.

## أسلوب الإجابة
${toneInstructions.ar[tone] || toneInstructions.ar.friendly}

## معلومات العمل
- اسم العمل: ${businessName}
- نوع العمل: ${businessType}
${businessHours ? `- ساعات العمل: ${businessHours}` : ''}
${services.length > 0 ? `- الخدمات: ${services.join(', ')}` : ''}

${faq.length > 0 ? `## الأسئلة الشائعة\n${faq.map((f: any) => `س: ${f.question}\nج: ${f.answer}`).join('\n\n')}` : ''}

${customPrompt ? `## تعليمات خاصة\n${customPrompt}` : ''}

## المهام الرئيسية
1. رحب بالعميل بلطف واسأل كيف يمكنك المساعدة
2. أجب عن الأسئلة المتعلقة بالعمل والخدمات
3. ساعد في حجز المواعيد
4. إذا كنت لا تعرف الإجابة، اقترح على العميل ترك رسالة

## قواعد مهمة
- تحدث بالعربية فقط
- كن موجزاً ومباشراً
- كن مهذباً ومحترفاً`;
  } else {
    return `You are the virtual assistant of ${businessName}, a ${businessType}.

## Response Style
${toneInstructions.en[tone] || toneInstructions.en.friendly}

## Business Information
- Business Name: ${businessName}
- Business Type: ${businessType}
${businessHours ? `- Business Hours: ${businessHours}` : ''}
${services.length > 0 ? `- Services: ${services.join(', ')}` : ''}

${faq.length > 0 ? `## FAQ\n${faq.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}` : ''}

${customPrompt ? `## Special Instructions\n${customPrompt}` : ''}

## Main Tasks
1. Greet the customer warmly and ask how you can help
2. Answer questions about the business and services based on the information above
3. Help schedule appointments - check availability and collect customer details
4. If you don't know the answer, offer to take a message

## Important Rules
- Keep responses brief - one or two sentences
- Be polite and professional
- Don't make up information you weren't given
- Use the customer's name if they introduced themselves`;
  }
}
