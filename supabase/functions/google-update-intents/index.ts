import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GoogleCredentials {
  client_email: string;
  private_key: string;
  project_id: string;
}

async function getAccessToken(credentials: GoogleCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/dialogflow",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const claimB64 = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsignedToken = `${headerB64}.${claimB64}`;

  const pemContents = credentials.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const jwt = `${unsignedToken}.${signatureB64}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

function getExpandedIntents(language: string) {
  return [
    // Greeting intent
    {
      displayName: "greeting",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "שלום" }], repeatCount: 1 },
        { parts: [{ text: "היי" }], repeatCount: 1 },
        { parts: [{ text: "בוקר טוב" }], repeatCount: 1 },
        { parts: [{ text: "ערב טוב" }], repeatCount: 1 },
        { parts: [{ text: "אהלן" }], repeatCount: 1 },
        { parts: [{ text: "הלו" }], repeatCount: 1 },
        { parts: [{ text: "צהריים טובים" }], repeatCount: 1 },
        { parts: [{ text: "מה שלומך" }], repeatCount: 1 },
        { parts: [{ text: "מה נשמע" }], repeatCount: 1 }
      ] : language === 'ar' ? [
        { parts: [{ text: "مرحبا" }], repeatCount: 1 },
        { parts: [{ text: "السلام عليكم" }], repeatCount: 1 },
        { parts: [{ text: "صباح الخير" }], repeatCount: 1 },
        { parts: [{ text: "مساء الخير" }], repeatCount: 1 },
        { parts: [{ text: "أهلا" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Hello" }], repeatCount: 1 },
        { parts: [{ text: "Hi" }], repeatCount: 1 },
        { parts: [{ text: "Good morning" }], repeatCount: 1 },
        { parts: [{ text: "Good evening" }], repeatCount: 1 },
        { parts: [{ text: "Hey" }], repeatCount: 1 }
      ]
    },
    // Schedule appointment intent - expanded
    {
      displayName: "schedule.appointment",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "אני רוצה לקבוע פגישה" }], repeatCount: 1 },
        { parts: [{ text: "אפשר לקבוע תור" }], repeatCount: 1 },
        { parts: [{ text: "מתי יש לכם מקום פנוי" }], repeatCount: 1 },
        { parts: [{ text: "אני רוצה להזמין תור" }], repeatCount: 1 },
        { parts: [{ text: "אני צריך לקבוע תור" }], repeatCount: 1 },
        { parts: [{ text: "יש תור פנוי" }], repeatCount: 1 },
        { parts: [{ text: "אני רוצה לבוא אליכם" }], repeatCount: 1 },
        { parts: [{ text: "איך אפשר לקבוע" }], repeatCount: 1 },
        { parts: [{ text: "בוא נקבע פגישה" }], repeatCount: 1 },
        { parts: [{ text: "אפשר להזמין" }], repeatCount: 1 },
        { parts: [{ text: "רוצה לקבוע" }], repeatCount: 1 },
        { parts: [{ text: "צריך תור" }], repeatCount: 1 },
        { parts: [{ text: "אפשר לקבוע משהו" }], repeatCount: 1 },
        { parts: [{ text: "אני מעוניין לקבוע" }], repeatCount: 1 },
        { parts: [{ text: "אפשר להירשם" }], repeatCount: 1 }
      ] : language === 'ar' ? [
        { parts: [{ text: "أريد حجز موعد" }], repeatCount: 1 },
        { parts: [{ text: "هل يمكنني حجز موعد" }], repeatCount: 1 },
        { parts: [{ text: "أحتاج إلى موعد" }], repeatCount: 1 },
        { parts: [{ text: "هل هناك موعد متاح" }], repeatCount: 1 },
        { parts: [{ text: "أريد أن آتي إليكم" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "I want to schedule an appointment" }], repeatCount: 1 },
        { parts: [{ text: "Can I book a meeting" }], repeatCount: 1 },
        { parts: [{ text: "I need to make an appointment" }], repeatCount: 1 },
        { parts: [{ text: "Is there an available slot" }], repeatCount: 1 },
        { parts: [{ text: "I'd like to book" }], repeatCount: 1 },
        { parts: [{ text: "Can I schedule something" }], repeatCount: 1 }
      ],
      parameters: [
        {
          id: "customer_name",
          entityType: "@sys.person",
          isList: false,
          redact: false
        },
        {
          id: "date_time",
          entityType: "@sys.date-time",
          isList: false,
          redact: false
        }
      ]
    },
    // Check availability intent - expanded
    {
      displayName: "check.availability",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "מתי אתם פנויים" }], repeatCount: 1 },
        { parts: [{ text: "מה הזמינות שלכם" }], repeatCount: 1 },
        { parts: [{ text: "מתי אפשר לבוא" }], repeatCount: 1 },
        { parts: [{ text: "באיזה שעות אתם עובדים" }], repeatCount: 1 },
        { parts: [{ text: "מה שעות הפעילות" }], repeatCount: 1 },
        { parts: [{ text: "עד מתי אתם פתוחים" }], repeatCount: 1 },
        { parts: [{ text: "מתי אתם פותחים" }], repeatCount: 1 },
        { parts: [{ text: "באיזה ימים אתם עובדים" }], repeatCount: 1 },
        { parts: [{ text: "אתם פתוחים היום" }], repeatCount: 1 },
        { parts: [{ text: "אתם עובדים בשבת" }], repeatCount: 1 },
        { parts: [{ text: "מתי אתם סוגרים" }], repeatCount: 1 },
        { parts: [{ text: "אתם פתוחים עכשיו" }], repeatCount: 1 },
        { parts: [{ text: "מה השעות שלכם" }], repeatCount: 1 },
        { parts: [{ text: "באיזה שעות אתם פתוחים" }], repeatCount: 1 },
        { parts: [{ text: "מתי אפשר להגיע" }], repeatCount: 1 },
        { parts: [{ text: "יש לכם פנוי היום" }], repeatCount: 1 },
        { parts: [{ text: "יש מקום היום" }], repeatCount: 1 },
        { parts: [{ text: "אתם עובדים בערב" }], repeatCount: 1 },
        { parts: [{ text: "אתם עובדים בבוקר" }], repeatCount: 1 }
      ] : language === 'ar' ? [
        { parts: [{ text: "متى تكونون متاحين" }], repeatCount: 1 },
        { parts: [{ text: "ما هي أوقات العمل" }], repeatCount: 1 },
        { parts: [{ text: "في أي ساعات تعملون" }], repeatCount: 1 },
        { parts: [{ text: "هل أنتم مفتوحون اليوم" }], repeatCount: 1 },
        { parts: [{ text: "متى تفتحون" }], repeatCount: 1 },
        { parts: [{ text: "متى تغلقون" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "When are you available" }], repeatCount: 1 },
        { parts: [{ text: "What are your working hours" }], repeatCount: 1 },
        { parts: [{ text: "What time do you open" }], repeatCount: 1 },
        { parts: [{ text: "What time do you close" }], repeatCount: 1 },
        { parts: [{ text: "Are you open today" }], repeatCount: 1 },
        { parts: [{ text: "Do you work on weekends" }], repeatCount: 1 }
      ]
    },
    // Business info intent - expanded
    {
      displayName: "business.info",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "מה השירותים שלכם" }], repeatCount: 1 },
        { parts: [{ text: "ספר לי על העסק" }], repeatCount: 1 },
        { parts: [{ text: "מה אתם מציעים" }], repeatCount: 1 },
        { parts: [{ text: "איפה אתם נמצאים" }], repeatCount: 1 },
        { parts: [{ text: "מה הכתובת שלכם" }], repeatCount: 1 },
        { parts: [{ text: "כמה זה עולה" }], repeatCount: 1 },
        { parts: [{ text: "מה המחירים" }], repeatCount: 1 },
        { parts: [{ text: "איך מגיעים אליכם" }], repeatCount: 1 },
        { parts: [{ text: "מה אתם עושים" }], repeatCount: 1 },
        { parts: [{ text: "מה העסק שלכם" }], repeatCount: 1 },
        { parts: [{ text: "איזה שירותים יש לכם" }], repeatCount: 1 },
        { parts: [{ text: "מה אפשר לעשות אצלכם" }], repeatCount: 1 },
        { parts: [{ text: "יש לכם מחירון" }], repeatCount: 1 },
        { parts: [{ text: "כמה עולה טיפול" }], repeatCount: 1 }
      ] : language === 'ar' ? [
        { parts: [{ text: "ما هي خدماتكم" }], repeatCount: 1 },
        { parts: [{ text: "أخبرني عن العمل" }], repeatCount: 1 },
        { parts: [{ text: "أين أنتم" }], repeatCount: 1 },
        { parts: [{ text: "ما هو العنوان" }], repeatCount: 1 },
        { parts: [{ text: "كم يكلف" }], repeatCount: 1 },
        { parts: [{ text: "ما هي الأسعار" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "What services do you offer" }], repeatCount: 1 },
        { parts: [{ text: "Tell me about your business" }], repeatCount: 1 },
        { parts: [{ text: "Where are you located" }], repeatCount: 1 },
        { parts: [{ text: "What is your address" }], repeatCount: 1 },
        { parts: [{ text: "How much does it cost" }], repeatCount: 1 },
        { parts: [{ text: "What are your prices" }], repeatCount: 1 }
      ]
    },
    // Thanks intent
    {
      displayName: "thanks",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "תודה" }], repeatCount: 1 },
        { parts: [{ text: "תודה רבה" }], repeatCount: 1 },
        { parts: [{ text: "מעולה תודה" }], repeatCount: 1 },
        { parts: [{ text: "אחלה תודה" }], repeatCount: 1 },
        { parts: [{ text: "מושלם תודה" }], repeatCount: 1 },
        { parts: [{ text: "יופי תודה" }], repeatCount: 1 }
      ] : language === 'ar' ? [
        { parts: [{ text: "شكرا" }], repeatCount: 1 },
        { parts: [{ text: "شكرا جزيلا" }], repeatCount: 1 },
        { parts: [{ text: "ممتاز شكرا" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Thank you" }], repeatCount: 1 },
        { parts: [{ text: "Thanks" }], repeatCount: 1 },
        { parts: [{ text: "Great thanks" }], repeatCount: 1 }
      ]
    },
    // Goodbye intent
    {
      displayName: "goodbye",
      trainingPhrases: language === 'he' ? [
        { parts: [{ text: "להתראות" }], repeatCount: 1 },
        { parts: [{ text: "ביי" }], repeatCount: 1 },
        { parts: [{ text: "יום טוב" }], repeatCount: 1 },
        { parts: [{ text: "שיהיה יום טוב" }], repeatCount: 1 },
        { parts: [{ text: "נתראה" }], repeatCount: 1 },
        { parts: [{ text: "תהיה בריא" }], repeatCount: 1 },
        { parts: [{ text: "כל טוב" }], repeatCount: 1 }
      ] : language === 'ar' ? [
        { parts: [{ text: "مع السلامة" }], repeatCount: 1 },
        { parts: [{ text: "باي" }], repeatCount: 1 },
        { parts: [{ text: "إلى اللقاء" }], repeatCount: 1 },
        { parts: [{ text: "يوم سعيد" }], repeatCount: 1 }
      ] : [
        { parts: [{ text: "Goodbye" }], repeatCount: 1 },
        { parts: [{ text: "Bye" }], repeatCount: 1 },
        { parts: [{ text: "Have a good day" }], repeatCount: 1 },
        { parts: [{ text: "See you" }], repeatCount: 1 }
      ]
    }
  ];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get credentials
    const credentialsJson = Deno.env.get('GOOGLE_CLOUD_CREDENTIALS');
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');

    if (!credentialsJson || !projectId) {
      throw new Error('Google Cloud credentials not configured');
    }

    const credentials = JSON.parse(credentialsJson);
    const accessToken = await getAccessToken(credentials);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Get user's profile to find agent ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('dialogflow_agent_id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile?.dialogflow_agent_id) {
      throw new Error('No Dialogflow agent found for user');
    }

    const agentId = profile.dialogflow_agent_id;
    const agentName = `projects/${projectId}/locations/global/agents/${agentId}`;

    // Get user's script for language
    const { data: script } = await supabase
      .from('scripts')
      .select('language')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    const language = script?.language || 'he';

    console.log('Updating intents for agent:', agentName, 'language:', language);

    // Get existing intents
    const listIntentsResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/intents`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!listIntentsResponse.ok) {
      const errorText = await listIntentsResponse.text();
      console.error('Failed to list intents:', errorText);
      throw new Error('Failed to list existing intents');
    }

    const existingIntentsData = await listIntentsResponse.json();
    const existingIntents = existingIntentsData.intents || [];
    
    console.log('Existing intents:', existingIntents.map((i: any) => i.displayName));

    // Create a map of existing intents by display name
    const existingIntentsMap = new Map<string, string>();
    for (const intent of existingIntents) {
      existingIntentsMap.set(intent.displayName, intent.name);
    }

    // Get expanded intents
    const expandedIntents = getExpandedIntents(language);
    const results: { intent: string; action: string; success: boolean }[] = [];

    for (const intent of expandedIntents) {
      const existingIntentName = existingIntentsMap.get(intent.displayName);

      if (existingIntentName) {
        // Update existing intent
        console.log('Updating intent:', intent.displayName);
        
        const updateResponse = await fetch(
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
              ...(intent.parameters ? { parameters: intent.parameters } : {})
            }),
          }
        );

        if (updateResponse.ok) {
          results.push({ intent: intent.displayName, action: 'updated', success: true });
        } else {
          const errorText = await updateResponse.text();
          console.error('Failed to update intent:', intent.displayName, errorText);
          results.push({ intent: intent.displayName, action: 'update_failed', success: false });
        }
      } else {
        // Create new intent
        console.log('Creating intent:', intent.displayName);
        
        const createResponse = await fetch(
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

        if (createResponse.ok) {
          results.push({ intent: intent.displayName, action: 'created', success: true });
        } else {
          const errorText = await createResponse.text();
          console.error('Failed to create intent:', intent.displayName, errorText);
          results.push({ intent: intent.displayName, action: 'create_failed', success: false });
        }
      }
    }

    // Train the agent to apply changes
    console.log('Training agent to apply intent changes...');
    const trainResponse = await fetch(
      `https://dialogflow.googleapis.com/v3/${agentName}/flows/00000000-0000-0000-0000-000000000000:train`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const trainingStarted = trainResponse.ok;
    if (!trainingStarted) {
      console.log('Training request status:', trainResponse.status);
    }

    return new Response(
      JSON.stringify({
        success: true,
        agent_id: agentId,
        results,
        training_started: trainingStarted,
        message: `Updated ${results.filter(r => r.success).length}/${results.length} intents`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error updating intents:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
