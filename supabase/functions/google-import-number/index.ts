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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
    const { 
      phone_number, 
      twilio_account_sid, 
      twilio_auth_token,
      twilio_phone_sid,
      country_code = 'IL' 
    } = body;

    if (!phone_number || !twilio_account_sid || !twilio_auth_token || !twilio_phone_sid) {
      return new Response(
        JSON.stringify({ error: 'phone_number, twilio_account_sid, twilio_auth_token, and twilio_phone_sid are required' }),
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

    // Update the Twilio phone number to point to our webhook
    const twilioAuth = btoa(`${twilio_account_sid}:${twilio_auth_token}`);
    const voiceWebhookUrl = `${supabaseUrl}/functions/v1/twilio-dialogflow-bridge`;
    
    const updateResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio_account_sid}/IncomingPhoneNumbers/${twilio_phone_sid}.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${twilioAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          VoiceUrl: voiceWebhookUrl,
          VoiceMethod: 'POST',
          FriendlyName: `${profile.business_name || 'Business'} - Dialogflow Agent`
        })
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Twilio update error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to update phone number configuration', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const updateData = await updateResponse.json();

    // Save phone number to database
    const { data: phoneRecord, error: phoneError } = await supabase
      .from('phone_numbers')
      .insert({
        user_id: userId,
        phone_number: phone_number,
        country_code: country_code,
        twilio_sid: twilio_phone_sid,
        elevenlabs_phone_id: twilio_phone_sid, // Using Twilio SID as the ID
        status: 'active',
        is_active: true,
        purchased_at: new Date().toISOString()
      })
      .select()
      .single();

    if (phoneError) {
      console.error('Error saving phone number:', phoneError);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        phone_number: phone_number,
        twilio_sid: twilio_phone_sid,
        phone_record: phoneRecord,
        message: 'Phone number imported and configured successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error importing phone number:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
