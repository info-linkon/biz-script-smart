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
    const VAPI_API_KEY = Deno.env.get('VAPI_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY is not configured');
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

    const { script_id, voice_id } = await req.json();

    // Get user's profile with vapi_assistant_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile?.vapi_assistant_id) {
      throw new Error('No Vapi assistant found for this user. Please create one first.');
    }

    const assistantId = profile.vapi_assistant_id;

    // Get the script to update from
    const { data: script, error: scriptError } = await supabase
      .from('scripts')
      .select('*')
      .eq('id', script_id)
      .eq('user_id', userId)
      .single();

    if (scriptError || !script) {
      throw new Error('Script not found');
    }

    // Build updated system prompt
    const systemPrompt = buildSystemPrompt({
      businessName: profile.business_name || 'העסק שלי',
      businessType: profile.business_type || 'עסק',
      profile,
      script,
    });

    const finalVoiceId = voice_id || script.voice_id || "JBFqnCBsd6RMkjVDRZzb";
    const language = script.language || "he";

    // Build update payload for Vapi
    const updatePayload: any = {
      // Update transcriber language
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: language === "he" ? "he" : language === "ar" ? "ar" : "en",
      },
      
      // Update LLM with new system prompt
      model: {
        provider: "openai",
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: systemPrompt
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "schedule_appointment",
              description: "Schedule an appointment for the caller.",
              parameters: {
                type: "object",
                properties: {
                  customer_name: { type: "string", description: "The name of the customer" },
                  customer_phone: { type: "string", description: "The phone number of the customer" },
                  date: { type: "string", description: "The date in YYYY-MM-DD format" },
                  time: { type: "string", description: "The time in HH:MM format" },
                  service: { type: "string", description: "The type of service" }
                },
                required: ["customer_name", "date", "time"]
              }
            },
            server: {
              url: `${SUPABASE_URL}/functions/v1/elevenlabs-schedule-appointment`
            }
          },
          {
            type: "function",
            function: {
              name: "get_availability",
              description: "Get business availability and open hours.",
              parameters: {
                type: "object",
                properties: {
                  date: { type: "string", description: "Optional: specific date (YYYY-MM-DD format)" }
                },
                required: []
              }
            },
            server: {
              url: `${SUPABASE_URL}/functions/v1/elevenlabs-get-availability`
            }
          }
        ]
      },
      
      // Update voice
      voice: {
        provider: "11labs",
        voiceId: finalVoiceId,
        model: "eleven_turbo_v2_5",
        stability: 0.5,
        similarityBoost: 0.75
      },
      
      // Update first message
      firstMessage: script.greeting_message || `שלום! הגעתם ל${profile.business_name || 'העסק'}. איך אני יכול לעזור לכם?`,
    };

    console.log('Updating Vapi assistant:', assistantId);

    const updateResponse = await fetch(
      `https://api.vapi.ai/assistant/${assistantId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Vapi update assistant error:', updateResponse.status, errorText);
      throw new Error(`Failed to update Vapi assistant: ${updateResponse.status}`);
    }

    const assistantData = await updateResponse.json();

    console.log('Updated Vapi assistant successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        assistant_id: assistantId,
        assistant: assistantData,
        provider: 'vapi'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error updating Vapi assistant:', error);
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
  const language = script?.language || 'he';

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

  const languageInstruction = language === 'he' 
    ? 'דבר תמיד בעברית' 
    : language === 'ar' 
    ? 'تحدث دائماً بالعربية' 
    : 'Always speak in English';

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
- ${languageInstruction}
- היה אדיב ומקצועי
- לפני קביעת פגישה, בדוק את הזמינות
- אם הלקוח מדבר בשפה אחרת, זהה את השפה והמשך לדבר איתו בשפה שלו
`.trim();
}
