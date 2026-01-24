import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Google Cloud TTS voices optimized for Hebrew, Arabic, and English
const GOOGLE_VOICES = {
  he: [
    { voice_id: 'he-IL-Chirp3-HD-Aoede', name: 'Aoede (נקבה)', category: 'Chirp 3 HD', description: 'קול נשי איכותי במיוחד' },
    { voice_id: 'he-IL-Chirp3-HD-Charon', name: 'Charon (זכר)', category: 'Chirp 3 HD', description: 'קול גברי עמוק ואיכותי' },
    { voice_id: 'he-IL-Chirp3-HD-Kore', name: 'Kore (נקבה)', category: 'Chirp 3 HD', description: 'קול נשי חם וידידותי' },
    { voice_id: 'he-IL-Chirp3-HD-Fenrir', name: 'Fenrir (זכר)', category: 'Chirp 3 HD', description: 'קול גברי מקצועי' },
    { voice_id: 'he-IL-Chirp3-HD-Puck', name: 'Puck (זכר)', category: 'Chirp 3 HD', description: 'קול גברי צעיר ודינמי' },
    { voice_id: 'he-IL-Wavenet-A', name: 'Wavenet A (נקבה)', category: 'Wavenet', description: 'קול נשי טבעי' },
    { voice_id: 'he-IL-Wavenet-B', name: 'Wavenet B (זכר)', category: 'Wavenet', description: 'קול גברי טבעי' },
    { voice_id: 'he-IL-Wavenet-C', name: 'Wavenet C (נקבה)', category: 'Wavenet', description: 'קול נשי צעיר' },
    { voice_id: 'he-IL-Wavenet-D', name: 'Wavenet D (זכר)', category: 'Wavenet', description: 'קול גברי צעיר' },
    { voice_id: 'he-IL-Standard-A', name: 'Standard A (נקבה)', category: 'Standard', description: 'קול נשי סטנדרטי' },
    { voice_id: 'he-IL-Standard-B', name: 'Standard B (זכר)', category: 'Standard', description: 'קול גברי סטנדרטי' },
  ],
  ar: [
    { voice_id: 'ar-XA-Chirp3-HD-Aoede', name: 'Aoede (أنثى)', category: 'Chirp 3 HD', description: 'صوت نسائي عالي الجودة' },
    { voice_id: 'ar-XA-Chirp3-HD-Charon', name: 'Charon (ذكر)', category: 'Chirp 3 HD', description: 'صوت ذكوري عميق' },
    { voice_id: 'ar-XA-Chirp3-HD-Kore', name: 'Kore (أنثى)', category: 'Chirp 3 HD', description: 'صوت نسائي دافئ' },
    { voice_id: 'ar-XA-Chirp3-HD-Fenrir', name: 'Fenrir (ذكر)', category: 'Chirp 3 HD', description: 'صوت ذكوري احترافي' },
    { voice_id: 'ar-XA-Wavenet-A', name: 'Wavenet A (أنثى)', category: 'Wavenet', description: 'صوت نسائي طبيعي' },
    { voice_id: 'ar-XA-Wavenet-B', name: 'Wavenet B (ذكر)', category: 'Wavenet', description: 'صوت ذكوري طبيعي' },
    { voice_id: 'ar-XA-Wavenet-C', name: 'Wavenet C (ذكر)', category: 'Wavenet', description: 'صوت ذكوري شاب' },
    { voice_id: 'ar-XA-Wavenet-D', name: 'Wavenet D (أنثى)', category: 'Wavenet', description: 'صوت نسائي شاب' },
    { voice_id: 'ar-XA-Standard-A', name: 'Standard A (أنثى)', category: 'Standard', description: 'صوت نسائي قياسي' },
    { voice_id: 'ar-XA-Standard-B', name: 'Standard B (ذكر)', category: 'Standard', description: 'صوت ذكوري قياسي' },
  ],
  en: [
    { voice_id: 'en-US-Chirp3-HD-Aoede', name: 'Aoede (Female)', category: 'Chirp 3 HD', description: 'High quality female voice' },
    { voice_id: 'en-US-Chirp3-HD-Charon', name: 'Charon (Male)', category: 'Chirp 3 HD', description: 'Deep male voice' },
    { voice_id: 'en-US-Chirp3-HD-Kore', name: 'Kore (Female)', category: 'Chirp 3 HD', description: 'Warm female voice' },
    { voice_id: 'en-US-Chirp3-HD-Fenrir', name: 'Fenrir (Male)', category: 'Chirp 3 HD', description: 'Professional male voice' },
    { voice_id: 'en-US-Chirp3-HD-Puck', name: 'Puck (Male)', category: 'Chirp 3 HD', description: 'Young dynamic male voice' },
    { voice_id: 'en-US-Wavenet-A', name: 'Wavenet A (Male)', category: 'Wavenet', description: 'Natural male voice' },
    { voice_id: 'en-US-Wavenet-C', name: 'Wavenet C (Female)', category: 'Wavenet', description: 'Natural female voice' },
    { voice_id: 'en-US-Wavenet-D', name: 'Wavenet D (Male)', category: 'Wavenet', description: 'Young male voice' },
    { voice_id: 'en-US-Wavenet-F', name: 'Wavenet F (Female)', category: 'Wavenet', description: 'Young female voice' },
    { voice_id: 'en-US-Neural2-A', name: 'Neural2 A (Male)', category: 'Neural2', description: 'High quality neural male voice' },
    { voice_id: 'en-US-Neural2-C', name: 'Neural2 C (Female)', category: 'Neural2', description: 'High quality neural female voice' },
  ]
};

// Recommended voices for each language (best quality)
const RECOMMENDED_VOICES: Record<string, string[]> = {
  he: ['he-IL-Chirp3-HD-Aoede', 'he-IL-Chirp3-HD-Charon', 'he-IL-Chirp3-HD-Kore'],
  ar: ['ar-XA-Chirp3-HD-Aoede', 'ar-XA-Chirp3-HD-Charon', 'ar-XA-Chirp3-HD-Kore'],
  en: ['en-US-Chirp3-HD-Aoede', 'en-US-Chirp3-HD-Charon', 'en-US-Chirp3-HD-Kore']
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    
    // Validate auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get language from request body
    const body = await req.json().catch(() => ({}));
    const language = body.language || 'he';
    
    // Get voices for the requested language
    const languageVoices = GOOGLE_VOICES[language as keyof typeof GOOGLE_VOICES] || GOOGLE_VOICES.he;
    const recommendedList = RECOMMENDED_VOICES[language as keyof typeof RECOMMENDED_VOICES] || RECOMMENDED_VOICES.he;
    
    // Sort to put recommended voices first
    const sortedVoices = [...languageVoices].sort((a, b) => {
      const aRecommended = recommendedList.includes(a.voice_id);
      const bRecommended = recommendedList.includes(b.voice_id);
      if (aRecommended && !bRecommended) return -1;
      if (!aRecommended && bRecommended) return 1;
      // Then sort by category (Chirp 3 HD first)
      if (a.category === 'Chirp 3 HD' && b.category !== 'Chirp 3 HD') return -1;
      if (a.category !== 'Chirp 3 HD' && b.category === 'Chirp 3 HD') return 1;
      return 0;
    });

    // Add recommended flag to voices
    const voicesWithFlags = sortedVoices.map(voice => ({
      ...voice,
      is_recommended: recommendedList.includes(voice.voice_id),
      labels: {
        accent: voice.category
      }
    }));

    return new Response(
      JSON.stringify({ 
        success: true,
        voices: voicesWithFlags,
        language
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching Google voices:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
