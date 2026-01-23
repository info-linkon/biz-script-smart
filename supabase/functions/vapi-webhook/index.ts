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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get the incoming call data from Vapi
    const callData = await req.json();
    
    console.log('Vapi webhook received:', JSON.stringify(callData, null, 2));

    // Vapi sends different event types
    const eventType = callData.message?.type || callData.type;

    // Handle different Vapi webhook events
    switch (eventType) {
      case 'assistant-request':
        // Vapi is requesting assistant configuration for an incoming call
        return handleAssistantRequest(supabase, callData, SUPABASE_URL!);
      
      case 'function-call':
        // Vapi is calling a function/tool
        return handleFunctionCall(supabase, callData, SUPABASE_URL!);
      
      case 'status-update':
        // Call status update (started, ended, etc.)
        return handleStatusUpdate(supabase, callData);
      
      case 'end-of-call-report':
        // Call ended, final report
        return handleEndOfCallReport(supabase, callData);
      
      case 'hang':
        // Call was hung up
        return handleHangup(supabase, callData);
      
      case 'speech-update':
        // Transcript update
        return handleSpeechUpdate(supabase, callData);
      
      default:
        console.log('Unknown Vapi event type:', eventType);
        return new Response(
          JSON.stringify({ success: true, message: 'Event acknowledged' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('Vapi webhook error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 200, // Return 200 even on error so Vapi doesn't retry
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Handle assistant-request: Return dynamic assistant configuration
async function handleAssistantRequest(supabase: any, callData: any, supabaseUrl: string) {
  const phoneNumber = callData.message?.call?.phoneNumber?.number || 
                      callData.call?.phoneNumber?.number ||
                      callData.phoneNumber;
  const callerNumber = callData.message?.call?.customer?.number ||
                       callData.call?.customer?.number ||
                       callData.customer?.number;

  console.log('Assistant request for phone:', phoneNumber, 'from:', callerNumber);

  if (!phoneNumber) {
    return new Response(
      JSON.stringify({ error: 'No phone number provided' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Find the business by phone number
  const { data: phoneRecord, error: phoneError } = await supabase
    .from('phone_numbers')
    .select('*, profiles(*)')
    .eq('phone_number', phoneNumber)
    .eq('is_active', true)
    .single();

  if (phoneError || !phoneRecord) {
    console.error('Phone record not found:', phoneError);
    return new Response(
      JSON.stringify({
        assistant: {
          firstMessage: "מצטער, המספר אינו פעיל כרגע. נסה שוב מאוחר יותר.",
          model: {
            provider: "openai",
            model: "gpt-4",
            messages: [{ role: "system", content: "Tell the caller the number is not active." }]
          },
          voice: { provider: "11labs", voiceId: "JBFqnCBsd6RMkjVDRZzb" }
        }
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  const userId = phoneRecord.user_id;
  const profile = phoneRecord.profiles;

  // Get the active script
  const { data: script } = await supabase
    .from('scripts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  // Build dynamic assistant configuration
  const businessName = profile?.business_name || 'העסק';
  const greetingMessage = script?.greeting_message || `שלום! הגעתם ל${businessName}. איך אני יכול לעזור לכם?`;
  const language = script?.language || 'he';

  // Create call record
  const { data: callRecord } = await supabase
    .from('calls')
    .insert({
      user_id: userId,
      call_type: 'inbound',
      caller_phone: callerNumber,
      status: 'in_progress',
      language: language,
    })
    .select()
    .single();

  // Return dynamic assistant configuration to Vapi
  return new Response(
    JSON.stringify({
      assistant: {
        firstMessage: greetingMessage,
        transcriber: {
          provider: "deepgram",
          model: "nova-2",
          language: language === "he" ? "he" : language === "ar" ? "ar" : "en"
        },
        model: {
          provider: "openai",
          model: "gpt-4",
          messages: [{ 
            role: "system", 
            content: buildDynamicPrompt(profile, script, callerNumber) 
          }],
          tools: [
            {
              type: "function",
              function: {
                name: "schedule_appointment",
                description: "Schedule an appointment for the caller.",
                parameters: {
                  type: "object",
                  properties: {
                    customer_name: { type: "string" },
                    customer_phone: { type: "string" },
                    date: { type: "string" },
                    time: { type: "string" },
                    service: { type: "string" }
                  },
                  required: ["customer_name", "date", "time"]
                }
              },
              server: { url: `${supabaseUrl}/functions/v1/elevenlabs-schedule-appointment` }
            },
            {
              type: "function",
              function: {
                name: "get_availability",
                description: "Get business availability.",
                parameters: {
                  type: "object",
                  properties: { date: { type: "string" } },
                  required: []
                }
              },
              server: { url: `${supabaseUrl}/functions/v1/elevenlabs-get-availability` }
            }
          ]
        },
        voice: {
          provider: "11labs",
          voiceId: script?.voice_id || "JBFqnCBsd6RMkjVDRZzb",
          model: "eleven_turbo_v2_5"
        },
        silenceTimeoutSeconds: 30,
        maxDurationSeconds: 600
      },
      // Pass metadata for later use
      metadata: {
        call_id: callRecord?.id,
        user_id: userId,
        business_name: businessName
      }
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// Handle function calls from Vapi
async function handleFunctionCall(supabase: any, callData: any, supabaseUrl: string) {
  const functionCall = callData.message?.functionCall || callData.functionCall;
  const functionName = functionCall?.name;
  const parameters = functionCall?.parameters || {};

  console.log('Function call:', functionName, parameters);

  // Forward to the appropriate webhook
  let targetUrl = '';
  if (functionName === 'schedule_appointment') {
    targetUrl = `${supabaseUrl}/functions/v1/elevenlabs-schedule-appointment`;
  } else if (functionName === 'get_availability') {
    targetUrl = `${supabaseUrl}/functions/v1/elevenlabs-get-availability`;
  }

  if (targetUrl) {
    // Add source identifier for the webhook to know it's from Vapi
    const payload = {
      ...parameters,
      _source: 'vapi',
      _call_data: callData.message?.call || callData.call
    };

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    return new Response(
      JSON.stringify({ result: result }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ error: 'Unknown function' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );
}

// Handle status updates
async function handleStatusUpdate(supabase: any, callData: any) {
  const status = callData.message?.status || callData.status;
  const callId = callData.message?.call?.id || callData.call?.id;
  
  console.log('Status update:', status, 'for call:', callId);
  
  return new Response(
    JSON.stringify({ success: true }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// Handle end of call report
async function handleEndOfCallReport(supabase: any, callData: any) {
  const report = callData.message || callData;
  const metadata = report.call?.metadata || {};
  
  console.log('End of call report:', JSON.stringify(report, null, 2));

  // Update the call record if we have a call_id
  if (metadata.call_id) {
    const duration = report.durationSeconds || report.call?.duration;
    const transcript = report.transcript || report.messages;
    const summary = report.summary;

    await supabase
      .from('calls')
      .update({
        status: 'completed',
        duration_seconds: duration,
        transcript: transcript,
        summary: summary
      })
      .eq('id', metadata.call_id);
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// Handle hangup
async function handleHangup(supabase: any, callData: any) {
  console.log('Call hung up:', callData);
  return new Response(
    JSON.stringify({ success: true }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// Handle speech/transcript updates
async function handleSpeechUpdate(supabase: any, callData: any) {
  // Could be used for real-time transcript updates
  return new Response(
    JSON.stringify({ success: true }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// Build dynamic prompt for the assistant
function buildDynamicPrompt(profile: any, script: any, callerNumber: string): string {
  const businessName = profile?.business_name || 'העסק';
  const businessType = profile?.business_type || 'עסק';
  const businessPhone = profile?.phone || '';
  const services = script?.services || [];
  const faq = script?.faq || [];
  const tone = script?.tone || 'friendly';
  const businessHours = script?.business_hours || '';
  const customPrompt = script?.custom_prompt || '';

  const toneInstructions: Record<string, string> = {
    friendly: 'דבר בצורה חברית וחמה, עם חיוך בקול.',
    professional: 'דבר בצורה מקצועית ורצינית.',
    casual: 'דבר בצורה קלילה ולא פורמלית.',
    formal: 'דבר בצורה פורמלית ומכובדת.',
  };

  const servicesString = services.length > 0 ? `השירותים שלנו: ${services.join(', ')}` : '';
  const faqString = faq.map((item: any) => `שאלה: ${item.question}\nתשובה: ${item.answer}`).join('\n\n');

  return `
אתה הסוכן הטלפוני של ${businessName} - ${businessType}.
${toneInstructions[tone] || toneInstructions.friendly}

מידע על העסק:
- שם העסק: ${businessName}
- סוג העסק: ${businessType}
- טלפון: ${businessPhone}
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
- מספר הטלפון של המתקשר: ${callerNumber}
`.trim();
}
