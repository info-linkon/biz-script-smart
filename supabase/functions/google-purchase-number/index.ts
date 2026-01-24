import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!twilioAccountSid || !twilioAuthToken) {
      return new Response(
        JSON.stringify({ error: 'Twilio credentials not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.user.id;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { phone_number_sid, country_code = 'IL' } = body;

    if (!phone_number_sid) {
      return new Response(
        JSON.stringify({ error: 'phone_number_sid is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user profile to check for Dialogflow agent
    const { data: profile } = await supabase
      .from('profiles')
      .select('dialogflow_agent_id, business_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (!profile?.dialogflow_agent_id) {
      return new Response(
        JSON.stringify({ error: 'Please create a Dialogflow agent first' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Purchase the number from Twilio
    const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
    
    // The webhook URL for incoming calls
    const voiceWebhookUrl = `${supabaseUrl}/functions/v1/twilio-dialogflow-bridge`;
    
    const purchaseResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/IncomingPhoneNumbers.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${twilioAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          PhoneNumber: phone_number_sid,
          VoiceUrl: voiceWebhookUrl,
          VoiceMethod: 'POST',
          FriendlyName: `${profile.business_name || 'Business'} - Dialogflow Agent`
        })
      }
    );

    if (!purchaseResponse.ok) {
      const errorText = await purchaseResponse.text();
      console.error('Twilio purchase error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to purchase phone number', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const purchaseData = await purchaseResponse.json();

    // Save phone number to database
    const { data: phoneRecord, error: phoneError } = await supabase
      .from('phone_numbers')
      .insert({
        user_id: userId,
        phone_number: purchaseData.phoneNumber,
        country_code: country_code,
        twilio_sid: purchaseData.sid,
        elevenlabs_phone_id: purchaseData.sid, // Using Twilio SID as the ID
        status: 'active',
        is_active: true,
        monthly_cost: 2.00, // Typical Twilio monthly cost
        purchased_at: new Date().toISOString()
      })
      .select()
      .single();

    if (phoneError) {
      console.error('Error saving phone number:', phoneError);
      // Don't fail - the number was purchased successfully
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        phone_number: purchaseData.phoneNumber,
        twilio_sid: purchaseData.sid,
        phone_record: phoneRecord,
        message: 'Phone number purchased and configured successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error purchasing phone number:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
