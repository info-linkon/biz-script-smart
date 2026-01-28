import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

Deno.test("health-check returns healthy status", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/health-check`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });

  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Verify structure
  assertExists(data.timestamp);
  assertExists(data.mediaBridge);
  assertExists(data.performance);
  assertExists(data.rateLimiting);
  assertExists(data.calls);
  assertExists(data.alerts);
  
  // Verify Media Bridge status
  assertEquals(data.mediaBridge.configured, true);
  assertExists(data.mediaBridge.status);
  
  // Verify performance metrics exist
  assertExists(data.performance.avgTtfsMs);
  assertExists(data.performance.avgEndToAudioMs);
});

Deno.test("health-check Media Bridge status is healthy", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/health-check`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });

  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Media Bridge should be healthy
  if (data.mediaBridge.status) {
    assertEquals(data.mediaBridge.status.status, "healthy");
  }
});

Deno.test("health-check rate limiting metrics", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/health-check`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });

  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Rate limiting should have eventsLastHour
  assertExists(data.rateLimiting.eventsLastHour);
  assertEquals(typeof data.rateLimiting.eventsLastHour, "number");
});
