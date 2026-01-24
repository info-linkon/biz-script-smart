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

    // Get user profile
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

    if (!profile.dialogflow_agent_id) {
      return new Response(
        JSON.stringify({ error: 'No Dialogflow agent found. Please create one first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get active script
    const { data: script } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    const accessToken = await getAccessToken(credentials);
    const language = script?.language || 'he';
    const agentName = `projects/${projectId}/locations/global/agents/${profile.dialogflow_agent_id}`;

    // Build updated system prompt
    const systemPrompt = buildSystemPrompt(profile, script, language);

    // Map language code for Dialogflow
    const languageCode = language === 'he' ? 'he' : language === 'ar' ? 'ar' : 'en';

    // Update generative settings with new prompt, language code, AND LLM settings
    // IMPORTANT: LLM settings must use 'en' language code even for Hebrew/Arabic
    // The system prompt instructs the model to respond in the target language
    const generativeSettings = {
      languageCode: 'en', // LLM only supports 'en' - but system prompt tells it to respond in Hebrew/Arabic
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
        // CRITICAL: Enable LLM for natural conversation
        llmModelSettings: {
          model: "gemini-1.5-flash",
          promptText: systemPrompt
        },
        knowledgeConnectorSettings: {
          enabled: true,
          searchConfig: {
            maxSnippetCount: 3
          }
        }
      }
    };

    console.log('🔄 Updating generative settings with LLM enabled (using en for LLM, prompting for', language, ')...');

    const updateResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/generativeSettings?updateMask=fallbackSettings,llmModelSettings,knowledgeConnectorSettings`,
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
      console.error('❌ Failed to update generative settings:', errorText);
    } else {
      console.log('✅ Generative settings updated with LLM');
    }

    // Enable Generative Fallback on the Default Start Flow
    const flowName = `${agentName}/flows/00000000-0000-0000-0000-000000000000`;
    
    // First, get the current flow to preserve existing routes
    const flowResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${flowName}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        }
      }
    );

    if (flowResponse.ok) {
      const flowData = await flowResponse.json();
      console.log('📋 Current flow name:', flowData.name);
      console.log('📋 Current event handlers:', JSON.stringify(flowData.eventHandlers || []));

      // Create new event handlers with Generative Fallback enabled
      // CRITICAL: Remove static messages and enable LLM response
      const newEventHandlers = [
        {
          name: flowData.eventHandlers?.find((h: any) => h.event === 'sys.no-match-default')?.name || undefined,
          event: 'sys.no-match-default',
          triggerFulfillment: {
            // NO static messages - let the LLM respond
            messages: [],
            // CRITICAL: Enable Generative Fallback
            enableGenerativeFallback: true
          }
        },
        {
          name: flowData.eventHandlers?.find((h: any) => h.event === 'sys.no-input-default')?.name || undefined,
          event: 'sys.no-input-default',
          triggerFulfillment: {
            messages: [
              {
                text: {
                  text: [language === 'he' ? 
                    "האם אתה עדיין שם? איך אוכל לעזור?" : 
                    language === 'ar' ? 
                    "هل ما زلت هناك؟" :
                    "Are you still there?"]
                }
              }
            ]
          }
        }
      ];

      console.log('🔧 Setting new event handlers with enableGenerativeFallback:', JSON.stringify(newEventHandlers));

      // Update the flow with new event handlers
      const flowUpdatePayload = {
        name: flowName,
        displayName: flowData.displayName || "Default Start Flow",
        eventHandlers: newEventHandlers,
        transitionRoutes: flowData.transitionRoutes || []
      };

      const flowUpdateResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${flowName}?updateMask=eventHandlers`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(flowUpdatePayload)
        }
      );

      if (flowUpdateResponse.ok) {
        const updatedFlow = await flowUpdateResponse.json();
        console.log('✅ Flow updated. New event handlers:', JSON.stringify(updatedFlow.eventHandlers || []));
      } else {
        const flowError = await flowUpdateResponse.text();
        console.error('❌ Failed to update flow handlers:', flowError);
      }
    } else {
      console.error('❌ Failed to get flow:', await flowResponse.text());
    }

    // Train the agent to apply changes (using correct flow path)
    const defaultFlowPath = `${agentName}/flows/00000000-0000-0000-0000-000000000000`;
    console.log('🎓 Training agent flow:', defaultFlowPath);
    
    const trainResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${defaultFlowPath}:train`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
      }
    );

    if (trainResponse.ok) {
      console.log('✅ Agent training started');
    } else {
      const trainError = await trainResponse.text();
      console.error('⚠️ Training failed:', trainError);
      // Training is optional - continue anyway
    }

    // Voice settings update (moved from original location)

    // Update voice settings if voice_id changed
    if (script?.voice_id) {
      const languageCode = language === 'he' ? 'he-IL' : language === 'ar' ? 'ar-XA' : 'en-US';
      
      const agentPayload = {
        textToSpeechSettings: {
          synthesizeSpeechConfigs: {
            [languageCode]: {
              voice: {
                name: script.voice_id
              },
              audioEncoding: "OUTPUT_AUDIO_ENCODING_LINEAR_16"
            }
          }
        }
      };

      await fetch(
        `https://dialogflow.googleapis.com/v3/${agentName}?updateMask=textToSpeechSettings`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(agentPayload)
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Agent updated successfully',
        agent_id: profile.dialogflow_agent_id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error updating Dialogflow agent:', error);
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
3. עזור לקבוע פגישות
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
2. أجب عن الأسئلة
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
2. Answer questions about the business
3. Help schedule appointments
4. If you don't know the answer, offer to take a message`;
  }
}
