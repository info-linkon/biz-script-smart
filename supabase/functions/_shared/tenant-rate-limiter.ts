/**
 * Tenant Rate Limiter
 * Shared module for rate limiting across Edge Functions
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface RateLimitConfig {
  voice_call: { perMinute: number; perHour: number };
  concurrent: { max: number };
  media_stream: { perMinute: number };
  webhook: { perMinute: number };
}

// Default rate limits per plan type
const planLimits: Record<string, RateLimitConfig> = {
  free: {
    voice_call: { perMinute: 5, perHour: 50 },
    concurrent: { max: 2 },
    media_stream: { perMinute: 10 },
    webhook: { perMinute: 30 }
  },
  basic: {
    voice_call: { perMinute: 15, perHour: 200 },
    concurrent: { max: 5 },
    media_stream: { perMinute: 30 },
    webhook: { perMinute: 100 }
  },
  professional: {
    voice_call: { perMinute: 30, perHour: 500 },
    concurrent: { max: 10 },
    media_stream: { perMinute: 60 },
    webhook: { perMinute: 200 }
  },
  enterprise: {
    voice_call: { perMinute: 100, perHour: 2000 },
    concurrent: { max: 50 },
    media_stream: { perMinute: 200 },
    webhook: { perMinute: 500 }
  }
};

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds
  limitType?: string;
}

// In-memory tracking for concurrent calls (per instance)
const activeCalls = new Map<string, Set<string>>();

/**
 * Check if a request is within rate limits
 */
export async function checkTenantRateLimit(
  supabase: SupabaseClient,
  userId: string,
  agentId: string | null,
  ip: string | null,
  operation: 'voice_call' | 'concurrent' | 'media_stream' | 'webhook'
): Promise<RateLimitResult> {
  try {
    // Get user's plan
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_plan_id')
      .eq('user_id', userId)
      .maybeSingle();

    // Get plan name
    let planName = 'free';
    if (profile?.subscription_plan_id) {
      const { data: plan } = await supabase
        .from('subscription_plans')
        .select('name')
        .eq('id', profile.subscription_plan_id)
        .maybeSingle();
      
      if (plan?.name) {
        planName = plan.name.toLowerCase();
      }
    }

    const limits = planLimits[planName] || planLimits.free;

    // Handle concurrent check (in-memory)
    if (operation === 'concurrent') {
      const userCalls = activeCalls.get(userId) || new Set();
      if (userCalls.size >= limits.concurrent.max) {
        await logRateLimitEvent(supabase, userId, agentId, ip, operation, 'concurrent_max');
        return {
          allowed: false,
          remaining: 0,
          resetIn: 60,
          limitType: 'concurrent_max'
        };
      }
      return {
        allowed: true,
        remaining: limits.concurrent.max - userCalls.size,
        resetIn: 0
      };
    }

    // Check rate limits from database
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Count recent events
    const { count: minuteCount } = await supabase
      .from('rate_limit_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('operation_type', operation)
      .gte('created_at', oneMinuteAgo.toISOString());

    const { count: hourCount } = await supabase
      .from('rate_limit_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('operation_type', operation)
      .gte('created_at', oneHourAgo.toISOString());

    const opLimits = limits[operation] as { perMinute: number; perHour?: number };
    
    // Check per-minute limit
    if ((minuteCount || 0) >= opLimits.perMinute) {
      await logRateLimitEvent(supabase, userId, agentId, ip, operation, 'per_minute');
      return {
        allowed: false,
        remaining: 0,
        resetIn: 60,
        limitType: 'per_minute'
      };
    }

    // Check per-hour limit (if applicable)
    if (opLimits.perHour && (hourCount || 0) >= opLimits.perHour) {
      await logRateLimitEvent(supabase, userId, agentId, ip, operation, 'per_hour');
      return {
        allowed: false,
        remaining: 0,
        resetIn: 3600,
        limitType: 'per_hour'
      };
    }

    return {
      allowed: true,
      remaining: opLimits.perMinute - (minuteCount || 0),
      resetIn: 60
    };

  } catch (error) {
    console.error('Rate limit check error:', error);
    // Allow on error to not block legitimate requests
    return { allowed: true, remaining: 100, resetIn: 60 };
  }
}

/**
 * Track call start for concurrent limiting
 */
export function trackCallStart(userId: string, callSid: string): void {
  if (!activeCalls.has(userId)) {
    activeCalls.set(userId, new Set());
  }
  activeCalls.get(userId)!.add(callSid);
}

/**
 * Track call end for concurrent limiting
 */
export function trackCallEnd(userId: string, callSid: string): void {
  const userCalls = activeCalls.get(userId);
  if (userCalls) {
    userCalls.delete(callSid);
    if (userCalls.size === 0) {
      activeCalls.delete(userId);
    }
  }
}

/**
 * Log rate limit event
 */
async function logRateLimitEvent(
  supabase: SupabaseClient,
  userId: string | null,
  agentId: string | null,
  ip: string | null,
  operation: string,
  limitType: string
): Promise<void> {
  try {
    await supabase.from('rate_limit_events').insert({
      user_id: userId,
      agent_id: agentId,
      ip_address: ip,
      operation_type: operation,
      limit_type: limitType
    });
  } catch (error) {
    console.error('Failed to log rate limit event:', error);
  }
}

/**
 * Get rate limit headers for response
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetIn.toString(),
    ...(result.limitType ? { 'X-RateLimit-Type': result.limitType } : {})
  };
}

/**
 * Create a rate limit response
 */
export function createRateLimitResponse(
  language: string = 'he',
  headers: Record<string, string> = {}
): Response {
  const messages: Record<string, string> = {
    he: 'הגעת למגבלת השיחות. נסה שוב מאוחר יותר.',
    ar: 'لقد وصلت إلى حد المكالمات. حاول مرة أخرى لاحقًا.',
    en: 'You have reached the call limit. Please try again later.'
  };

  const message = messages[language] || messages.en;

  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded', message }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }
  );
}

/**
 * Create a TwiML rate limit response
 */
export function createRateLimitTwiml(language: string = 'he'): string {
  const messages: Record<string, { text: string; lang: string; voice: string }> = {
    he: {
      text: 'מצטערים, הגעת למגבלת השיחות. נסה שוב מאוחר יותר. להתראות.',
      lang: 'he-IL',
      voice: 'Google.he-IL-Wavenet-A'
    },
    ar: {
      text: 'عذراً، لقد وصلت إلى حد المكالمات. حاول مرة أخرى لاحقاً. مع السلامة.',
      lang: 'ar-XA',
      voice: 'Google.ar-XA-Wavenet-A'
    },
    en: {
      text: 'Sorry, you have reached the call limit. Please try again later. Goodbye.',
      lang: 'en-US',
      voice: 'Google.en-US-Wavenet-D'
    }
  };

  const msg = messages[language] || messages.en;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="${msg.lang}" voice="${msg.voice}">${msg.text}</Say>
  <Hangup/>
</Response>`;
}

/**
 * Get current active calls count for a user
 */
export function getActiveCallsCount(userId: string): number {
  return activeCalls.get(userId)?.size || 0;
}
