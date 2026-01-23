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

    const { script_id, voice_id } = await req.json();

    // Get user's profile with agent_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile?.elevenlabs_agent_id) {
      throw new Error('No agent found for this user. Please purchase a phone number first.');
    }

    const agentId = profile.elevenlabs_agent_id;

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

    // Build update payload
    const updatePayload: any = {
      conversation_config: {
        agent: {
          prompt: {
            prompt: systemPrompt,
          },
          first_message: script.greeting_message || `שלום! הגעתם ל${profile.business_name || 'העסק'}. איך אני יכול לעזור לכם?`,
          language: script.language || "he"
        }
      }
    };

    // Add voice_id if provided or if script has one
    const finalVoiceId = voice_id || script.voice_id;
    if (finalVoiceId) {
      updatePayload.conversation_config.tts = {
        voice_id: finalVoiceId
      };
    }

    console.log('Updating agent:', agentId, 'with payload:', JSON.stringify(updatePayload, null, 2));

    const updateResponse = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${agentId}`,
      {
        method: 'PATCH',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('ElevenLabs update agent error:', updateResponse.status, errorText);
      throw new Error(`Failed to update agent: ${updateResponse.status}`);
    }

    const agentData = await updateResponse.json();

    console.log('Updated agent successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        agent_id: agentId,
        agent: agentData
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error updating agent:', error);
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
