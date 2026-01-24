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
    throw new Error(`Failed to get access token: ${await tokenResponse.text()}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

function getExpandedIntents(language: string) {
  return [
    {
      displayName: "greeting",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "שלום" }], repeatCount: 1 },
        { parts: [{ text: "היי" }], repeatCount: 1 },
        { parts: [{ text: "בוקר טוב" }], repeatCount: 1 },
        { parts: [{ text: "ערב טוב" }], repeatCount: 1 },
        { parts: [{ text: "אהלן" }], repeatCount: 1 },
        { parts: [{ text: "הלו" }], repeatCount: 1 },
        { parts: [{ text: "מה שלומך" }], repeatCount: 1 },
        { parts: [{ text: "מה נשמע" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Hello" }], repeatCount: 1 },
        { parts: [{ text: "Hi" }], repeatCount: 1 },
        { parts: [{ text: "Good morning" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "introduction",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "שלום אני אמיר" }], repeatCount: 1 },
        { parts: [{ text: "אני דוד" }], repeatCount: 1 },
        { parts: [{ text: "קוראים לי יוסי" }], repeatCount: 1 },
        { parts: [{ text: "שמי משה" }], repeatCount: 1 },
        { parts: [{ text: "אני שרה" }], repeatCount: 1 },
        { parts: [{ text: "שלום קוראים לי" }], repeatCount: 1 },
        { parts: [{ text: "השם שלי הוא" }], repeatCount: 1 },
        { parts: [{ text: "אני נועה" }], repeatCount: 1 },
        { parts: [{ text: "אני יעל" }], repeatCount: 1 },
        { parts: [{ text: "זה דני" }], repeatCount: 1 },
        { parts: [{ text: "היי אני" }], repeatCount: 1 },
        { parts: [{ text: "שלום שלום אני" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "My name is John" }], repeatCount: 1 },
        { parts: [{ text: "I'm David" }], repeatCount: 1 },
        { parts: [{ text: "This is Sarah speaking" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "schedule.appointment",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "אני רוצה לקבוע פגישה" }], repeatCount: 1 },
        { parts: [{ text: "אפשר לקבוע תור" }], repeatCount: 1 },
        { parts: [{ text: "מתי יש לכם מקום פנוי" }], repeatCount: 1 },
        { parts: [{ text: "אני רוצה להזמין תור" }], repeatCount: 1 },
        { parts: [{ text: "אני צריך לקבוע תור" }], repeatCount: 1 },
        { parts: [{ text: "רוצה לקבוע" }], repeatCount: 1 },
        { parts: [{ text: "צריך תור" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "I want to schedule an appointment" }], repeatCount: 1 },
        { parts: [{ text: "Can I book a meeting" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "check.availability",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "מתי אתם פנויים" }], repeatCount: 1 },
        { parts: [{ text: "מה הזמינות שלכם" }], repeatCount: 1 },
        { parts: [{ text: "מתי אפשר לבוא" }], repeatCount: 1 },
        { parts: [{ text: "באיזה שעות אתם עובדים" }], repeatCount: 1 },
        { parts: [{ text: "מה שעות הפעילות" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "When are you available" }], repeatCount: 1 },
        { parts: [{ text: "What are your working hours" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "business.info",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "מה השירותים שלכם" }], repeatCount: 1 },
        { parts: [{ text: "ספר לי על העסק" }], repeatCount: 1 },
        { parts: [{ text: "מה אתם מציעים" }], repeatCount: 1 },
        { parts: [{ text: "איפה אתם נמצאים" }], repeatCount: 1 },
        { parts: [{ text: "מה הכתובת שלכם" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "What services do you offer" }], repeatCount: 1 },
        { parts: [{ text: "Tell me about your business" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "thanks",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "תודה" }], repeatCount: 1 },
        { parts: [{ text: "תודה רבה" }], repeatCount: 1 },
        { parts: [{ text: "מעולה תודה" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Thank you" }], repeatCount: 1 },
        { parts: [{ text: "Thanks" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "goodbye",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "להתראות" }], repeatCount: 1 },
        { parts: [{ text: "ביי" }], repeatCount: 1 },
        { parts: [{ text: "יום טוב" }], repeatCount: 1 },
        { parts: [{ text: "כל טוב" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Goodbye" }], repeatCount: 1 },
        { parts: [{ text: "Bye" }], repeatCount: 1 }
      ]
    }
  ];
}

function buildSystemPrompt(profile: any, script: any, language: string): string {
  const businessName = profile?.business_name || 'העסק';
  const businessType = profile?.business_type || 'עסק';
  const services = script?.services || [];
  const faq = script?.faq || [];
  const tone = script?.tone || 'friendly';
  const businessHours = script?.business_hours || '';
  const customPrompt = script?.custom_prompt || '';

  const toneInstructions: Record<string, string> = {
    friendly: 'דבר בצורה חמה וידידותית',
    professional: 'דבר בצורה מקצועית ורשמית',
    casual: 'דבר בצורה קז\'ואלית ונינוחה',
    formal: 'דבר בצורה רשמית ומכובדת'
  };

  // Build services section with details
  const servicesSection = services.length > 0 
    ? `השירותים שלנו:\n${services.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}`
    : '';

  // Build FAQ section
  const faqSection = faq.length > 0 
    ? `שאלות נפוצות ותשובות:\n${faq.map((f: any) => `שאלה: ${f.question}\nתשובה: ${f.answer}`).join('\n\n')}`
    : '';

  return `אתה נציג מכירות ושירות לקוחות של ${businessName}.
${businessType ? `אנחנו ${businessType}.` : ''}

כללי זהות (חובה!):
- אתה נציג של ${businessName}, לא "עוזר AI כללי"
- כשנשאל "מה אתם עושים?" או "ספר לי על החברה" - תאר את ${businessName} ואת השירותים שלנו
- כשנשאל על מחירים/עלויות - השתמש במידע מהשאלות הנפוצות למטה
- אם אין לך מידע ספציפי על מחיר - אמור שנשמח לתת הצעת מחיר מותאמת אישית

${toneInstructions[tone] || toneInstructions.friendly}

פרטי העסק:
- שם: ${businessName}
- תחום: ${businessType}
${businessHours ? `- שעות פעילות: ${businessHours}` : ''}

${servicesSection}

${faqSection}

${customPrompt ? `הנחיות מיוחדות:\n${customPrompt}` : ''}

תפקידים עיקריים:
1. ברך את הלקוח בחביבות והצג את עצמך כנציג של ${businessName}
2. ענה על שאלות לגבי השירותים, המחירים והזמינות
3. עזור לקבוע פגישות ותורים
4. אם אינך יודע תשובה ספציפית - הצע ללקוח להשאיר פרטים ונחזור אליו

זיכרון שיחה (חשוב מאוד!):
- כאשר הלקוח אומר את שמו - זכור אותו והשתמש בו לאורך השיחה
- פנה ללקוח בשמו כשאתה יודע אותו (למשל: "אוקיי דני, אז אתה מתעניין ב...")
- זכור מה הלקוח ביקש או שאל קודם - אל תשאל שוב את אותן שאלות
- אם הלקוח חזר לנושא שכבר דיברתם עליו - התייחס לזה ("כפי שהזכרת קודם...")
- כשמסכמים או מסיימים שיחה - סכם את הנקודות העיקריות שהועלו

תמיכה רב-לשונית:
- זהה את שפת הדיבור של הלקוח (עברית, אנגלית, או ערבית)
- ענה תמיד באותה שפה שבה הלקוח פנה אליך
- אם הלקוח עובר שפה באמצע השיחה - עבור איתו בצורה חלקה

כללים חשובים:
- אם הלקוח דובר עברית - ענה בעברית באותיות עבריות בלבד
- אם הלקוח דובר אנגלית - ענה באנגלית
- אם הלקוח דובר ערבית - ענה בערבית
- היה קצר, ענייני ומקצועי`;
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

    const { user_id } = await req.json();
    
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials: GoogleCredentials = JSON.parse(credentialsJson);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!profile.dialogflow_agent_id) {
      return new Response(
        JSON.stringify({ error: 'No Dialogflow agent found for user' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get active script
    const { data: script } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .maybeSingle();

    const accessToken = await getAccessToken(credentials);
    const language = script?.language || 'he';
    const languageCode = language === 'he' ? 'he' : language === 'ar' ? 'ar' : 'en';
    const agentName = `projects/${projectId}/locations/global/agents/${profile.dialogflow_agent_id}`;

    console.log('Syncing agent for user:', user_id, 'agent:', profile.dialogflow_agent_id);

    // 0. First, add 'en' as a supported language to the agent (required for LLM)
    const addEnglishResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}?updateMask=supportedLanguageCodes`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: agentName,
          supportedLanguageCodes: ['en']
        })
      }
    );

    if (addEnglishResponse.ok) {
      console.log('Added English as supported language');
    } else {
      const errText = await addEnglishResponse.text();
      console.log('Note: Could not add English language (may already exist):', errText);
    }

    // 1. Update generative settings with LLM
    const systemPrompt = buildSystemPrompt(profile, script, language);
    const promptTemplateName = `${profile?.business_name || 'Business'} Agent`;
    
    console.log('📋 System Prompt (first 300 chars):', systemPrompt.substring(0, 300));
    console.log('📋 Business name in prompt:', profile?.business_name);
    console.log('📋 Prompt template name:', promptTemplateName);
    
    // CRITICAL: selectedPrompt must reference the displayName of a template in promptTemplates
    const generativeSettingsPayload = {
      name: `${agentName}/generativeSettings`,
      languageCode: 'en',
      fallbackSettings: {
        selectedPrompt: promptTemplateName,  // Reference to template displayName, NOT the prompt text!
        promptTemplates: [
          {
            displayName: promptTemplateName,
            promptText: systemPrompt,
            frozen: false
          }
        ]
      },
      llmModelSettings: {
        model: "",  // Empty string lets Dialogflow use default model
        promptText: systemPrompt
      },
      knowledgeConnectorSettings: {
        enabled: true,
        searchConfig: {
          maxSnippetCount: 3
        }
      }
    };

    console.log('📤 Sending generative settings payload...');

    const updateResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/generativeSettings?updateMask=fallbackSettings,llmModelSettings,knowledgeConnectorSettings`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(generativeSettingsPayload)
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('❌ Failed to update generative settings:', errorText);
    } else {
      const updateResult = await updateResponse.json();
      console.log('✅ Updated generative settings with LLM');
      console.log('📝 Response (first 300 chars):', JSON.stringify(updateResult).substring(0, 300));
    }

    // 2. Enable Generative Fallback on Default Start Flow
    const defaultFlowPath = `${agentName}/flows/00000000-0000-0000-0000-000000000000`;
    
    // Get current flow
    const flowResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${defaultFlowPath}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (flowResponse.ok) {
      const flowData = await flowResponse.json();
      const eventHandlers = flowData.eventHandlers || [];
      
      // Update event handlers with enableGenerativeFallback
      const updatedEventHandlers = eventHandlers.map((handler: any) => {
        if (handler.event === 'sys.no-match-default' || handler.event === 'sys.no-input-default') {
          return {
            ...handler,
            triggerFulfillment: {
              ...handler.triggerFulfillment,
              messages: [], // Remove static messages
              enableGenerativeFallback: true
            }
          };
        }
        return handler;
      });

      // Add handlers if they don't exist
      const hasNoMatch = updatedEventHandlers.some((h: any) => h.event === 'sys.no-match-default');
      const hasNoInput = updatedEventHandlers.some((h: any) => h.event === 'sys.no-input-default');

      if (!hasNoMatch) {
        updatedEventHandlers.push({
          event: 'sys.no-match-default',
          triggerFulfillment: {
            messages: [],
            enableGenerativeFallback: true
          }
        });
      }

      if (!hasNoInput) {
        updatedEventHandlers.push({
          event: 'sys.no-input-default',
          triggerFulfillment: {
            messages: [],
            enableGenerativeFallback: true
          }
        });
      }

      // Update the flow
      const flowUpdateResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${defaultFlowPath}?updateMask=eventHandlers`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: defaultFlowPath,
            eventHandlers: updatedEventHandlers
          })
        }
      );

      if (flowUpdateResponse.ok) {
        console.log('Updated Flow with enableGenerativeFallback');
      } else {
        const flowError = await flowUpdateResponse.text();
        console.error('Failed to update flow:', flowError);
      }
    }

    // 3. Update intents
    const listIntentsResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/intents`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    const existingIntentsData = await listIntentsResponse.json();
    const existingIntents = existingIntentsData.intents || [];
    
    const existingIntentsMap = new Map<string, string>();
    for (const intent of existingIntents) {
      existingIntentsMap.set(intent.displayName, intent.name);
    }

    const expandedIntents = getExpandedIntents(language);
    const results: { intent: string; action: string; success: boolean }[] = [];

    for (const intent of expandedIntents) {
      const existingIntentName = existingIntentsMap.get(intent.displayName);

      if (existingIntentName) {
        const updateRes = await fetch(
          `https://dialogflow.googleapis.com/v3/${existingIntentName}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              displayName: intent.displayName,
              trainingPhrases: intent.trainingPhrases,
            }),
          }
        );

        results.push({ 
          intent: intent.displayName, 
          action: updateRes.ok ? 'updated' : 'update_failed', 
          success: updateRes.ok 
        });
      } else {
        const createRes = await fetch(
          `https://dialogflow.googleapis.com/v3/${agentName}/intents`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(intent),
          }
        );

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error('Failed to create intent:', intent.displayName, errText);
        }

        results.push({ 
          intent: intent.displayName, 
          action: createRes.ok ? 'created' : 'create_failed', 
          success: createRes.ok 
        });
      }
    }

    // 4. Train the agent
    await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/flows/00000000-0000-0000-0000-000000000000:train`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Agent sync complete, results:', results);

    return new Response(
      JSON.stringify({ 
        success: true,
        agent_id: profile.dialogflow_agent_id,
        results,
        message: `Synced ${results.filter(r => r.success).length}/${results.length} intents`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error syncing agent:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
