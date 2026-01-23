import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to extract parameters from different provider formats
function extractParams(body: any): {
  source: 'elevenlabs' | 'vapi' | 'direct';
  agent_id?: string;
  date?: string;
  user_id?: string;
} {
  // Check if this is from Vapi (has _source: 'vapi' or toolCallList)
  if (body._source === 'vapi' || body.message?.toolCallList) {
    console.log('Detected Vapi source');
    
    // If forwarded from vapi-webhook
    if (body._source === 'vapi') {
      const callData = body._call_data || {};
      return {
        source: 'vapi',
        agent_id: callData.assistantId || body.agent_id,
        date: body.date,
        user_id: callData.metadata?.user_id || body.user_id,
      };
    }
    
    // Direct Vapi tool call format
    const toolCall = body.message?.toolCallList?.[0];
    if (toolCall) {
      const args = toolCall.function?.arguments || toolCall.parameters || {};
      const callData = body.message?.call || body.call || {};
      return {
        source: 'vapi',
        agent_id: callData.assistantId,
        date: args.date,
        user_id: callData.metadata?.user_id,
      };
    }
  }
  
  // Check if this is from ElevenLabs (has dynamic_variables or conversation)
  if (body.dynamic_variables || body.conversation) {
    console.log('Detected ElevenLabs source');
    const vars = body.dynamic_variables || body;
    const conversation = body.conversation || {};
    return {
      source: 'elevenlabs',
      agent_id: conversation.agent_id || body.agent_id,
      date: vars.date,
      user_id: body.user_id,
    };
  }
  
  // Default: Direct call format
  console.log('Detected direct API call source');
  return {
    source: 'direct',
    agent_id: body.agent_id,
    date: body.date,
    user_id: body.user_id,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body
    const body = await req.json();
    console.log("Get availability raw request:", JSON.stringify(body, null, 2));

    // Extract parameters with dual-provider support
    const params = extractParams(body);
    console.log("Extracted params:", JSON.stringify(params, null, 2));

    const { source, agent_id, date: requestedDate, user_id } = params;

    // Find user by agent_id or user_id
    let profile: any = null;
    
    if (user_id) {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, business_name, business_type, phone, address")
        .eq("user_id", user_id)
        .maybeSingle();
      profile = data;
    }
    
    if (!profile && agent_id) {
      // Try ElevenLabs agent first
      const { data: elevenProfile } = await supabase
        .from("profiles")
        .select("user_id, business_name, business_type, phone, address")
        .eq("elevenlabs_agent_id", agent_id)
        .maybeSingle();
      
      if (elevenProfile) {
        profile = elevenProfile;
      } else {
        // Try Vapi assistant
        const { data: vapiProfile } = await supabase
          .from("profiles")
          .select("user_id, business_name, business_type, phone, address")
          .eq("vapi_assistant_id", agent_id)
          .maybeSingle();
        profile = vapiProfile;
      }
    }

    if (!profile) {
      console.error("Profile not found for agent_id:", agent_id, "user_id:", user_id);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "לא הצלחתי לזהות את העסק. אנא נסה שוב.",
          source: source,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get business availability schedule
    const { data: availability, error: availError } = await supabase
      .from("availability")
      .select("*")
      .eq("user_id", profile.user_id)
      .eq("is_available", true)
      .order("day_of_week");

    // Get existing appointments for the next 7 days to check busy slots
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const { data: appointments, error: apptError } = await supabase
      .from("appointments")
      .select("start_time, end_time, title")
      .eq("user_id", profile.user_id)
      .gte("start_time", today.toISOString())
      .lte("start_time", nextWeek.toISOString())
      .neq("status", "cancelled")
      .order("start_time");

    // Get script for business hours info
    const { data: script } = await supabase
      .from("scripts")
      .select("business_hours, services")
      .eq("user_id", profile.user_id)
      .eq("is_active", true)
      .maybeSingle();

    // Format availability by day
    const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    const dayNamesEn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const formattedAvailability = (availability || []).map((slot: any) => ({
      day: dayNames[slot.day_of_week],
      day_en: dayNamesEn[slot.day_of_week],
      day_number: slot.day_of_week,
      start_time: slot.start_time,
      end_time: slot.end_time,
    }));

    // Format busy slots
    const busySlots = (appointments || []).map((appt: any) => ({
      date: new Date(appt.start_time).toISOString().split("T")[0],
      start_time: new Date(appt.start_time).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
      end_time: new Date(appt.end_time).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
    }));

    // Build response
    const response = {
      success: true,
      business_name: profile.business_name,
      business_type: profile.business_type,
      phone: profile.phone,
      address: profile.address,
      business_hours: script?.business_hours || null,
      services: script?.services || [],
      weekly_availability: formattedAvailability,
      busy_slots_next_7_days: busySlots,
      message: formattedAvailability.length > 0
        ? `העסק פתוח בימים: ${formattedAvailability.map((s: any) => `${s.day} ${s.start_time}-${s.end_time}`).join(", ")}`
        : script?.business_hours || "לא הוגדרו שעות פעילות",
      source: source,
    };

    console.log(`Returning availability via ${source}:`, JSON.stringify(response, null, 2));

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error getting availability:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error",
        message: "מצטער, לא הצלחתי לקבל את מידע הזמינות. אנא נסה שוב."
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
