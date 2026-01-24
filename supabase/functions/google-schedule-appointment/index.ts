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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { 
      user_id,
      customer_name,
      customer_phone,
      customer_email,
      date,
      time,
      service,
      notes
    } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse date and time
    let startTime: Date;
    try {
      if (date && time) {
        startTime = new Date(`${date}T${time}`);
      } else if (date) {
        startTime = new Date(date);
      } else {
        // Default to tomorrow at 10am
        startTime = new Date();
        startTime.setDate(startTime.getDate() + 1);
        startTime.setHours(10, 0, 0, 0);
      }
    } catch {
      startTime = new Date();
      startTime.setDate(startTime.getDate() + 1);
      startTime.setHours(10, 0, 0, 0);
    }

    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour default

    // Check availability
    const dayOfWeek = startTime.getDay();
    const timeStr = startTime.toTimeString().slice(0, 5);

    const { data: availability } = await supabase
      .from('availability')
      .select('*')
      .eq('user_id', user_id)
      .eq('day_of_week', dayOfWeek)
      .eq('is_available', true)
      .gte('end_time', timeStr)
      .lte('start_time', timeStr)
      .maybeSingle();

    // Check for conflicting appointments
    const { data: conflicts } = await supabase
      .from('appointments')
      .select('id')
      .eq('user_id', user_id)
      .neq('status', 'cancelled')
      .gte('start_time', startTime.toISOString())
      .lt('start_time', endTime.toISOString());

    if (conflicts && conflicts.length > 0) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Time slot not available',
          message_he: 'הזמן הזה תפוס, אנא בחר זמן אחר',
          message_en: 'This time slot is not available, please choose another time'
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create appointment
    const title = service ? `${service} - ${customer_name || 'לקוח'}` : `פגישה עם ${customer_name || 'לקוח'}`;

    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert({
        user_id,
        customer_name: customer_name || 'לקוח',
        customer_phone,
        customer_email,
        title,
        description: notes || service,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        status: 'scheduled'
      })
      .select()
      .single();

    if (appointmentError) {
      console.error('Error creating appointment:', appointmentError);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Failed to create appointment',
          details: appointmentError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format response
    const formattedDate = startTime.toLocaleDateString('he-IL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const formattedTime = startTime.toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit'
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        appointment_id: appointment.id,
        formatted_date: formattedDate,
        formatted_time: formattedTime,
        message_he: `הפגישה נקבעה בהצלחה ל-${formattedDate} בשעה ${formattedTime}`,
        message_en: `Appointment scheduled for ${formattedDate} at ${formattedTime}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error scheduling appointment:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
