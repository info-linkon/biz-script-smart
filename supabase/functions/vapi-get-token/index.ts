import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const VAPI_PUBLIC_KEY = Deno.env.get("VAPI_PUBLIC_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!VAPI_PUBLIC_KEY) {
      throw new Error("VAPI_PUBLIC_KEY is not configured");
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    // Get auth token from request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    
    // Create Supabase client
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Verify user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's Vapi assistant ID from profile
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("vapi_assistant_id, voice_provider")
      .eq("user_id", user.id)
      .single();

    if (profileError) {
      console.error("Error fetching profile:", profileError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch user profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let assistantId = profile?.vapi_assistant_id;

    // If no Vapi assistant exists, create one first
    if (!assistantId) {
      console.log("No Vapi assistant found, creating new assistant...");
      
      // Call the create-assistant function
      const createAssistantResponse = await fetch(
        `${SUPABASE_URL}/functions/v1/vapi-create-assistant`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      if (!createAssistantResponse.ok) {
        const errorText = await createAssistantResponse.text();
        console.error("Failed to create Vapi assistant:", errorText);
        return new Response(
          JSON.stringify({ error: "Failed to create Vapi assistant for testing" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const createAssistantData = await createAssistantResponse.json();
      assistantId = createAssistantData.assistant_id;

      if (!assistantId) {
        return new Response(
          JSON.stringify({ error: "Vapi assistant creation did not return an assistant ID" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Created new Vapi assistant:", assistantId);
    }

    // For Vapi, we return the public key and assistant ID
    // The client uses these to connect directly to Vapi
    console.log("Returning Vapi credentials for assistant:", assistantId);

    return new Response(
      JSON.stringify({ 
        public_key: VAPI_PUBLIC_KEY,
        assistant_id: assistantId,
        provider: 'vapi'
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("Error in vapi-get-token:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
