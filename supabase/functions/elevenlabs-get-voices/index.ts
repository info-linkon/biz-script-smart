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
    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

    if (!ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY is not configured');
    }

    // Validate auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get language parameter from request body
    let language = 'he'; // Default to Hebrew
    try {
      const body = await req.json();
      if (body.language) {
        language = body.language;
      }
    } catch {
      // No body or invalid JSON, use default
    }

    // Fetch available voices from ElevenLabs
    const response = await fetch(
      'https://api.elevenlabs.io/v1/voices',
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs voices error:', response.status, errorText);
      throw new Error(`Failed to fetch voices: ${response.status}`);
    }

    const data = await response.json();

    // Filter and format voices based on language
    const voices = data.voices.map((voice: any) => ({
      voice_id: voice.voice_id,
      name: voice.name,
      preview_url: voice.preview_url,
      category: voice.category,
      labels: voice.labels,
      description: voice.description,
    }));

    // Filter voices based on language compatibility
    // Multilingual voices support Hebrew, Arabic, and English
    // For Hebrew and Arabic, prioritize multilingual voices
    // For English, all voices work but prioritize native English
    const filteredVoices = voices.filter((voice: any) => {
      const accent = voice.labels?.accent?.toLowerCase() || '';
      const name = voice.name.toLowerCase();
      const isMultilingual = accent.includes('multilingual') || 
                             name.includes('multilingual') ||
                             accent.includes('international');
      
      // For Hebrew and Arabic, we need multilingual voices
      if (language === 'he' || language === 'ar') {
        return isMultilingual;
      }
      
      // For English, prefer native English voices but include multilingual too
      if (language === 'en') {
        const isEnglish = accent.includes('american') || 
                          accent.includes('british') || 
                          accent.includes('english') ||
                          accent.includes('australian') ||
                          accent.includes('irish') ||
                          accent.includes('scottish');
        return isEnglish || isMultilingual;
      }
      
      return true;
    });

    // Sort voices - multilingual first for Hebrew/Arabic, quality voices first for English
    const sortedVoices = filteredVoices.sort((a: any, b: any) => {
      const aMultilingual = a.labels?.accent?.toLowerCase()?.includes('multilingual') || 
                            a.name.toLowerCase().includes('multilingual');
      const bMultilingual = b.labels?.accent?.toLowerCase()?.includes('multilingual') || 
                            b.name.toLowerCase().includes('multilingual');
      
      // For Hebrew and Arabic, prioritize multilingual voices
      if (language === 'he' || language === 'ar') {
        if (aMultilingual && !bMultilingual) return -1;
        if (!aMultilingual && bMultilingual) return 1;
      }
      
      // For English, sort by category (premade first)
      if (a.category === 'premade' && b.category !== 'premade') return -1;
      if (a.category !== 'premade' && b.category === 'premade') return 1;
      
      return 0;
    });

    console.log(`Returning ${sortedVoices.length} voices for language: ${language}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        voices: sortedVoices,
        language: language
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error fetching voices:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
