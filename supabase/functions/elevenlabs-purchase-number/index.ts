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
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY is not configured');
    }

    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create Supabase client with user's token
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    // Get user from token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { phone_number_id, agent_id } = await req.json();

    if (!phone_number_id || !agent_id) {
      throw new Error('phone_number_id and agent_id are required');
    }

    // Purchase the phone number from ElevenLabs
    const purchaseResponse = await fetch(
      'https://api.elevenlabs.io/v1/convai/phone-numbers/purchase',
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone_number_id: phone_number_id,
        }),
      }
    );

    if (!purchaseResponse.ok) {
      const errorText = await purchaseResponse.text();
      console.error('ElevenLabs purchase error:', purchaseResponse.status, errorText);
      throw new Error(`Failed to purchase number: ${purchaseResponse.status}`);
    }

    const purchaseData = await purchaseResponse.json();
    const purchasedPhoneId = purchaseData.phone_number_id || purchaseData.id;
    const phoneNumber = purchaseData.phone_number;
    const countryCode = purchaseData.country_code || 'IL';
    const monthlyCost = purchaseData.monthly_cost || null;

    // Connect the purchased number to the agent
    const connectResponse = await fetch(
      `https://api.elevenlabs.io/v1/convai/phone-numbers/${purchasedPhoneId}/agent`,
      {
        method: 'PATCH',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: agent_id,
        }),
      }
    );

    if (!connectResponse.ok) {
      const errorText = await connectResponse.text();
      console.error('ElevenLabs connect error:', connectResponse.status, errorText);
      // Don't throw - number was purchased, just not connected yet
    }

    // Save to database
    const { data: phoneRecord, error: dbError } = await supabase
      .from('phone_numbers')
      .insert({
        user_id: user.id,
        elevenlabs_phone_id: purchasedPhoneId,
        phone_number: phoneNumber,
        country_code: countryCode,
        status: 'active',
        monthly_cost: monthlyCost,
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
        phone_number: phoneRecord 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error purchasing number:', error);
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
