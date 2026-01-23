import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const VAPI_API_KEY = Deno.env.get('VAPI_API_KEY');
    const VAPI_PUBLIC_KEY = Deno.env.get('VAPI_PUBLIC_KEY');

    if (!VAPI_API_KEY) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'VAPI_API_KEY not configured',
          details: { api_key: false, public_key: !!VAPI_PUBLIC_KEY }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Test the API key by listing assistants (simple GET request)
    const response = await fetch('https://api.vapi.ai/assistant?limit=1', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Vapi API connection failed',
          status: response.status,
          details: errorText
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Vapi connection successful!',
        secrets: {
          api_key: '✅ Configured',
          public_key: VAPI_PUBLIC_KEY ? '✅ Configured' : '❌ Missing'
        },
        assistants_count: Array.isArray(data) ? data.length : 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Vapi test error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
