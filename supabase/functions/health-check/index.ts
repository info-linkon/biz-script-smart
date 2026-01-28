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
    const mediaBridgeUrl = Deno.env.get('MEDIA_BRIDGE_URL');
    const mediaBridgeSecret = Deno.env.get('MEDIA_BRIDGE_SECRET') || '';
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch Media Bridge health if configured
    let mediaBridgeStatus: any = null;
    if (mediaBridgeUrl) {
      try {
        const healthResponse = await fetch(`${mediaBridgeUrl}/health`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        
        if (healthResponse.ok) {
          mediaBridgeStatus = await healthResponse.json();
        } else {
          mediaBridgeStatus = { 
            status: 'error', 
            error: `HTTP ${healthResponse.status}` 
          };
        }
      } catch (error: unknown) {
        mediaBridgeStatus = { 
          status: 'unreachable', 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }
    }

    // Fetch Media Bridge stats (protected endpoint)
    let mediaBridgeStats: any = null;
    if (mediaBridgeUrl && mediaBridgeSecret) {
      try {
        const statsResponse = await fetch(`${mediaBridgeUrl}/stats`, {
          method: 'GET',
          headers: { 
            'Accept': 'application/json',
            'Authorization': `Bearer ${mediaBridgeSecret}`
          }
        });
        
        if (statsResponse.ok) {
          mediaBridgeStats = await statsResponse.json();
        }
      } catch (error) {
        console.error('Failed to fetch Media Bridge stats:', error);
      }
    }

    // Get recent system health data
    const { data: healthHistory } = await supabase
      .from('system_health')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(100);

    // Get active calls count
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    const { count: activeCalls } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'in_progress')
      .gte('created_at', fiveMinutesAgo.toISOString());

    // Get recent call metrics
    const { data: recentMetrics } = await supabase
      .from('call_metrics')
      .select('ttfs_ms, end_to_audio_ms, stt_failures, barge_in_count')
      .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    // Calculate averages
    let avgTtfs = 0;
    let avgEndToAudio = 0;
    let totalSttFailures = 0;
    let totalBargeIns = 0;

    if (recentMetrics && recentMetrics.length > 0) {
      const ttfsValues = recentMetrics.filter(m => m.ttfs_ms).map(m => m.ttfs_ms!);
      const etaValues = recentMetrics.filter(m => m.end_to_audio_ms).map(m => m.end_to_audio_ms!);
      
      if (ttfsValues.length > 0) {
        avgTtfs = Math.round(ttfsValues.reduce((a, b) => a + b, 0) / ttfsValues.length);
      }
      if (etaValues.length > 0) {
        avgEndToAudio = Math.round(etaValues.reduce((a, b) => a + b, 0) / etaValues.length);
      }
      
      totalSttFailures = recentMetrics.reduce((sum, m) => sum + (m.stt_failures || 0), 0);
      totalBargeIns = recentMetrics.reduce((sum, m) => sum + (m.barge_in_count || 0), 0);
    }

    // Get rate limit events in last hour
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const { count: rateLimitEvents } = await supabase
      .from('rate_limit_events')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneHourAgo.toISOString());

    // Get billing alerts
    const { data: billingAlerts } = await supabase
      .from('billing_alerts')
      .select('*')
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(10);

    // Compile health status
    const healthStatus = {
      timestamp: now.toISOString(),
      mediaBridge: {
        configured: !!mediaBridgeUrl,
        status: mediaBridgeStatus,
        stats: mediaBridgeStats
      },
      calls: {
        active: activeCalls || 0
      },
      performance: {
        avgTtfsMs: avgTtfs,
        avgEndToAudioMs: avgEndToAudio,
        sttFailures24h: totalSttFailures,
        bargeIns24h: totalBargeIns,
        metricsCount: recentMetrics?.length || 0
      },
      rateLimiting: {
        eventsLastHour: rateLimitEvents || 0
      },
      alerts: {
        unreadBilling: billingAlerts?.length || 0,
        billingAlerts: billingAlerts || []
      },
      healthHistory: healthHistory?.slice(0, 10) || []
    };

    // Store current health snapshot
    await supabase.from('system_health').insert({
      active_calls: activeCalls || 0,
      avg_ttfs_ms: avgTtfs || null,
      avg_end_to_audio_ms: avgEndToAudio || null,
      error_count: totalSttFailures,
      stt_success_rate: recentMetrics && recentMetrics.length > 0 
        ? Math.round((1 - totalSttFailures / recentMetrics.length) * 100) 
        : null,
      circuit_breaker_status: mediaBridgeStats?.circuitBreaker || null
    });

    return new Response(
      JSON.stringify(healthStatus),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error: unknown) {
    console.error('Health check error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Health check failed', 
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
