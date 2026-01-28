import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkTenantRateLimit, createRateLimitResponse, getRateLimitHeaders } from "../_shared/tenant-rate-limiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-user-id',
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
    console.log('Dialogflow webhook received:', JSON.stringify(body, null, 2));

    // Extract user ID from header (set when creating webhook)
    const userId = req.headers.get('x-agent-user-id');
    
    // Rate limiting for webhooks
    if (userId) {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                 req.headers.get('x-real-ip') || 
                 'unknown';
      
      const rateLimitResult = await checkTenantRateLimit(
        supabase,
        userId,
        null,
        ip,
        'webhook'
      );

      if (!rateLimitResult.allowed) {
        console.log(`[google-webhook] Rate limited: userId=${userId}, limitType=${rateLimitResult.limitType}`);
        const rateLimitHeaders = getRateLimitHeaders(rateLimitResult);
        return createRateLimitResponse('he', { ...corsHeaders, ...rateLimitHeaders });
      }
    }
    
    // Dialogflow CX webhook format
    const { 
      fulfillmentInfo,
      sessionInfo,
      languageCode
    } = body;

    const tag = fulfillmentInfo?.tag || '';
    const parameters = sessionInfo?.parameters || {};

    let responseMessages: any[] = [];
    let sessionParameters = { ...parameters };

    // Handle different webhook tags
    switch (tag) {
      case 'schedule_appointment':
      case 'schedule-appointment': {
        // Get appointment details from parameters
        const customerName = parameters.customer_name?.original || parameters.customer_name || '';
        const dateTime = parameters.date_time?.original || parameters.date_time || '';
        const customerPhone = parameters.phone_number?.original || parameters.phone_number || '';
        
        if (!userId) {
          responseMessages.push({
            text: {
              text: [languageCode?.startsWith('he') ? 
                'מצטער, לא ניתן לקבוע פגישה כרגע. נסה שוב מאוחר יותר.' :
                'Sorry, unable to schedule appointment. Please try again later.']
            }
          });
          break;
        }

        // Parse date/time
        let startTime: Date;
        try {
          if (typeof dateTime === 'object' && dateTime.date_time) {
            startTime = new Date(dateTime.date_time);
          } else if (typeof dateTime === 'string') {
            startTime = new Date(dateTime);
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

        const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour

        // Create appointment
        const { data: appointment, error: appointmentError } = await supabase
          .from('appointments')
          .insert({
            user_id: userId,
            customer_name: customerName || 'לקוח',
            customer_phone: customerPhone,
            title: `פגישה עם ${customerName || 'לקוח'}`,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            status: 'scheduled'
          })
          .select()
          .single();

        if (appointmentError) {
          console.error('Error creating appointment:', appointmentError);
          responseMessages.push({
            text: {
              text: [languageCode?.startsWith('he') ? 
                'מצטער, הייתה בעיה בקביעת הפגישה. אנא נסה שוב.' :
                'Sorry, there was a problem scheduling. Please try again.']
            }
          });
        } else {
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

          responseMessages.push({
            text: {
              text: [languageCode?.startsWith('he') ? 
                `מעולה! קבעתי לך פגישה ב-${formattedDate} בשעה ${formattedTime}. נתראה!` :
                `Great! I've scheduled your appointment for ${formattedDate} at ${formattedTime}. See you then!`]
            }
          });

          sessionParameters.appointment_confirmed = true;
          sessionParameters.appointment_id = appointment.id;
        }
        break;
      }

      case 'get_availability':
      case 'check-availability': {
        if (!userId) {
          responseMessages.push({
            text: {
              text: [languageCode?.startsWith('he') ? 
                'מצטער, לא ניתן לבדוק זמינות כרגע.' :
                'Sorry, unable to check availability right now.']
            }
          });
          break;
        }

        // Get availability for next 7 days
        const { data: availability, error: availError } = await supabase
          .from('availability')
          .select('*')
          .eq('user_id', userId)
          .eq('is_available', true)
          .order('day_of_week');

        if (availError || !availability?.length) {
          responseMessages.push({
            text: {
              text: [languageCode?.startsWith('he') ? 
                'אנחנו פתוחים בימים א׳-ה׳ בין 9:00 ל-17:00. מתי נוח לך?' :
                'We are open Sunday-Thursday 9am-5pm. When works for you?']
            }
          });
        } else {
          const dayNames = languageCode?.startsWith('he') ? 
            ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] :
            ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

          const availableDays = availability.map(a => {
            return `${dayNames[a.day_of_week]}: ${a.start_time.slice(0, 5)}-${a.end_time.slice(0, 5)}`;
          }).join(', ');

          responseMessages.push({
            text: {
              text: [languageCode?.startsWith('he') ? 
                `הזמינות שלנו: ${availableDays}. מתי נוח לך?` :
                `Our availability: ${availableDays}. When works for you?`]
            }
          });
        }
        break;
      }

      case 'leave_message':
      case 'take-message': {
        const message = parameters.message?.original || parameters.message || '';
        const callerName = parameters.customer_name?.original || parameters.customer_name || '';
        const callerPhone = parameters.phone_number?.original || parameters.phone_number || '';

        // Log the message as a call record
        if (userId) {
          await supabase
            .from('calls')
            .insert({
              user_id: userId,
              caller_name: callerName,
              caller_phone: callerPhone,
              summary: `הודעה: ${message}`,
              status: 'message',
              call_type: 'voice',
              language: languageCode?.startsWith('he') ? 'he' : 'en'
            });
        }

        responseMessages.push({
          text: {
            text: [languageCode?.startsWith('he') ? 
              'תודה! העברתי את ההודעה ונחזור אליך בהקדם.' :
              'Thank you! I have passed on your message and we will get back to you soon.']
          }
        });
        break;
      }

      default: {
        // Generic response for unhandled tags
        console.log('Unhandled webhook tag:', tag);
      }
    }

    // Dialogflow CX webhook response format
    const response = {
      fulfillmentResponse: {
        messages: responseMessages.length > 0 ? responseMessages : undefined
      },
      sessionInfo: {
        parameters: sessionParameters
      }
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ 
        fulfillmentResponse: {
          messages: [{
            text: {
              text: ['מצטער, אירעה שגיאה. אנא נסה שוב.']
            }
          }]
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});