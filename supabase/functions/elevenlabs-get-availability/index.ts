import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Parse request body - this comes from ElevenLabs webhook
    const body = await req.json();
    console.log("Get availability request:", JSON.stringify(body));

    // Extract agent_id to find the user
    const agentId = body.agent_id || body.conversation?.agent_id;
    const requestedDate = body.date; // Optional: specific date to check

    if (!agentId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Could not identify the business" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find user by agent_id
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, business_name, business_type, phone, address")
      .eq("elevenlabs_agent_id", agentId)
      .single();

    if (profileError || !profile) {
      console.error("Profile not found:", profileError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Business not found" 
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
      .single();

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
    };

    console.log("Returning availability:", JSON.stringify(response));

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error getting availability:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
