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

  return `אתה עוזר וירטואלי של ${businessName}, ${businessType}.

${toneInstructions[tone] || toneInstructions.friendly}

מידע על העסק:
- שם העסק: ${businessName}
- סוג העסק: ${businessType}
${businessHours ? `- שעות פעילות: ${businessHours}` : ''}
${services.length > 0 ? `- שירותים: ${services.join(', ')}` : ''}

${faq.length > 0 ? `שאלות נפוצות:\n${faq.map((f: any) => `ש: ${f.question}\nת: ${f.answer}`).join('\n\n')}` : ''}

${customPrompt ? `הוראות נוספות:\n${customPrompt}` : ''}

משימות עיקריות:
1. ברך את הלקוח בחביבות
2. כשמישהו אומר את שמו - ברך אותו בשם ושאל איך תוכל לעזור
3. ענה על שאלות לגבי העסק והשירותים
4. עזור לקבוע פגישות
5. אם אינך יודע תשובה, הצע ללקוח להשאיר הודעה

חשוב מאוד:
- דבר תמיד בעברית באותיות עבריות בלבד (א-ת)
- אסור בשום פנים לכתוב עברית באותיות לטיניות
- היה קצר וענייני
- היה אדיב ומקצועי`;
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

    // 1. Update generative settings
    const systemPrompt = buildSystemPrompt(profile, script, language);
    const generativeSettings = {
      languageCode: languageCode,
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

    const updateResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/generativeSettings?updateMask=fallbackSettings`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(generativeSettings)
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Failed to update generative settings:', errorText);
    } else {
      console.log('Updated generative settings');
    }

    // 2. Update intents
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

    // 3. Train the agent
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
