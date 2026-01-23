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
    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY is not configured');
    }

    if (!ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY is not configured (needed for TTS)');
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

    // Parse body if present
    let body: any = {};
    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // Body is empty or invalid
    }
    const { voice_id, business_name, greeting_message, custom_prompt } = body;

    // Get user's profile for business info
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get user's active script for initial configuration
    const { data: script } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    const finalBusinessName = business_name || profile?.business_name || 'העסק שלי';
    const businessType = profile?.business_type || 'עסק';

    // Build initial system prompt
    const systemPrompt = buildSystemPrompt({
      businessName: finalBusinessName,
      businessType,
      profile,
      script,
      customPrompt: custom_prompt,
    });

    const finalGreeting = greeting_message || script?.greeting_message || `שלום! הגעתם ל${finalBusinessName}. איך אני יכול לעזור לכם?`;
    const finalVoiceId = voice_id || script?.voice_id || "JBFqnCBsd6RMkjVDRZzb"; // George - supports Hebrew
    const language = script?.language || "he";

    // Create the Assistant in Vapi
    // Key difference: Vapi uses Deepgram for STT (supports Hebrew), and ElevenLabs eleven_v3 for TTS (supports Hebrew!)
    const assistantPayload = {
      name: `Assistant - ${finalBusinessName}`,
      
      // Transcriber: Deepgram Nova-2 with Hebrew support
      // Transcriber: Deepgram Nova-2 with multilingual mode for Hebrew/Arabic
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: (language === "he" || language === "ar") ? "multi" : language,
      },
      
      // LLM: OpenAI GPT-4
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
              description: "Schedule an appointment for the caller. Use this when the customer wants to book an appointment.",
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
                    description: "The date of the appointment in YYYY-MM-DD format"
                  },
                  time: {
                    type: "string",
                    description: "The time of the appointment in HH:MM format"
                  },
                  service: {
                    type: "string",
                    description: "The type of service or reason for the appointment"
                  }
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
              description: "Get business availability and open hours. Use this when the customer asks about available times, business hours, or when they can schedule an appointment.",
              parameters: {
                type: "object",
                properties: {
                  date: {
                    type: "string",
                    description: "Optional: specific date to check availability (YYYY-MM-DD format)"
                  }
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
      
      // Voice: ElevenLabs - always use multilingual model for best Hebrew/Arabic quality
      voice: {
        provider: "11labs",
        voiceId: finalVoiceId,
        model: "eleven_multilingual_v2", // Always use multilingual for best Hebrew/Arabic quality
        stability: 0.6, // Slightly higher stability for clearer pronunciation
        similarityBoost: 0.8,
        style: 0.3, // Moderate style for natural speech
        useSpeakerBoost: true, // Enhance voice clarity
        optimizeStreamingLatency: 2, // Balance between latency and quality (0=best quality, 4=fastest)
      },
      
      // First message
      firstMessage: finalGreeting,
      
      // Server URL for webhooks
      serverUrl: `${SUPABASE_URL}/functions/v1/vapi-webhook`,
      
      // Additional settings
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 600, // 10 minutes max
      backgroundSound: "off",
      
      // Credentials for ElevenLabs
      voiceCredentialId: null // Will use default or you can set up in Vapi dashboard
    };

    console.log('Creating Vapi assistant with payload:', JSON.stringify(assistantPayload, null, 2));

    const createResponse = await fetch(
      'https://api.vapi.ai/assistant',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(assistantPayload),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('Vapi create assistant error:', createResponse.status, errorText);
      throw new Error(`Failed to create Vapi assistant: ${createResponse.status} - ${errorText}`);
    }

    const assistantData = await createResponse.json();
    const assistantId = assistantData.id;

    console.log('Created Vapi assistant:', assistantId);

    // Save assistant_id to user's profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ 
        vapi_assistant_id: assistantId,
        voice_provider: 'vapi' // Set provider to vapi
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Failed to save vapi_assistant_id to profile:', updateError);
    }

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
    console.error('Error creating Vapi assistant:', error);
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

// Helper function to build system prompt with multi-language support
function buildSystemPrompt(params: {
  businessName: string;
  businessType: string;
  profile: any;
  script: any;
  customPrompt?: string;
}): string {
  const { businessName, businessType, profile, script, customPrompt } = params;
  
  const businessPhone = profile?.phone || '';
  const services = script?.services || [];
  const faq = script?.faq || [];
  const tone = script?.tone || 'friendly';
  const businessHours = script?.business_hours || '';
  const language = script?.language || 'he';

  const languageConfig: Record<string, {
    intro: string;
    speakIn: string;
    businessInfo: string;
    services: string;
    faq: string;
    tasks: string;
    important: string;
    tones: Record<string, string>;
  }> = {
    he: {
      intro: 'אתה הסוכן הטלפוני של',
      speakIn: 'דבר תמיד בעברית',
      businessInfo: 'מידע על העסק',
      services: 'השירותים שלנו',
      faq: 'שאלות נפוצות',
      tasks: 'משימות עיקריות',
      important: 'חשוב',
      tones: {
        friendly: 'דבר בצורה חברית וחמה, עם חיוך בקול.',
        professional: 'דבר בצורה מקצועית ורצינית.',
        casual: 'דבר בצורה קלילה ולא פורמלית.',
        formal: 'דבר בצורה פורמלית ומכובדת.',
      }
    },
    ar: {
      intro: 'أنت الوكيل الهاتفي لـ',
      speakIn: 'تحدث دائماً بالعربية',
      businessInfo: 'معلومات العمل',
      services: 'خدماتنا',
      faq: 'الأسئلة الشائعة',
      tasks: 'المهام الرئيسية',
      important: 'مهم',
      tones: {
        friendly: 'تحدث بطريقة ودية ودافئة.',
        professional: 'تحدث بطريقة مهنية وجادة.',
        casual: 'تحدث بطريقة غير رسمية.',
        formal: 'تحدث بطريقة رسمية ومحترمة.',
      }
    },
    en: {
      intro: 'You are the phone agent for',
      speakIn: 'Always speak in English',
      businessInfo: 'Business Information',
      services: 'Our Services',
      faq: 'Frequently Asked Questions',
      tasks: 'Main Tasks',
      important: 'Important',
      tones: {
        friendly: 'Speak in a friendly and warm manner.',
        professional: 'Speak in a professional and serious manner.',
        casual: 'Speak in a casual and informal manner.',
        formal: 'Speak in a formal and respectful manner.',
      }
    }
  };

  const config = languageConfig[language] || languageConfig.he;
  const toneInstruction = config.tones[tone] || config.tones.friendly;

  const servicesString = services.length > 0 
    ? `${config.services}: ${services.join(', ')}` 
    : '';

  const faqString = faq.map((item: any) => {
    if (language === 'ar') {
      return `سؤال: ${item.question}\nجواب: ${item.answer}`;
    } else if (language === 'en') {
      return `Q: ${item.question}\nA: ${item.answer}`;
    }
    return `שאלה: ${item.question}\nתשובה: ${item.answer}`;
  }).join('\n\n');

  const tasksContent = language === 'ar' ? `
1. أجب على أسئلة العملاء حول العمل
2. حدد المواعيد للعملاء - استخدم أداة schedule_appointment
3. سجل تفاصيل المتصل وهدف المكالمة
4. إذا لم تعرف الإجابة، اعرض على العميل ترك رسالة` 
    : language === 'en' ? `
1. Answer customer questions about the business
2. Schedule appointments for customers - use the schedule_appointment tool
3. Document caller details and call purpose
4. If you don't know the answer, offer to take a message`
    : `
1. ענה על שאלות לקוחות בנוגע לעסק
2. קבע פגישות עבור לקוחות שמבקשים - השתמש בכלי schedule_appointment
3. תעד את פרטי המתקשר ואת מטרת השיחה
4. אם אינך יודע תשובה, הצע ללקוח להשאיר הודעה ונחזור אליו`;

  return `
${config.intro} ${businessName} - ${businessType}.
${toneInstruction}

${config.businessInfo}:
- ${language === 'ar' ? 'اسم العمل' : language === 'en' ? 'Business Name' : 'שם העסק'}: ${businessName}
- ${language === 'ar' ? 'نوع العمل' : language === 'en' ? 'Business Type' : 'סוג העסק'}: ${businessType}
${businessPhone ? `- ${language === 'ar' ? 'هاتف' : language === 'en' ? 'Phone' : 'טלפון'}: ${businessPhone}` : ''}
${businessHours ? `- ${language === 'ar' ? 'ساعات العمل' : language === 'en' ? 'Business Hours' : 'שעות פעילות'}: ${businessHours}` : ''}
${servicesString}

${faqString ? `${config.faq}:\n${faqString}` : ''}

${customPrompt ? `${language === 'ar' ? 'تعليمات إضافية' : language === 'en' ? 'Additional Instructions' : 'הנחיות נוספות'}:\n${customPrompt}` : ''}

${config.tasks}:
${tasksContent}

${config.important}:
- ${config.speakIn}
- ${language === 'ar' ? 'كن مهذباً ومحترفاً' : language === 'en' ? 'Be polite and professional' : 'היה אדיב ומקצועי'}
- ${language === 'ar' ? 'قبل تحديد موعد، تحقق من التوفر' : language === 'en' ? 'Before scheduling, check availability' : 'לפני קביעת פגישה, בדוק את הזמינות'}
- ${language === 'he' ? 'אם הלקוח מדבר בשפה אחרת (אנגלית או ערבית), זהה את השפה והמשך לדבר איתו בשפה שלו' : language === 'ar' ? 'إذا تحدث العميل بلغة أخرى (العبرية أو الإنجليزية)، حدد اللغة واستمر في التحدث بلغته' : 'If the caller speaks Hebrew or Arabic, detect their language and continue the conversation in their language'}
`.trim();
}
