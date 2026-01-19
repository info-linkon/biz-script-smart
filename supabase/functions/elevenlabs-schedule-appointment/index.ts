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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const requestData = await req.json();
    const {
      user_id,
      call_id,
      customer_name,
      customer_phone,
      customer_email,
      preferred_date,
      preferred_time,
      reason,
      duration_minutes = 60,
    } = requestData;

    console.log('Schedule appointment request:', requestData);

    if (!user_id || !customer_name || !preferred_date || !preferred_time) {
      throw new Error('Missing required fields: user_id, customer_name, preferred_date, preferred_time');
    }

    // Parse the date and time
    const [year, month, day] = preferred_date.split('-').map(Number);
    const [hours, minutes] = preferred_time.split(':').map(Number);
    
    const startTime = new Date(year, month - 1, day, hours, minutes);
    const endTime = new Date(startTime.getTime() + duration_minutes * 60 * 1000);
    const dayOfWeek = startTime.getDay();

    // Check availability for this day
    const { data: availability, error: availError } = await supabase
      .from('availability')
      .select('*')
      .eq('user_id', user_id)
      .eq('day_of_week', dayOfWeek)
      .eq('is_available', true)
      .single();

    if (availError || !availability) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `מצטער, העסק לא זמין ביום זה. נסה יום אחר.`,
          available: false,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if the requested time is within availability hours
    const requestedTimeStr = preferred_time;
    const availStart = availability.start_time;
    const availEnd = availability.end_time;

    if (requestedTimeStr < availStart || requestedTimeStr >= availEnd) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `הזמן המבוקש לא זמין. שעות הפעילות ביום זה הן ${availStart} עד ${availEnd}.`,
          available: false,
          available_hours: { start: availStart, end: availEnd },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for conflicting appointments
    const { data: conflicts, error: conflictError } = await supabase
      .from('appointments')
      .select('*')
      .eq('user_id', user_id)
      .neq('status', 'cancelled')
      .or(`start_time.lte.${endTime.toISOString()},end_time.gte.${startTime.toISOString()}`);

    if (conflicts && conflicts.length > 0) {
      // Find the next available slot
      const suggestedTime = new Date(conflicts[0].end_time);
      
      return new Response(
        JSON.stringify({
          success: false,
          message: `הזמן המבוקש תפוס. האם ${suggestedTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} מתאים לך?`,
          available: false,
          suggested_time: suggestedTime.toISOString(),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create the appointment
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert({
        user_id: user_id,
        customer_name: customer_name,
        customer_phone: customer_phone,
        customer_email: customer_email,
        title: reason || `פגישה עם ${customer_name}`,
        description: reason,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        status: 'scheduled',
        created_from_call: call_id || null,
      })
      .select()
      .single();

    if (appointmentError) {
      console.error('Failed to create appointment:', appointmentError);
      throw new Error('Failed to create appointment');
    }

    // Update the call record with the scheduled appointment
    if (call_id) {
      await supabase
        .from('calls')
        .update({
          appointment_scheduled: appointment.id,
          caller_name: customer_name,
          caller_phone: customer_phone,
        })
        .eq('id', call_id);
    }

    // Increment appointment count for usage tracking
    const monthYear = `${startTime.getFullYear()}-${String(startTime.getMonth() + 1).padStart(2, '0')}`;
    
    const { data: existingUsage } = await supabase
      .from('usage_stats')
      .select('*')
      .eq('user_id', user_id)
      .eq('month_year', monthYear)
      .single();

    if (existingUsage) {
      await supabase
        .from('usage_stats')
        .update({ appointments_count: existingUsage.appointments_count + 1 })
        .eq('id', existingUsage.id);
    } else {
      await supabase
        .from('usage_stats')
        .insert({
          user_id: user_id,
          month_year: monthYear,
          appointments_count: 1,
          calls_count: 0,
        });
    }

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
        message: `מעולה! הפגישה נקבעה ל${formattedDate} בשעה ${formattedTime}. נשלח לך אישור בקרוב.`,
        appointment: {
          id: appointment.id,
          date: formattedDate,
          time: formattedTime,
          customer_name: customer_name,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Schedule appointment error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'מצטער, לא הצלחתי לקבוע את הפגישה. נסה שוב או השאר פרטים ונחזור אליך.',
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
