import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    if (!ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY is not configured');
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

    // Filter and format voices - prioritize Hebrew-compatible voices
    const voices = data.voices.map((voice: any) => ({
      voice_id: voice.voice_id,
      name: voice.name,
      preview_url: voice.preview_url,
      category: voice.category,
      labels: voice.labels,
      description: voice.description,
    }));

    // Sort to put multilingual voices first (they support Hebrew better)
    const sortedVoices = voices.sort((a: any, b: any) => {
      const aMultilingual = a.labels?.accent === 'multilingual' || a.name.toLowerCase().includes('multilingual');
      const bMultilingual = b.labels?.accent === 'multilingual' || b.name.toLowerCase().includes('multilingual');
      if (aMultilingual && !bMultilingual) return -1;
      if (!aMultilingual && bMultilingual) return 1;
      return 0;
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        voices: sortedVoices 
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
