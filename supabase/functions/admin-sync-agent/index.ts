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

function getExpandedIntents(language: string) {
  return [
    {
      displayName: "greeting",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "שלום" }], repeatCount: 1 },
        { parts: [{ text: "היי" }], repeatCount: 1 },
        { parts: [{ text: "בוקר טוב" }], repeatCount: 1 },
        { parts: [{ text: "ערב טוב" }], repeatCount: 1 },
        { parts: [{ text: "אהלן" }], repeatCount: 1 },
        { parts: [{ text: "הלו" }], repeatCount: 1 },
        { parts: [{ text: "מה שלומך" }], repeatCount: 1 },
        { parts: [{ text: "מה נשמע" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Hello" }], repeatCount: 1 },
        { parts: [{ text: "Hi" }], repeatCount: 1 },
        { parts: [{ text: "Good morning" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "introduction",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "שלום אני אמיר" }], repeatCount: 1 },
        { parts: [{ text: "אני דוד" }], repeatCount: 1 },
        { parts: [{ text: "קוראים לי יוסי" }], repeatCount: 1 },
        { parts: [{ text: "שמי משה" }], repeatCount: 1 },
        { parts: [{ text: "אני שרה" }], repeatCount: 1 },
        { parts: [{ text: "שלום קוראים לי" }], repeatCount: 1 },
        { parts: [{ text: "השם שלי הוא" }], repeatCount: 1 },
        { parts: [{ text: "אני נועה" }], repeatCount: 1 },
        { parts: [{ text: "אני יעל" }], repeatCount: 1 },
        { parts: [{ text: "זה דני" }], repeatCount: 1 },
        { parts: [{ text: "היי אני" }], repeatCount: 1 },
        { parts: [{ text: "שלום שלום אני" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "My name is John" }], repeatCount: 1 },
        { parts: [{ text: "I'm David" }], repeatCount: 1 },
        { parts: [{ text: "This is Sarah speaking" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "what_do_you_do",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "מה אתם עושים" }], repeatCount: 1 },
        { parts: [{ text: "ספר לי על החברה" }], repeatCount: 1 },
        { parts: [{ text: "מה השירותים שלכם" }], repeatCount: 1 },
        { parts: [{ text: "במה אתם מתמחים" }], repeatCount: 1 },
        { parts: [{ text: "מה אתם מציעים" }], repeatCount: 1 },
        { parts: [{ text: "על מה החברה" }], repeatCount: 1 },
        { parts: [{ text: "תספר לי על העסק" }], repeatCount: 1 },
        { parts: [{ text: "מי אתם" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "What do you do" }], repeatCount: 1 },
        { parts: [{ text: "Tell me about your company" }], repeatCount: 1 },
        { parts: [{ text: "What services do you offer" }], repeatCount: 1 },
        { parts: [{ text: "What is your business about" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "pricing_question",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "כמה זה עולה" }], repeatCount: 1 },
        { parts: [{ text: "מה המחירים" }], repeatCount: 1 },
        { parts: [{ text: "כמה עולה לבנות אתר" }], repeatCount: 1 },
        { parts: [{ text: "כמה עולה אפליקציה" }], repeatCount: 1 },
        { parts: [{ text: "מה העלות" }], repeatCount: 1 },
        { parts: [{ text: "תן לי הצעת מחיר" }], repeatCount: 1 },
        { parts: [{ text: "כמה תגבו" }], repeatCount: 1 },
        { parts: [{ text: "מה המחיר של" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "How much does it cost" }], repeatCount: 1 },
        { parts: [{ text: "What are your prices" }], repeatCount: 1 },
        { parts: [{ text: "How much for a website" }], repeatCount: 1 },
        { parts: [{ text: "Give me a quote" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "schedule.appointment",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "אני רוצה לקבוע פגישה" }], repeatCount: 1 },
        { parts: [{ text: "אפשר לקבוע תור" }], repeatCount: 1 },
        { parts: [{ text: "מתי יש לכם מקום פנוי" }], repeatCount: 1 },
        { parts: [{ text: "אני רוצה להזמין תור" }], repeatCount: 1 },
        { parts: [{ text: "אני צריך לקבוע תור" }], repeatCount: 1 },
        { parts: [{ text: "רוצה לקבוע" }], repeatCount: 1 },
        { parts: [{ text: "צריך תור" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "I want to schedule an appointment" }], repeatCount: 1 },
        { parts: [{ text: "Can I book a meeting" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "check.availability",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "מתי אתם פנויים" }], repeatCount: 1 },
        { parts: [{ text: "מה הזמינות שלכם" }], repeatCount: 1 },
        { parts: [{ text: "מתי אפשר לבוא" }], repeatCount: 1 },
        { parts: [{ text: "באיזה שעות אתם עובדים" }], repeatCount: 1 },
        { parts: [{ text: "מה שעות הפעילות" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "When are you available" }], repeatCount: 1 },
        { parts: [{ text: "What are your working hours" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "thanks",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "תודה" }], repeatCount: 1 },
        { parts: [{ text: "תודה רבה" }], repeatCount: 1 },
        { parts: [{ text: "מעולה תודה" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Thank you" }], repeatCount: 1 },
        { parts: [{ text: "Thanks" }], repeatCount: 1 }
      ]
    },
    {
      displayName: "goodbye",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "להתראות" }], repeatCount: 1 },
        { parts: [{ text: "ביי" }], repeatCount: 1 },
        { parts: [{ text: "יום טוב" }], repeatCount: 1 },
        { parts: [{ text: "כל טוב" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Goodbye" }], repeatCount: 1 },
        { parts: [{ text: "Bye" }], repeatCount: 1 }
      ]
    }
  ];
}

function buildPlaybookInstructions(profile: any, script: any, language: string): string[] {
  const businessName = profile?.business_name || 'העסק';
  const businessType = profile?.business_type || 'עסק';
  const services = script?.services || [];
  const faq = script?.faq || [];
  const businessHours = script?.business_hours || '';

  // Build FAQ pricing info
  const pricingFaq = faq.find((f: any) => 
    f.question?.includes('מחיר') || 
    f.question?.includes('עולה') || 
    f.question?.includes('cost') ||
    f.question?.includes('price')
  );

  if (language === 'he') {
    const instructions = [
      `אתה נציג של ${businessName}. לעולם אל תזדהה כ"עוזר AI" או "בוט" - אתה נציג אנושי של החברה.`,
      `כאשר נשאל "מה אתם עושים?" או "ספר על החברה" - תאר את ${businessName}: אנחנו ${businessType}.${services.length > 0 ? ` השירותים שלנו כוללים: ${services.join(', ')}.` : ''}`,
      pricingFaq 
        ? `כאשר נשאל על מחירים - ענה: "${pricingFaq.answer}"`
        : `כאשר נשאל על מחירים - אמור שנשמח לתת הצעת מחיר מותאמת אישית ולקבוע פגישת היכרות.`,
      `אם הלקוח מציג את שמו (למשל "אני דני") - זכור את השם ופנה אליו בשם לאורך השיחה.`,
      `תמיד הצע לקבוע פגישת היכרות ללא עלות כשמתאים.`,
      businessHours ? `שעות הפעילות שלנו: ${businessHours}` : ``,
      `דבר תמיד בעברית באותיות עבריות. היה קצר, ענייני וידידותי.`
    ].filter(i => i.length > 0);

    // Add FAQ instructions
    for (const item of faq) {
      if (!item.question?.includes('מחיר') && !item.question?.includes('עולה')) {
        instructions.push(`אם נשאל "${item.question}" - ענה: "${item.answer}"`);
      }
    }

    return instructions;
  } else {
    const instructions = [
      `You are a representative of ${businessName}. Never identify as an "AI assistant" or "bot" - you represent the company.`,
      `When asked "what do you do?" or "tell me about your company" - describe ${businessName}: We are ${businessType}.${services.length > 0 ? ` Our services include: ${services.join(', ')}.` : ''}`,
      pricingFaq 
        ? `When asked about pricing - answer: "${pricingFaq.answer}"`
        : `When asked about pricing - offer to provide a custom quote and schedule a free consultation.`,
      `If the customer introduces themselves (e.g. "I'm John") - remember their name and use it throughout the conversation.`,
      `Always offer to schedule a free consultation meeting when appropriate.`,
      businessHours ? `Our business hours: ${businessHours}` : ``,
      `Be brief, professional and friendly.`
    ].filter(i => i.length > 0);

    // Add FAQ instructions
    for (const item of faq) {
      if (!item.question?.includes('cost') && !item.question?.includes('price')) {
        instructions.push(`If asked "${item.question}" - answer: "${item.answer}"`);
      }
    }

    return instructions;
  }
}

function buildSystemPrompt(profile: any, script: any, language: string): string {
  const businessName = profile?.business_name || 'העסק';
  const businessType = profile?.business_type || 'עסק';
  const services = script?.services || [];
  const faq = script?.faq || [];
  const tone = script?.tone || 'friendly';
  const businessHours = script?.business_hours || '';
  const customPrompt = script?.custom_prompt || '';

  const toneInstructions: Record<string, string> = {
    friendly: 'דבר בצורה חמה וידידותית',
    professional: 'דבר בצורה מקצועית ורשמית',
    casual: 'דבר בצורה קז\'ואלית ונינוחה',
    formal: 'דבר בצורה רשמית ומכובדת'
  };

  // Build services section with details
  const servicesSection = services.length > 0 
    ? `השירותים שלנו:\n${services.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}`
    : '';

  // Build FAQ section
  const faqSection = faq.length > 0 
    ? `שאלות נפוצות ותשובות:\n${faq.map((f: any) => `שאלה: ${f.question}\nתשובה: ${f.answer}`).join('\n\n')}`
    : '';

  return `אתה נציג מכירות ושירות לקוחות של ${businessName}.
${businessType ? `אנחנו ${businessType}.` : ''}

כללי זהות (חובה!):
- אתה נציג של ${businessName}, לא "עוזר AI כללי"
- כשנשאל "מה אתם עושים?" או "ספר לי על החברה" - תאר את ${businessName} ואת השירותים שלנו
- כשנשאל על מחירים/עלויות - השתמש במידע מהשאלות הנפוצות למטה
- אם אין לך מידע ספציפי על מחיר - אמור שנשמח לתת הצעת מחיר מותאמת אישית

${toneInstructions[tone] || toneInstructions.friendly}

פרטי העסק:
- שם: ${businessName}
- תחום: ${businessType}
${businessHours ? `- שעות פעילות: ${businessHours}` : ''}

${servicesSection}

${faqSection}

${customPrompt ? `הנחיות מיוחדות:\n${customPrompt}` : ''}

תפקידים עיקריים:
1. ברך את הלקוח בחביבות והצג את עצמך כנציג של ${businessName}
2. ענה על שאלות לגבי השירותים, המחירים והזמינות
3. עזור לקבוע פגישות ותורים
4. אם אינך יודע תשובה ספציפית - הצע ללקוח להשאיר פרטים ונחזור אליו

זיכרון שיחה (חשוב מאוד!):
- כאשר הלקוח אומר את שמו - זכור אותו והשתמש בו לאורך השיחה
- פנה ללקוח בשמו כשאתה יודע אותו (למשל: "אוקיי דני, אז אתה מתעניין ב...")
- זכור מה הלקוח ביקש או שאל קודם - אל תשאל שוב את אותן שאלות
- אם הלקוח חזר לנושא שכבר דיברתם עליו - התייחס לזה ("כפי שהזכרת קודם...")
- כשמסכמים או מסיימים שיחה - סכם את הנקודות העיקריות שהועלו

תמיכה רב-לשונית:
- זהה את שפת הדיבור של הלקוח (עברית, אנגלית, או ערבית)
- ענה תמיד באותה שפה שבה הלקוח פנה אליך
- אם הלקוח עובר שפה באמצע השיחה - עבור איתו בצורה חלקה

כללים חשובים:
- אם הלקוח דובר עברית - ענה בעברית באותיות עבריות בלבד
- אם הלקוח דובר אנגלית - ענה באנגלית
- אם הלקוח דובר ערבית - ענה בערבית
- היה קצר, ענייני ומקצועי`;
}

function getIntentResponses(profile: any, script: any, language: string): Record<string, string> {
  const businessName = profile?.business_name || 'העסק';
  const businessType = profile?.business_type || 'עסק';
  const services = script?.services || [];
  const faq = script?.faq || [];

  // Find pricing FAQ
  const pricingFaq = faq.find((f: any) => 
    f.question?.includes('מחיר') || 
    f.question?.includes('עולה') || 
    f.question?.includes('cost') ||
    f.question?.includes('price')
  );

  if (language === 'he') {
    return {
      'what_do_you_do': `אנחנו ${businessName}, ${businessType}.${services.length > 0 ? ` אנחנו מתמחים ב${services.slice(0, 3).join(', ')}. רוצה לשמוע פרטים על שירות ספציפי?` : ' איך אוכל לעזור לך?'}`,
      'pricing_question': pricingFaq 
        ? pricingFaq.answer 
        : `המחיר תלוי בהיקף הפרויקט. נשמח לתת לך הצעת מחיר מותאמת אישית. רוצה לקבוע פגישת היכרות קצרה?`,
      'greeting': script?.greeting_message || `שלום! כאן ${businessName}, איך אוכל לעזור לך?`,
      'introduction': `נעים מאוד! במה אוכל לעזור לך היום?`,
      'schedule.appointment': `בשמחה! בוא נקבע פגישה. לאיזה יום ושעה יהיה לך נוח?`,
      'check.availability': `אשמח לבדוק. לאיזה יום אתה מחפש?`,
      'thanks': `בכיף! יש עוד משהו שאוכל לעזור?`,
      'goodbye': `תודה שפנית אלינו! יום נעים ונשמח לשמוע ממך.`
    };
  } else {
    return {
      'what_do_you_do': `We are ${businessName}, ${businessType}.${services.length > 0 ? ` We specialize in ${services.slice(0, 3).join(', ')}. Would you like details on a specific service?` : ' How can I help you?'}`,
      'pricing_question': pricingFaq 
        ? pricingFaq.answer 
        : `Pricing depends on the project scope. We'd be happy to give you a custom quote. Would you like to schedule a brief consultation?`,
      'greeting': script?.greeting_message || `Hello! This is ${businessName}, how can I help you?`,
      'introduction': `Nice to meet you! How can I help you today?`,
      'schedule.appointment': `Sure! Let's schedule a meeting. What day and time works for you?`,
      'check.availability': `I'd be happy to check. What day are you looking for?`,
      'thanks': `You're welcome! Is there anything else I can help with?`,
      'goodbye': `Thank you for reaching out! Have a great day.`
    };
  }
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

    const { user_id } = await req.json();
    
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials: GoogleCredentials = JSON.parse(credentialsJson);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!profile.dialogflow_agent_id) {
      return new Response(
        JSON.stringify({ error: 'No Dialogflow agent found for user' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get active script
    const { data: script } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .maybeSingle();

    const accessToken = await getAccessToken(credentials);
    const language = script?.language || 'he';
    const agentName = `projects/${projectId}/locations/global/agents/${profile.dialogflow_agent_id}`;
    const businessName = profile?.business_name || 'Business';

    console.log('🔄 Syncing agent for user:', user_id, 'agent:', profile.dialogflow_agent_id);

    // 0. Add 'en' as a supported language (required for LLM)
    const addEnglishResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}?updateMask=supportedLanguageCodes`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: agentName,
          supportedLanguageCodes: ['en']
        })
      }
    );

    if (addEnglishResponse.ok) {
      console.log('✅ Added English as supported language');
    }

    // 1. Create or Update Playbook
    const playbookDisplayName = `${businessName} Sales Agent`;
    const playbookGoal = language === 'he' 
      ? `אתה נציג מכירות של ${businessName}. עזור ללקוחות עם שאלות על השירותים, המחירים וקביעת פגישות.`
      : `You are a sales representative of ${businessName}. Help customers with questions about services, pricing, and scheduling meetings.`;
    
    const playbookInstructions = buildPlaybookInstructions(profile, script, language);

    // List existing playbooks
    const listPlaybooksResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/playbooks`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    let playbookName: string | null = null;
    let existingPlaybooks: any[] = [];

    if (listPlaybooksResponse.ok) {
      const playbooksData = await listPlaybooksResponse.json();
      existingPlaybooks = playbooksData.playbooks || [];
      const existingPlaybook = existingPlaybooks.find((p: any) => p.displayName === playbookDisplayName);
      if (existingPlaybook) {
        playbookName = existingPlaybook.name;
      }
    }

    const playbookPayload = {
      displayName: playbookDisplayName,
      goal: playbookGoal,
      instruction: {
        steps: playbookInstructions.map(instruction => ({ text: instruction }))
      },
      llmModelSettings: {
        model: "", // Let Dialogflow use default
        promptText: buildSystemPrompt(profile, script, language)
      }
    };

    if (playbookName) {
      // Update existing playbook
      console.log('📝 Updating existing playbook:', playbookName);
      const updatePlaybookResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${playbookName}?updateMask=goal,instruction,llmModelSettings`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: playbookName,
            ...playbookPayload
          })
        }
      );

      if (updatePlaybookResponse.ok) {
        console.log('✅ Updated playbook successfully');
      } else {
        const errText = await updatePlaybookResponse.text();
        console.error('❌ Failed to update playbook:', errText);
      }
    } else {
      // Create new playbook
      console.log('📝 Creating new playbook...');
      const createPlaybookResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${agentName}/playbooks`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(playbookPayload)
        }
      );

      if (createPlaybookResponse.ok) {
        const createdPlaybook = await createPlaybookResponse.json();
        playbookName = createdPlaybook.name;
        console.log('✅ Created playbook:', playbookName);
      } else {
        const errText = await createPlaybookResponse.text();
        console.error('❌ Failed to create playbook:', errText);
      }
    }

    // 2. Update generative settings with System Prompt
    const systemPrompt = buildSystemPrompt(profile, script, language);
    const promptTemplateName = `${businessName} Agent`;
    
    console.log('📋 System Prompt (first 200 chars):', systemPrompt.substring(0, 200));
    
    const generativeSettingsPayload = {
      name: `${agentName}/generativeSettings`,
      languageCode: 'en',
      fallbackSettings: {
        selectedPrompt: promptTemplateName,
        promptTemplates: [
          {
            displayName: promptTemplateName,
            promptText: systemPrompt,
            frozen: false
          }
        ]
      },
      llmModelSettings: {
        model: "",
        promptText: systemPrompt
      },
      knowledgeConnectorSettings: {
        enabled: true,
        searchConfig: {
          maxSnippetCount: 3
        }
      }
    };

    const updateGenerativeResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/generativeSettings?updateMask=fallbackSettings,llmModelSettings,knowledgeConnectorSettings`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(generativeSettingsPayload)
      }
    );

    if (updateGenerativeResponse.ok) {
      console.log('✅ Updated generative settings');
    } else {
      const errText = await updateGenerativeResponse.text();
      console.error('❌ Failed to update generative settings:', errText);
    }

    // 3. Update Default Start Flow with enableGenerativeFallback AND route responses
    const defaultFlowPath = `${agentName}/flows/00000000-0000-0000-0000-000000000000`;
    const intentResponses = getIntentResponses(profile, script, language);
    
    // Get current flow
    const flowResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${defaultFlowPath}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (flowResponse.ok) {
      const flowData = await flowResponse.json();
      const eventHandlers = flowData.eventHandlers || [];
      const transitionRoutes = flowData.transitionRoutes || [];
      
      // Update event handlers with enableGenerativeFallback
      const updatedEventHandlers = eventHandlers.map((handler: any) => {
        if (handler.event === 'sys.no-match-default' || handler.event === 'sys.no-input-default') {
          return {
            ...handler,
            triggerFulfillment: {
              ...handler.triggerFulfillment,
              messages: [],
              enableGenerativeFallback: true
            }
          };
        }
        return handler;
      });

      // Ensure handlers exist
      const hasNoMatch = updatedEventHandlers.some((h: any) => h.event === 'sys.no-match-default');
      const hasNoInput = updatedEventHandlers.some((h: any) => h.event === 'sys.no-input-default');

      if (!hasNoMatch) {
        updatedEventHandlers.push({
          event: 'sys.no-match-default',
          triggerFulfillment: {
            messages: [],
            enableGenerativeFallback: true
          }
        });
      }

      if (!hasNoInput) {
        updatedEventHandlers.push({
          event: 'sys.no-input-default',
          triggerFulfillment: {
            messages: [],
            enableGenerativeFallback: true
          }
        });
      }

      // Update the flow with event handlers
      const flowUpdateResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${defaultFlowPath}?updateMask=eventHandlers`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: defaultFlowPath,
            eventHandlers: updatedEventHandlers
          })
        }
      );

      if (flowUpdateResponse.ok) {
        console.log('✅ Updated Flow with enableGenerativeFallback');
      } else {
        const flowError = await flowUpdateResponse.text();
        console.error('❌ Failed to update flow:', flowError);
      }
    }

    // 4. Update/Create intents with custom responses
    const listIntentsResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/intents`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    const existingIntentsData = await listIntentsResponse.json();
    const existingIntents = existingIntentsData.intents || [];
    
    const existingIntentsMap = new Map<string, string>();
    for (const intent of existingIntents) {
      existingIntentsMap.set(intent.displayName, intent.name);
    }

    const expandedIntents = getExpandedIntents(language);
    const results: { intent: string; action: string; success: boolean }[] = [];

    for (const intent of expandedIntents) {
      const existingIntentName = existingIntentsMap.get(intent.displayName);

      if (existingIntentName) {
        const updateRes = await fetch(
          `https://dialogflow.googleapis.com/v3/${existingIntentName}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              displayName: intent.displayName,
              trainingPhrases: intent.trainingPhrases,
            }),
          }
        );

        results.push({ 
          intent: intent.displayName, 
          action: updateRes.ok ? 'updated' : 'update_failed', 
          success: updateRes.ok 
        });
      } else {
        const createRes = await fetch(
          `https://dialogflow.googleapis.com/v3/${agentName}/intents`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(intent),
          }
        );

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error('Failed to create intent:', intent.displayName, errText);
        }

        results.push({ 
          intent: intent.displayName, 
          action: createRes.ok ? 'created' : 'create_failed', 
          success: createRes.ok 
        });
      }
    }

    // 5. Update transition routes with proper responses for key intents
    console.log('📝 Updating transition routes with custom responses...');
    
    // Get fresh flow data
    const freshFlowResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${defaultFlowPath}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (freshFlowResponse.ok) {
      const flowData = await freshFlowResponse.json();
      const currentRoutes = flowData.transitionRoutes || [];
      
      // Map intent names to their full paths
      const intentPaths = new Map<string, string>();
      for (const intent of existingIntents) {
        const displayName = intent.displayName;
        intentPaths.set(displayName, intent.name);
      }
      
      // Re-fetch to get newly created intents
      const refreshIntentsResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${agentName}/intents`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        }
      );
      
      if (refreshIntentsResponse.ok) {
        const refreshedIntents = await refreshIntentsResponse.json();
        for (const intent of (refreshedIntents.intents || [])) {
          intentPaths.set(intent.displayName, intent.name);
        }
      }

      // Build updated routes
      const updatedRoutes = [];
      const processedIntents = new Set<string>();

      // First, keep existing routes but update their responses
      for (const route of currentRoutes) {
        if (route.intent) {
          const intentName = route.intent.split('/').pop();
          const displayName = Array.from(intentPaths.entries()).find(([_, path]) => path.endsWith(intentName))?.[0];
          
          if (displayName && intentResponses[displayName]) {
            processedIntents.add(displayName);
            updatedRoutes.push({
              intent: route.intent,
              triggerFulfillment: {
                messages: [
                  {
                    text: {
                      text: [intentResponses[displayName]]
                    }
                  }
                ]
              }
            });
          } else {
            updatedRoutes.push(route);
            if (displayName) processedIntents.add(displayName);
          }
        } else {
          updatedRoutes.push(route);
        }
      }

      // Add routes for new intents that don't have routes yet
      for (const [displayName, response] of Object.entries(intentResponses)) {
        if (!processedIntents.has(displayName) && intentPaths.has(displayName)) {
          updatedRoutes.push({
            intent: intentPaths.get(displayName),
            triggerFulfillment: {
              messages: [
                {
                  text: {
                    text: [response]
                  }
                }
              ]
            }
          });
        }
      }

      // Update flow with new routes
      const routesUpdateResponse = await fetch(
        `https://dialogflow.googleapis.com/v3/${defaultFlowPath}?updateMask=transitionRoutes`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: defaultFlowPath,
            transitionRoutes: updatedRoutes
          })
        }
      );

      if (routesUpdateResponse.ok) {
        console.log('✅ Updated transition routes with custom responses');
      } else {
        const routesError = await routesUpdateResponse.text();
        console.error('❌ Failed to update transition routes:', routesError);
      }
    }

    // 6. Train the agent
    await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/flows/00000000-0000-0000-0000-000000000000:train`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Agent sync complete');

    return new Response(
      JSON.stringify({ 
        success: true,
        agent_id: profile.dialogflow_agent_id,
        playbook: playbookName ? 'created/updated' : 'not_supported',
        results,
        message: `Synced ${results.filter(r => r.success).length}/${results.length} intents`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error syncing agent:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
