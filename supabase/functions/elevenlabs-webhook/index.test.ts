import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

Deno.test("elevenlabs-webhook handles OPTIONS for CORS", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-webhook`, {
    method: "OPTIONS",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  assertEquals(response.status, 200);
  
  // Check CORS headers
  const corsOrigin = response.headers.get("Access-Control-Allow-Origin");
  assertEquals(corsOrigin, "*");
  
  await response.text(); // Consume body
});

Deno.test("elevenlabs-webhook handles missing to_number", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-webhook`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from_number: "+972501234567"
      // Missing to_number
    }),
  });

  // Should return 200 with fallback response
  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Should have error and fallback prompt
  assertExists(data.prompt);
  assertExists(data.greeting);
});

Deno.test("elevenlabs-webhook handles unknown phone number", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-webhook`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to_number: "+972500000000", // Non-existent number
      from_number: "+972501234567"
    }),
  });

  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Should return fallback response for unknown number
  assertExists(data.prompt);
  assertExists(data.greeting);
  
  // Greeting should indicate number is not available
  assertEquals(data.greeting.includes("אינו זמין") || data.greeting.includes("לא"), true);
});

Deno.test("elevenlabs-webhook returns required fields", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-webhook`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to_number: "+972500000000",
      from_number: "+972501234567"
    }),
  });

  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Required fields for ElevenLabs
  assertExists(data.prompt);
  assertExists(data.greeting);
  
  // Prompt should be in Hebrew
  assertEquals(data.prompt.includes("עוזר") || data.prompt.includes("טלפוני"), true);
});
