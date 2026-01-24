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

    // Build update payload with auto language detection
    const updatePayload: any = {
      conversation_config: {
        agent: {
          prompt: {
            prompt: systemPrompt,
            tools: [
              {
                type: "system",
                name: "language_detection",
                description: "Automatically detect and switch to the caller's language"
              }
            ]
          },
          first_message: script.greeting_message || `שלום! הגעתם ל${profile.business_name || 'העסק'}. איך אני יכול לעזור לכם?`,
          language: script.language || "he",
          supported_languages: ["he", "ar", "en"]
        }
      }
    };

    // Always include TTS config with model_id to upgrade existing agents
    const finalVoiceId = voice_id || script.voice_id || "JBFqnCBsd6RMkjVDRZzb";
    updatePayload.conversation_config.tts = {
      voice_id: finalVoiceId
    };

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

// Helper function to build system prompt - ISRAELI SPONTANEOUS STYLE
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
  const businessHours = script?.business_hours || '';
  const customPrompt = script?.custom_prompt || '';
  const language = script?.language || 'he';

  const servicesString = services.length > 0 ? services.join(', ') : '';

  const faqString = faq.map((item: any) => 
    `ש: ${item.question} → ${item.answer}`
  ).join('\n');

  // Hebrew - Israeli spontaneous style
  if (language === 'he') {
    return `אתה נציג של ${businessName}. דבר כמו ישראלי אמיתי - קצר, חם, ספונטני.

## סגנון:
- משפטים קצרים. מקסימום 10-15 מילים.
- כמו חבר בטלפון, לא רובוט.
- מילות קישור: "אוקיי", "יאללה", "רגע", "תשמע", "אין בעיה", "סבבה"
- תגובות: "בטח", "כן", "ברור", "מעולה"
- לא לחזור על מה שהלקוח אמר.

## דוגמאות:
❌ "אני מאוד שמח לעזור לך היום בכל שאלה"
✅ "מה קורה? איך אפשר לעזור?"

❌ "בהחלט אשמח לבדוק עבורך את הזמינות"
✅ "אוקיי, רגע בודק. מתי נוח?"

❌ "האם יש משהו נוסף שאוכל לסייע?"
✅ "עוד משהו?"

## כללים:
1. לעולם לא להגיד שאתה AI/בינה מלאכותית
2. תשובות קצרות - זו שיחה, לא מייל
3. לא יודע? "רגע אני בודק" או "נחזור אליך"
4. לפני תור - תבדוק זמינות עם get_availability
5. לקבוע תור - השתמש ב-schedule_appointment

## העסק: ${businessName}
${businessType ? `סוג: ${businessType}` : ''}
${businessPhone ? `טל: ${businessPhone}` : ''}
${businessHours ? `שעות: ${businessHours}` : ''}
${servicesString ? `שירותים: ${servicesString}` : ''}

${faqString ? `## FAQ:\n${faqString}` : ''}
${customPrompt ? `## הנחיות:\n${customPrompt}` : ''}`.trim();
  }

  // Arabic
  if (language === 'ar') {
    return `أنت ممثل ${businessName}. تحدث بشكل طبيعي - جمل قصيرة، ودود.

## الأسلوب:
- جمل قصيرة. 10-15 كلمة.
- مثل صديق على الهاتف.
- "طيب", "خلاص", "لحظة", "تمام"

## القواعد:
1. لا تقل أبداً أنك AI
2. إجابات قصيرة
3. لا تعرف؟ "لحظة أتحقق"

## العمل: ${businessName}
${businessPhone ? `هاتف: ${businessPhone}` : ''}
${servicesString ? `خدمات: ${servicesString}` : ''}

${faqString ? `## أسئلة:\n${faqString}` : ''}`.trim();
  }

  // English
  return `You're a rep for ${businessName}. Talk naturally - short, warm, spontaneous.

## Style:
- Short sentences. Max 10-15 words.
- Like a friend on the phone.
- "sure", "okay", "one sec", "got it"

## Examples:
❌ "I would be happy to assist you with any questions"
✅ "Hey! How can I help?"

## Rules:
1. Never say you're AI
2. Short answers - it's a call
3. Don't know? "Let me check"

## Business: ${businessName}
${businessPhone ? `Phone: ${businessPhone}` : ''}
${servicesString ? `Services: ${servicesString}` : ''}

${faqString ? `## FAQ:\n${faqString}` : ''}`.trim();
}
