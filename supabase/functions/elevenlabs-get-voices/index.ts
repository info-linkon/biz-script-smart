import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Known multilingual voices that support Hebrew, Arabic, and other languages
const MULTILINGUAL_VOICE_IDS = [
  'iP95p4xoKVk53GoZ742B', // Chris
  'JBFqnCBsd6RMkjVDRZzb', // George
  'N2lVS1w4EtoT3dr4eOWO', // Callum
  'XrExE9yKIg1WjnnlVkGX', // Matilda
  'pFZP5JQG7iQjIQuC4Bku', // Lily
  'onwK4e9ZLuTAKqWW03F9', // Daniel
  'TX3LPaxmHKxFdv7VOQHJ', // Liam
  'EXAVITQu4vr4xnSDxMaL', // Sarah
  'CwhRBWXzGAHq8TQ4Fs17', // Roger
  'FGY2WhTYpPnrIDTdsKH5', // Laura
  'IKne3meq5aSn9XLyUdCD', // Charlie
  'SAz9YHcvj6GT2YYXdXww', // River
  'Xb7hH8MSUJpSbSDYk0k2', // Alice
  'bIHbv24MWmeRgasZH58o', // Will
  'cgSgspJ2msm6clMCkdW9', // Jessica
  'cjVigY5qzO86Huf0OWal', // Eric
  'nPczCjzI2devNBz1zQrb', // Brian
];

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
    // For Hebrew and Arabic, use known multilingual voices from the hardcoded list
    // For English, include native English voices as well
    const filteredVoices = voices.filter((voice: any) => {
      // For Hebrew and Arabic, only return known multilingual voices
      if (language === 'he' || language === 'ar') {
        return MULTILINGUAL_VOICE_IDS.includes(voice.voice_id);
      }
      
      // For English, prefer native English voices but include multilingual too
      if (language === 'en') {
        const accent = voice.labels?.accent?.toLowerCase() || '';
        const isEnglish = accent.includes('american') || 
                          accent.includes('british') || 
                          accent.includes('english') ||
                          accent.includes('australian') ||
                          accent.includes('irish') ||
                          accent.includes('scottish');
        const isMultilingual = MULTILINGUAL_VOICE_IDS.includes(voice.voice_id);
        return isEnglish || isMultilingual;
      }
      
      return true;
    });

    // Sort voices - multilingual (from our list) first for Hebrew/Arabic
    const sortedVoices = filteredVoices.sort((a: any, b: any) => {
      const aIsKnown = MULTILINGUAL_VOICE_IDS.includes(a.voice_id);
      const bIsKnown = MULTILINGUAL_VOICE_IDS.includes(b.voice_id);
      
      // For Hebrew and Arabic, prioritize known multilingual voices
      if (language === 'he' || language === 'ar') {
        if (aIsKnown && !bIsKnown) return -1;
        if (!aIsKnown && bIsKnown) return 1;
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
