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

    // Parse body if present, otherwise use empty object
    let body = {};
    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // Body is empty or invalid, use defaults
    }
    const { voice_id, business_name, greeting_message, custom_prompt } = body as any;

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

    // Create the Agent in ElevenLabs with auto language detection
    const agentPayload = {
      name: `Assistant - ${finalBusinessName}`,
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
                  },
                  request_headers: {
                    "Content-Type": "application/json"
                  }
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
                      date: {
                        type: "string",
                        description: "Optional: specific date to check availability (YYYY-MM-DD format)"
                      }
                    },
                    required: []
                  },
                  request_headers: {
                    "Content-Type": "application/json"
                  }
                }
              }
            ]
          },
          first_message: finalGreeting,
          language: script?.language || "he",
          supported_languages: ["he", "ar", "en"]
        },
        tts: {
          voice_id: voice_id || script?.voice_id || "JBFqnCBsd6RMkjVDRZzb" // George - supports Hebrew/Arabic
          // Note: model_id omitted - ElevenLabs will use default for the language
        }
      }
    };

    console.log('Creating agent with payload:', JSON.stringify(agentPayload, null, 2));

    const createResponse = await fetch(
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

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('ElevenLabs create agent error:', createResponse.status, errorText);
      throw new Error(`Failed to create agent: ${createResponse.status} - ${errorText}`);
    }

    const agentData = await createResponse.json();
    const agentId = agentData.agent_id;

    console.log('Created agent:', agentId);

    // Save agent_id to user's profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ elevenlabs_agent_id: agentId })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Failed to save agent_id to profile:', updateError);
    }

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
    console.error('Error creating agent:', error);
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

  // Language-specific content
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

  const servicesString = services.length > 0 
    ? services.join(', ')
    : '';

  const faqString = faq.map((item: any) => {
    if (language === 'ar') {
      return `س: ${item.question} → ${item.answer}`;
    } else if (language === 'en') {
      return `Q: ${item.question} → ${item.answer}`;
    }
    return `ש: ${item.question} → ${item.answer}`;
  }).join('\n');

  // Israeli spontaneous style prompt
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
4. לפני תור - תבדוק זמינות

## העסק: ${businessName}
${businessType ? `סוג: ${businessType}` : ''}
${businessPhone ? `טל: ${businessPhone}` : ''}
${businessHours ? `שעות: ${businessHours}` : ''}
${servicesString ? `שירותים: ${servicesString}` : ''}

${faqString ? `## FAQ:\n${faqString}` : ''}
${customPrompt ? `## הנחיות:\n${customPrompt}` : ''}`.trim();
  }
  
  // Arabic style
  if (language === 'ar') {
    return `أنت ممثل ${businessName}. تحدث بشكل طبيعي وودود - جمل قصيرة.

## الأسلوب:
- جمل قصيرة. 10-15 كلمة كحد أقصى.
- مثل صديق على الهاتف.
- كلمات ربط: "طيب", "خلاص", "لحظة", "تمام"

## القواعد:
1. لا تقل أبداً أنك AI
2. إجابات قصيرة
3. لا تعرف؟ "لحظة أتحقق"

## العمل: ${businessName}
${businessType ? `النوع: ${businessType}` : ''}
${businessPhone ? `الهاتف: ${businessPhone}` : ''}
${servicesString ? `الخدمات: ${servicesString}` : ''}

${faqString ? `## الأسئلة:\n${faqString}` : ''}
${customPrompt ? `## تعليمات:\n${customPrompt}` : ''}`.trim();
  }

  // English style
  return `You're a rep for ${businessName}. Talk naturally - short, warm, spontaneous.

## Style:
- Short sentences. Max 10-15 words.
- Like a friendly phone call, not a robot.
- Filler words: "sure", "okay", "one sec", "got it", "no problem"

## Examples:
❌ "I would be more than happy to assist you with any questions today"
✅ "Hey! How can I help?"

❌ "Certainly, I'll be glad to check availability for you"
✅ "Sure, one sec. When works for you?"

## Rules:
1. Never say you're AI/language model
2. Short answers - it's a call, not email
3. Don't know? "Let me check" or "We'll get back to you"

## Business: ${businessName}
${businessType ? `Type: ${businessType}` : ''}
${businessPhone ? `Phone: ${businessPhone}` : ''}
${servicesString ? `Services: ${servicesString}` : ''}

${faqString ? `## FAQ:\n${faqString}` : ''}
${customPrompt ? `## Notes:\n${customPrompt}` : ''}`.trim();
}
