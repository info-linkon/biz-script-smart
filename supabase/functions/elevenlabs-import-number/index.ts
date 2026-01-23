import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY is not configured');
    }

    // Validate auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with auth header for validation
    const supabaseAuth = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub;

    // Create service role client for database operations
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { phone_number, twilio_account_sid, twilio_auth_token, voice_id } = await req.json();

    if (!phone_number || !twilio_account_sid || !twilio_auth_token) {
      throw new Error('phone_number, twilio_account_sid, and twilio_auth_token are required');
    }

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
    }

    // Get user's active script
    const { data: script } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    let agentId = profile?.elevenlabs_agent_id;

    // Step 1: Create Agent if user doesn't have one
    if (!agentId) {
      console.log('Creating new agent for user:', userId);
      
      const businessName = profile?.business_name || 'העסק שלי';
      const businessType = profile?.business_type || 'עסק';
      
      const systemPrompt = buildSystemPrompt({
        businessName,
        businessType,
        profile,
        script,
      });

      const greetingMessage = script?.greeting_message || 
        `שלום! הגעתם ל${businessName}. איך אני יכול לעזור לכם?`;

      const agentPayload = {
        name: `Assistant - ${businessName}`,
        conversation_config: {
          agent: {
            prompt: {
              prompt: systemPrompt,
              tools: [
                {
                  type: "webhook",
                  name: "schedule_appointment",
                  description: "Schedule an appointment for the caller",
                  webhook: {
                    url: `${SUPABASE_URL}/functions/v1/elevenlabs-schedule-appointment`,
                    method: "POST",
                  },
                  parameters: {
                    type: "object",
                    properties: {
                      customer_name: {
                        type: "string",
                        description: "The name of the customer"
                      },
                      customer_phone: {
                        type: "string",
                        description: "The phone number of the customer"
                      },
                      date: {
                        type: "string",
                        description: "The date of the appointment (YYYY-MM-DD format)"
                      },
                      time: {
                        type: "string",
                        description: "The time of the appointment (HH:MM format)"
                      },
                      service: {
                        type: "string",
                        description: "The type of service or reason for the appointment"
                      }
                    },
                    required: ["customer_name", "customer_phone", "date", "time"]
                  }
                }
              ]
            },
            first_message: greetingMessage,
            language: script?.language || "he"
          },
          tts: {
            voice_id: voice_id || script?.voice_id || "21m00Tcm4TlvDq8ikWAM"
          }
        }
      };

      const createAgentResponse = await fetch(
        'https://api.elevenlabs.io/v1/convai/agents/create',
        {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(agentPayload),
        }
      );

      if (!createAgentResponse.ok) {
        const errorText = await createAgentResponse.text();
        console.error('ElevenLabs create agent error:', createAgentResponse.status, errorText);
        throw new Error(`Failed to create agent: ${createAgentResponse.status}`);
      }

      const agentData = await createAgentResponse.json();
      agentId = agentData.agent_id;
      console.log('Created agent:', agentId);

      // Save agent_id to profile
      await supabase
        .from('profiles')
        .update({ elevenlabs_agent_id: agentId })
        .eq('user_id', userId);
    }

    // Step 2: Import the phone number from Twilio to ElevenLabs
    console.log('Importing phone number from Twilio:', phone_number);
    
    const importPayload = {
      phone_number: phone_number,
      provider: "twilio",
      label: `Business Line - ${profile?.business_name || 'Main'}`,
      sid: twilio_account_sid,
      token: twilio_auth_token,
      agent_id: agentId,
    };

    const importResponse = await fetch(
      'https://api.elevenlabs.io/v1/convai/phone-numbers/create',
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(importPayload),
      }
    );

    if (!importResponse.ok) {
      const errorText = await importResponse.text();
      console.error('ElevenLabs import error:', importResponse.status, errorText);
      throw new Error(`Failed to import number: ${importResponse.status} - ${errorText}`);
    }

    const importData = await importResponse.json();
    const importedPhoneId = importData.phone_number_id || importData.id;

    console.log('Imported phone number, ID:', importedPhoneId);

    // Step 3: Save to database
    const { data: phoneRecord, error: dbError } = await supabase
      .from('phone_numbers')
      .insert({
        user_id: userId,
        elevenlabs_phone_id: importedPhoneId,
        elevenlabs_agent_id: agentId,
        phone_number: phone_number,
        country_code: phone_number.startsWith('+972') ? 'IL' : 'US',
        status: 'active',
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Failed to save phone number to database');
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        phone_number: phoneRecord,
        agent_id: agentId,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error importing number:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Helper function to build system prompt
function buildSystemPrompt(params: {
  businessName: string;
  businessType: string;
  profile: any;
  script: any;
}): string {
  const { businessName, businessType, profile, script } = params;
  
  const businessPhone = profile?.phone || '';
  const services = script?.services || [];
  const faq = script?.faq || [];
  const tone = script?.tone || 'friendly';
  const businessHours = script?.business_hours || '';
  const customPrompt = script?.custom_prompt || '';

  const servicesString = services.length > 0 
    ? `השירותים שלנו: ${services.join(', ')}` 
    : '';

  const faqString = faq.map((item: any) => 
    `שאלה: ${item.question}\nתשובה: ${item.answer}`
  ).join('\n\n');

  const toneInstructions: Record<string, string> = {
    friendly: 'דבר בצורה חברית וחמה, עם חיוך בקול.',
    professional: 'דבר בצורה מקצועית ורצינית.',
    casual: 'דבר בצורה קלילה ולא פורמלית.',
    formal: 'דבר בצורה פורמלית ומכובדת.',
  };
  const toneInstruction = toneInstructions[tone] || toneInstructions.friendly;

  return `
אתה הסוכן הטלפוני של ${businessName} - ${businessType}.
${toneInstruction}

מידע על העסק:
- שם העסק: ${businessName}
- סוג העסק: ${businessType}
${businessPhone ? `- טלפון: ${businessPhone}` : ''}
${businessHours ? `- שעות פעילות: ${businessHours}` : ''}
${servicesString}

${faqString ? `שאלות נפוצות:\n${faqString}` : ''}

${customPrompt ? `הנחיות נוספות:\n${customPrompt}` : ''}

משימות עיקריות:
1. ענה על שאלות לקוחות בנוגע לעסק
2. קבע פגישות עבור לקוחות שמבקשים - השתמש בכלי schedule_appointment
3. תעד את פרטי המתקשר ואת מטרת השיחה
4. אם אינך יודע תשובה, הצע ללקוח להשאיר הודעה ונחזור אליו

חשוב:
- דבר תמיד בעברית
- היה אדיב ומקצועי
- לפני קביעת פגישה, בדוק את הזמינות
`.trim();
}
