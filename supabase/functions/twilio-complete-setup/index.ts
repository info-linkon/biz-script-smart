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
    const VAPI_API_KEY = Deno.env.get('VAPI_API_KEY');
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials are not configured');
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

    const { country_code, voice_provider = 'elevenlabs' } = await req.json();

    if (!country_code) {
      throw new Error('country_code is required');
    }

    // Validate provider and check required API keys
    if (voice_provider === 'elevenlabs' && !ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY is not configured');
    }
    if (voice_provider === 'vapi' && !VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY is not configured');
    }

    console.log(`Setting up phone with provider: ${voice_provider}`);

    // Twilio auth header
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    // Step 1: Search for available phone numbers
    console.log('Searching for available numbers in:', country_code);
    
    const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/${country_code}/Local.json?PageSize=1`;
    
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Basic ${twilioAuth}`,
      },
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Twilio search error:', searchResponse.status, errorText);
      throw new Error(`Failed to search for numbers: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    
    if (!searchData.available_phone_numbers || searchData.available_phone_numbers.length === 0) {
      throw new Error(`No available phone numbers in ${country_code}`);
    }

    const availableNumber = searchData.available_phone_numbers[0];
    console.log('Found available number:', availableNumber.phone_number);

    // Step 2: Purchase the phone number
    console.log('Purchasing phone number:', availableNumber.phone_number);
    
    const purchaseUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`;
    
    const purchaseResponse = await fetch(purchaseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${twilioAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        PhoneNumber: availableNumber.phone_number,
        FriendlyName: `VoiceAI - ${userId.substring(0, 8)}`,
      }),
    });

    if (!purchaseResponse.ok) {
      const errorText = await purchaseResponse.text();
      console.error('Twilio purchase error:', purchaseResponse.status, errorText);
      throw new Error(`Failed to purchase number: ${purchaseResponse.status}`);
    }

    const purchasedNumber = await purchaseResponse.json();
    console.log('Purchased number SID:', purchasedNumber.sid);

    // Step 3: Get user profile and script
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: script } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    let agentId: string | null = null;
    let importedPhoneId: string | null = null;

    // Route to appropriate provider
    if (voice_provider === 'vapi') {
      // ========== VAPI FLOW ==========
      agentId = profile?.vapi_assistant_id;

      // Create Vapi assistant if user doesn't have one
      if (!agentId) {
        console.log('Creating new Vapi assistant for user:', userId);
        
        const businessName = profile?.business_name || 'העסק שלי';
        const businessType = profile?.business_type || 'עסק';
        const language = script?.language || 'he';
        
        const systemPrompt = buildSystemPrompt({
          businessName,
          businessType,
          profile,
          script,
        });

        const greetingMessage = script?.greeting_message || 
          `שלום! הגעתם ל${businessName}. איך אני יכול לעזור לכם?`;

        const vapiPayload = {
          name: `Assistant - ${businessName}`,
          transcriber: {
            provider: "deepgram",
            model: "nova-2",
            language: language === "he" ? "he" : language === "ar" ? "ar" : "en",
          },
          model: {
            provider: "openai",
            model: "gpt-4",
            messages: [{ role: "system", content: systemPrompt }],
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
                      date: { type: "string", description: "The date of the appointment in YYYY-MM-DD format" },
                      time: { type: "string", description: "The time of the appointment in HH:MM format" },
                      service: { type: "string", description: "The type of service or reason for the appointment" }
                    },
                    required: ["customer_name", "date", "time"]
                  }
                },
                server: { url: `${SUPABASE_URL}/functions/v1/elevenlabs-schedule-appointment` }
              },
              {
                type: "function",
                function: {
                  name: "get_availability",
                  description: "Get business availability and open hours.",
                  parameters: {
                    type: "object",
                    properties: {
                      date: { type: "string", description: "Optional: specific date to check availability (YYYY-MM-DD format)" }
                    },
                    required: []
                  }
                },
                server: { url: `${SUPABASE_URL}/functions/v1/elevenlabs-get-availability` }
              }
            ]
          },
          voice: {
            provider: "11labs",
            voiceId: script?.voice_id || "JBFqnCBsd6RMkjVDRZzb",
            model: "eleven_turbo_v2_5",
            stability: 0.5,
            similarityBoost: 0.75
          },
          firstMessage: greetingMessage,
          serverUrl: `${SUPABASE_URL}/functions/v1/vapi-webhook`,
          silenceTimeoutSeconds: 30,
          maxDurationSeconds: 600,
          backgroundSound: "off"
        };

        const createAssistantResponse = await fetch('https://api.vapi.ai/assistant', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${VAPI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(vapiPayload),
        });

        if (!createAssistantResponse.ok) {
          const errorText = await createAssistantResponse.text();
          console.error('Vapi create assistant error:', createAssistantResponse.status, errorText);
          throw new Error(`Failed to create Vapi assistant: ${createAssistantResponse.status}`);
        }

        const assistantData = await createAssistantResponse.json();
        agentId = assistantData.id;
        console.log('Created Vapi assistant:', agentId);

        // Save assistant_id to profile
        await supabase
          .from('profiles')
          .update({ vapi_assistant_id: agentId, voice_provider: 'vapi' })
          .eq('user_id', userId);
      }

      // Import phone number to Vapi
      console.log('Importing phone number to Vapi:', purchasedNumber.phone_number);
      
      const vapiImportPayload = {
        provider: "twilio",
        number: purchasedNumber.phone_number,
        twilioAccountSid: TWILIO_ACCOUNT_SID,
        twilioAuthToken: TWILIO_AUTH_TOKEN,
        assistantId: agentId,
        name: `Business Line - ${profile?.business_name || 'Main'}`,
      };

      const vapiImportResponse = await fetch('https://api.vapi.ai/phone-number', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vapiImportPayload),
      });

      if (!vapiImportResponse.ok) {
        const errorText = await vapiImportResponse.text();
        console.error('Vapi import error:', vapiImportResponse.status, errorText);
        throw new Error(`Failed to import number to Vapi: ${vapiImportResponse.status} - ${errorText}`);
      }

      const vapiImportData = await vapiImportResponse.json();
      importedPhoneId = vapiImportData.id;
      console.log('Imported phone number to Vapi, ID:', importedPhoneId);

    } else {
      // ========== ELEVENLABS FLOW ==========
      agentId = profile?.elevenlabs_agent_id;

      // Create ElevenLabs agent if user doesn't have one
      if (!agentId) {
        console.log('Creating new ElevenLabs agent for user:', userId);
        
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
                    description: "Schedule an appointment for the caller. Use this when the customer wants to book an appointment.",
                    api_schema: {
                      url: `${SUPABASE_URL}/functions/v1/elevenlabs-schedule-appointment`,
                      method: "POST",
                      request_body_schema: {
                        type: "object",
                        properties: {
                          customer_name: { type: "string", description: "The name of the customer" },
                          customer_phone: { type: "string", description: "The phone number of the customer" },
                          date: { type: "string", description: "The date of the appointment in YYYY-MM-DD format" },
                          time: { type: "string", description: "The time of the appointment in HH:MM format" },
                          service: { type: "string", description: "The type of service or reason for the appointment" }
                        },
                        required: ["customer_name", "date", "time"]
                      },
                      request_headers: { "Content-Type": "application/json" }
                    }
                  },
                  {
                    type: "webhook",
                    name: "get_availability",
                    description: "Get business availability and open hours. Use this when the customer asks about available times, business hours, or when they can schedule an appointment.",
                    api_schema: {
                      url: `${SUPABASE_URL}/functions/v1/elevenlabs-get-availability`,
                      method: "POST",
                      request_body_schema: {
                        type: "object",
                        properties: {
                          date: { type: "string", description: "Optional: specific date to check availability (YYYY-MM-DD format)" }
                        },
                        required: []
                      },
                      request_headers: { "Content-Type": "application/json" }
                    }
                  }
                ]
              },
              first_message: greetingMessage,
              language: script?.language || "he",
              supported_languages: ["he", "ar", "en"]
            },
            tts: {
              voice_id: script?.voice_id || "JBFqnCBsd6RMkjVDRZzb"
            }
          }
        };

        const createAgentResponse = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(agentPayload),
        });

        if (!createAgentResponse.ok) {
          const errorText = await createAgentResponse.text();
          console.error('ElevenLabs create agent error:', createAgentResponse.status, errorText);
          throw new Error(`Failed to create agent: ${createAgentResponse.status}`);
        }

        const agentData = await createAgentResponse.json();
        agentId = agentData.agent_id;
        console.log('Created ElevenLabs agent:', agentId);

        // Save agent_id to profile
        await supabase
          .from('profiles')
          .update({ elevenlabs_agent_id: agentId, voice_provider: 'elevenlabs' })
          .eq('user_id', userId);
      }

      // Import the phone number to ElevenLabs
      console.log('Importing phone number to ElevenLabs:', purchasedNumber.phone_number);
      
      const importPayload = {
        phone_number: purchasedNumber.phone_number,
        provider: "twilio",
        label: `Business Line - ${profile?.business_name || 'Main'}`,
        sid: TWILIO_ACCOUNT_SID,
        token: TWILIO_AUTH_TOKEN,
        agent_id: agentId,
      };

      const importResponse = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers/create', {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(importPayload),
      });

      if (!importResponse.ok) {
        const errorText = await importResponse.text();
        console.error('ElevenLabs import error:', importResponse.status, errorText);
        throw new Error(`Failed to import number: ${importResponse.status} - ${errorText}`);
      }

      const importData = await importResponse.json();
      importedPhoneId = importData.phone_number_id || importData.id;
      console.log('Imported phone number to ElevenLabs, ID:', importedPhoneId);
    }

    // Step 6: Save to database
    const { data: phoneRecord, error: dbError } = await supabase
      .from('phone_numbers')
      .insert({
        user_id: userId,
        elevenlabs_phone_id: importedPhoneId || 'pending',
        elevenlabs_agent_id: voice_provider === 'elevenlabs' ? agentId : null,
        vapi_assistant_id: voice_provider === 'vapi' ? agentId : null,
        phone_number: purchasedNumber.phone_number,
        country_code: country_code,
        status: 'active',
        twilio_sid: purchasedNumber.sid,
        monthly_cost: country_code === 'IL' ? 6.00 : 1.15,
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
        phone_number: phoneRecord.phone_number,
        agent_id: agentId,
        phone_id: importedPhoneId,
        provider: voice_provider,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in complete setup:', error);
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
}): string {
  const { businessName, businessType, profile, script } = params;
  
  const businessPhone = profile?.phone || '';
  const services = script?.services || [];
  const faq = script?.faq || [];
  const tone = script?.tone || 'friendly';
  const businessHours = script?.business_hours || '';
  const customPrompt = script?.custom_prompt || '';
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
