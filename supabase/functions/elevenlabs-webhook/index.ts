import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkTenantRateLimit, createRateLimitResponse, getRateLimitHeaders } from "../_shared/tenant-rate-limiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get the incoming call data from ElevenLabs
    const callData = await req.json();
    const toNumber = callData.to_number || callData.phone_number;
    const fromNumber = callData.from_number || callData.caller_phone;

    console.log('Incoming call webhook:', { toNumber, fromNumber });

    if (!toNumber) {
      throw new Error('No to_number provided');
    }

    // Find the business by the ElevenLabs phone number
    const { data: phoneRecord, error: phoneError } = await supabase
      .from('phone_numbers')
      .select('*, profiles(*)')
      .eq('phone_number', toNumber)
      .eq('is_active', true)
      .single();

    if (phoneError || !phoneRecord) {
      console.error('Phone record not found:', phoneError);
      // Return a generic response for unknown numbers
      return new Response(
        JSON.stringify({
          prompt: "אתה עוזר טלפוני. הודע למתקשר שהמספר אינו פעיל כרגע ובקש ממנו לנסות שוב מאוחר יותר.",
          greeting: "שלום, מצטער אך המספר אינו זמין כרגע. נסה שוב מאוחר יותר.",
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = phoneRecord.user_id;
    const profile = phoneRecord.profiles;

    // Rate limiting for webhooks
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 
               req.headers.get('x-real-ip') || 
               'unknown';
    
    const rateLimitResult = await checkTenantRateLimit(
      supabase,
      userId,
      null,
      ip,
      'webhook'
    );

    if (!rateLimitResult.allowed) {
      console.log(`[elevenlabs-webhook] Rate limited: userId=${userId}, limitType=${rateLimitResult.limitType}`);
      const rateLimitHeaders = getRateLimitHeaders(rateLimitResult);
      return createRateLimitResponse('he', { ...corsHeaders, ...rateLimitHeaders });
    }

    // Get the active script for this user
    const { data: script } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    // Get user's availability
    const { data: availability } = await supabase
      .from('availability')
      .select('*')
      .eq('user_id', userId)
      .eq('is_available', true);

    // Build the dynamic prompt in Hebrew
    const businessName = profile?.business_name || 'העסק';
    const businessType = profile?.business_type || 'עסק';
    const businessPhone = profile?.phone || '';
    const services = script?.services || [];
    const faq = script?.faq || [];
    const tone = script?.tone || 'friendly';
    const businessHours = script?.business_hours || '';
    const customPrompt = script?.custom_prompt || '';
    const greetingMessage = script?.greeting_message || `שלום! הגעתם ל${businessName}. איך אני יכול לעזור לכם?`;

    // Build availability string
    const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const availabilityString = availability?.map(a => 
      `יום ${dayNames[a.day_of_week]}: ${a.start_time} - ${a.end_time}`
    ).join(', ') || 'לא הוגדרה זמינות';

    // Build FAQ string
    const faqString = faq.map((item: any) => 
      `שאלה: ${item.question}\nתשובה: ${item.answer}`
    ).join('\n\n');

    // Build services string
    const servicesString = services.length > 0 
      ? `השירותים שלנו: ${services.join(', ')}` 
      : '';

    // Determine tone instruction
    const toneInstructions: Record<string, string> = {
      friendly: 'דבר בצורה חברית וחמה, עם חיוך בקול.',
      professional: 'דבר בצורה מקצועית ורצינית.',
      casual: 'דבר בצורה קלילה ולא פורמלית.',
      formal: 'דבר בצורה פורמלית ומכובדת.',
    };
    const toneInstruction = toneInstructions[tone] || toneInstructions.friendly;

    // Build the complete prompt
    const systemPrompt = `
אתה הסוכן הטלפוני של ${businessName} - ${businessType}.
${toneInstruction}

מידע על העסק:
- שם העסק: ${businessName}
- סוג העסק: ${businessType}
- טלפון: ${businessPhone}
${businessHours ? `- שעות פעילות: ${businessHours}` : ''}
${servicesString}

זמינות לפגישות:
${availabilityString}

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
- לפני קביעת פגישה, בדוק את הזמינות המפורטת למעלה
- רשום את מספר הטלפון של המתקשר: ${fromNumber}
`.trim();

    // Save the call record
    const { data: callRecord, error: callError } = await supabase
      .from('calls')
      .insert({
        user_id: userId,
        call_type: 'inbound',
        caller_phone: fromNumber,
        status: 'in_progress',
        language: script?.language || 'he',
      })
      .select()
      .single();

    if (callError) {
      console.error('Failed to create call record:', callError);
    }

    return new Response(
      JSON.stringify({
        prompt: systemPrompt,
        greeting: greetingMessage,
        voice_id: script?.voice_id || null,
        call_id: callRecord?.id || null,
        user_id: userId,
        business_name: businessName,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        prompt: "אתה עוזר טלפוני. הודע למתקשר שאירעה שגיאה ובקש ממנו לנסות שוב מאוחר יותר.",
        greeting: "שלום, מצטער אך אירעה שגיאה. אנא נסה שוב מאוחר יותר.",
      }),
      { 
        status: 200, // Return 200 even on error so ElevenLabs gets a response
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});