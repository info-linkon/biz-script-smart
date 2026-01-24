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
    const { user_id, date, days_ahead = 7 } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get availability settings
    const { data: availabilitySettings, error: availError } = await supabase
      .from('availability')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_available', true)
      .order('day_of_week');

    if (availError) {
      console.error('Error fetching availability:', availError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch availability' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If specific date requested
    if (date) {
      const requestedDate = new Date(date);
      const dayOfWeek = requestedDate.getDay();
      
      const dayAvailability = availabilitySettings?.find(a => a.day_of_week === dayOfWeek);
      
      if (!dayAvailability) {
        return new Response(
          JSON.stringify({ 
            available: false,
            message_he: 'אנחנו לא פתוחים ביום זה',
            message_en: 'We are not open on this day'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get existing appointments for this date
      const startOfDay = new Date(requestedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(requestedDate);
      endOfDay.setHours(23, 59, 59, 999);

      const { data: appointments } = await supabase
        .from('appointments')
        .select('start_time, end_time')
        .eq('user_id', user_id)
        .neq('status', 'cancelled')
        .gte('start_time', startOfDay.toISOString())
        .lte('start_time', endOfDay.toISOString());

      // Generate available time slots (1-hour intervals)
      const availableSlots: string[] = [];
      const [startHour, startMin] = dayAvailability.start_time.split(':').map(Number);
      const [endHour, endMin] = dayAvailability.end_time.split(':').map(Number);

      for (let hour = startHour; hour < endHour; hour++) {
        const slotTime = `${hour.toString().padStart(2, '0')}:00`;
        const slotStart = new Date(requestedDate);
        slotStart.setHours(hour, 0, 0, 0);
        
        // Check if slot conflicts with existing appointment
        const hasConflict = appointments?.some(apt => {
          const aptStart = new Date(apt.start_time);
          const aptEnd = new Date(apt.end_time);
          return slotStart >= aptStart && slotStart < aptEnd;
        });

        if (!hasConflict) {
          availableSlots.push(slotTime);
        }
      }

      return new Response(
        JSON.stringify({ 
          available: availableSlots.length > 0,
          date: date,
          slots: availableSlots,
          business_hours: `${dayAvailability.start_time.slice(0, 5)}-${dayAvailability.end_time.slice(0, 5)}`,
          message_he: availableSlots.length > 0 ? 
            `יש לנו ${availableSlots.length} זמנים פנויים` : 
            'אין זמנים פנויים ביום זה',
          message_en: availableSlots.length > 0 ? 
            `We have ${availableSlots.length} available slots` : 
            'No available slots on this day'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return general availability for next N days
    const dayNames = {
      he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
      en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    };

    const availabilityByDay = availabilitySettings?.map(a => ({
      day_of_week: a.day_of_week,
      day_name_he: dayNames.he[a.day_of_week],
      day_name_en: dayNames.en[a.day_of_week],
      start_time: a.start_time.slice(0, 5),
      end_time: a.end_time.slice(0, 5),
      is_available: a.is_available
    })) || [];

    // Generate next available dates
    const upcomingDates: any[] = [];
    const today = new Date();
    
    for (let i = 0; i < days_ahead; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dayOfWeek = date.getDay();
      
      const dayAvail = availabilitySettings?.find(a => a.day_of_week === dayOfWeek);
      if (dayAvail) {
        upcomingDates.push({
          date: date.toISOString().split('T')[0],
          day_of_week: dayOfWeek,
          day_name_he: dayNames.he[dayOfWeek],
          day_name_en: dayNames.en[dayOfWeek],
          hours: `${dayAvail.start_time.slice(0, 5)}-${dayAvail.end_time.slice(0, 5)}`
        });
      }
    }

    // Format summary message
    const workingDays = availabilityByDay.filter(d => d.is_available);
    const summaryHe = workingDays.length > 0 ?
      `אנחנו פתוחים ב${workingDays.map(d => d.day_name_he).join(', ')}` :
      'לא הוגדרו שעות פעילות';
    
    const summaryEn = workingDays.length > 0 ?
      `We are open on ${workingDays.map(d => d.day_name_en).join(', ')}` :
      'No business hours configured';

    return new Response(
      JSON.stringify({ 
        availability: availabilityByDay,
        upcoming_dates: upcomingDates,
        summary_he: summaryHe,
        summary_en: summaryEn
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error getting availability:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
