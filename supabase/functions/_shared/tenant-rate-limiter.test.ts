import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  checkTenantRateLimit, 
  trackCallStart, 
  trackCallEnd, 
  getActiveCallsCount,
  getRateLimitHeaders,
  createRateLimitResponse
} from "./tenant-rate-limiter.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

Deno.test("trackCallStart and trackCallEnd work correctly", () => {
  const testUserId = "test-user-" + Date.now();
  const callSid1 = "call-1";
  const callSid2 = "call-2";
  
  // Initially no calls
  assertEquals(getActiveCallsCount(testUserId), 0);
  
  // Add first call
  trackCallStart(testUserId, callSid1);
  assertEquals(getActiveCallsCount(testUserId), 1);
  
  // Add second call
  trackCallStart(testUserId, callSid2);
  assertEquals(getActiveCallsCount(testUserId), 2);
  
  // End first call
  trackCallEnd(testUserId, callSid1);
  assertEquals(getActiveCallsCount(testUserId), 1);
  
  // End second call
  trackCallEnd(testUserId, callSid2);
  assertEquals(getActiveCallsCount(testUserId), 0);
});

Deno.test("getRateLimitHeaders returns correct format", () => {
  const result = {
    allowed: false,
    remaining: 5,
    resetIn: 60,
    limitType: "per_minute"
  };
  
  const headers = getRateLimitHeaders(result);
  
  assertEquals(headers["X-RateLimit-Remaining"], "5");
  assertEquals(headers["X-RateLimit-Reset"], "60");
  assertEquals(headers["X-RateLimit-Type"], "per_minute");
});

Deno.test("getRateLimitHeaders omits limitType when not present", () => {
  const result = {
    allowed: true,
    remaining: 10,
    resetIn: 60
  };
  
  const headers = getRateLimitHeaders(result);
  
  assertEquals(headers["X-RateLimit-Remaining"], "10");
  assertEquals(headers["X-RateLimit-Reset"], "60");
  assertEquals(headers["X-RateLimit-Type"], undefined);
});

Deno.test("createRateLimitResponse returns Hebrew message by default", () => {
  const response = createRateLimitResponse();
  
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Content-Type"), "application/json");
});

Deno.test("createRateLimitResponse returns Arabic message", async () => {
  const response = createRateLimitResponse("ar");
  
  assertEquals(response.status, 429);
  
  const data = await response.json();
  assertExists(data.message);
  // Arabic message should contain Arabic characters
  assertEquals(data.message.includes("لقد") || data.message.includes("حد"), true);
});

Deno.test("createRateLimitResponse returns English message", async () => {
  const response = createRateLimitResponse("en");
  
  assertEquals(response.status, 429);
  
  const data = await response.json();
  assertExists(data.message);
  assertEquals(data.message.includes("limit") || data.message.includes("reached"), true);
});

Deno.test("createRateLimitResponse includes custom headers", () => {
  const customHeaders = {
    "X-Custom-Header": "test-value"
  };
  
  const response = createRateLimitResponse("he", customHeaders);
  
  assertEquals(response.headers.get("X-Custom-Header"), "test-value");
});
