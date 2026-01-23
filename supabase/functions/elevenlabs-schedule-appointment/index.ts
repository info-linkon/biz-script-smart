import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to extract parameters from different provider formats
function extractParams(body: any): {
  source: 'elevenlabs' | 'vapi' | 'direct';
  user_id?: string;
  call_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  date?: string;
  time?: string;
  service?: string;
  duration_minutes?: number;
  agent_id?: string;
} {
  // Check if this is from Vapi (has _source: 'vapi' or toolCallList)
  if (body._source === 'vapi' || body.message?.toolCallList) {
    console.log('Detected Vapi source');
    
    // If forwarded from vapi-webhook, params are at root level
    if (body._source === 'vapi') {
      const callData = body._call_data || {};
      return {
        source: 'vapi',
        user_id: body.user_id || callData.metadata?.user_id,
        call_id: body.call_id || callData.metadata?.call_id,
        customer_name: body.customer_name,
        customer_phone: body.customer_phone || callData.customer?.number,
        customer_email: body.customer_email,
        date: body.date || body.preferred_date,
        time: body.time || body.preferred_time,
        service: body.service || body.reason,
        duration_minutes: body.duration_minutes || 60,
        agent_id: callData.assistantId,
      };
    }
    
    // Direct Vapi tool call format (from Vapi's server calling this webhook)
    const toolCall = body.message?.toolCallList?.[0];
    if (toolCall) {
      const args = toolCall.function?.arguments || toolCall.parameters || {};
      const callData = body.message?.call || body.call || {};
      return {
        source: 'vapi',
        user_id: callData.metadata?.user_id,
        call_id: callData.metadata?.call_id || callData.id,
        customer_name: args.customer_name,
        customer_phone: args.customer_phone || callData.customer?.number,
        customer_email: args.customer_email,
        date: args.date || args.preferred_date,
        time: args.time || args.preferred_time,
        service: args.service || args.reason,
        duration_minutes: args.duration_minutes || 60,
        agent_id: callData.assistantId,
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
      user_id: body.user_id || vars.user_id,
      call_id: body.call_id || conversation.call_id,
      customer_name: vars.customer_name,
      customer_phone: vars.customer_phone,
      customer_email: vars.customer_email,
      date: vars.date || vars.preferred_date,
      time: vars.time || vars.preferred_time,
      service: vars.service || vars.reason,
      duration_minutes: vars.duration_minutes || 60,
      agent_id: conversation.agent_id,
    };
  }
  
  // Default: Direct call format (legacy or API test)
  console.log('Detected direct API call source');
  return {
    source: 'direct',
    user_id: body.user_id,
    call_id: body.call_id,
    customer_name: body.customer_name,
    customer_phone: body.customer_phone,
    customer_email: body.customer_email,
    date: body.date || body.preferred_date,
    time: body.time || body.preferred_time,
    service: body.service || body.reason,
    duration_minutes: body.duration_minutes || 60,
    agent_id: body.agent_id,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const requestBody = await req.json();
    console.log('Schedule appointment raw request:', JSON.stringify(requestBody, null, 2));

    // Extract parameters with dual-provider support
    const params = extractParams(requestBody);
    console.log('Extracted params:', JSON.stringify(params, null, 2));

    const {
      source,
      user_id,
      call_id,
      customer_name,
      customer_phone,
      customer_email,
      date: preferred_date,
      time: preferred_time,
      service: reason,
      duration_minutes = 60,
      agent_id,
    } = params;

    // If we don't have user_id but have agent_id, look up the user
    let finalUserId = user_id;
    if (!finalUserId && agent_id) {
      // Try ElevenLabs agent first
      let { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('elevenlabs_agent_id', agent_id)
        .maybeSingle();
      
      // If not found, try Vapi assistant
      if (!profile) {
        const { data: vapiProfile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('vapi_assistant_id', agent_id)
          .maybeSingle();
        profile = vapiProfile;
      }
      
      if (profile) {
        finalUserId = profile.user_id;
      }
    }

    if (!finalUserId || !customer_name || !preferred_date || !preferred_time) {
      const missing = [];
      if (!finalUserId) missing.push('user_id/agent_id');
      if (!customer_name) missing.push('customer_name');
      if (!preferred_date) missing.push('date');
      if (!preferred_time) missing.push('time');
      
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
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
      .eq('user_id', finalUserId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_available', true)
      .maybeSingle();

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
      .eq('user_id', finalUserId)
      .neq('status', 'cancelled')
      .or(`start_time.lte.${endTime.toISOString()},end_time.gte.${startTime.toISOString()}`);

    if (conflicts && conflicts.length > 0) {
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
        user_id: finalUserId,
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
      .eq('user_id', finalUserId)
      .eq('month_year', monthYear)
      .maybeSingle();

    if (existingUsage) {
      await supabase
        .from('usage_stats')
        .update({ appointments_count: existingUsage.appointments_count + 1 })
        .eq('id', existingUsage.id);
    } else {
      await supabase
        .from('usage_stats')
        .insert({
          user_id: finalUserId,
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

    console.log(`Appointment scheduled successfully via ${source} for user ${finalUserId}`);

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
        source: source,
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
