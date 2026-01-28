import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

Deno.test("google-webhook handles OPTIONS for CORS", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/google-webhook`, {
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

Deno.test("google-webhook handles empty body gracefully", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/google-webhook`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  // Should return 200 even on error (Dialogflow expects 200)
  assertEquals(response.status, 200);
  
  const data = await response.json();
  assertExists(data.fulfillmentResponse);
});

Deno.test("google-webhook returns Dialogflow CX format", async () => {
  const dialogflowPayload = {
    fulfillmentInfo: {
      tag: "unknown_tag"
    },
    sessionInfo: {
      parameters: {}
    },
    languageCode: "he"
  };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/google-webhook`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(dialogflowPayload),
  });

  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Verify Dialogflow CX response format
  assertExists(data.fulfillmentResponse);
  assertExists(data.sessionInfo);
  assertExists(data.sessionInfo.parameters);
});

Deno.test("google-webhook handles get_availability tag without user", async () => {
  const dialogflowPayload = {
    fulfillmentInfo: {
      tag: "get_availability"
    },
    sessionInfo: {
      parameters: {}
    },
    languageCode: "he"
  };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/google-webhook`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      // No x-agent-user-id header
    },
    body: JSON.stringify(dialogflowPayload),
  });

  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Should return error message in Hebrew
  assertExists(data.fulfillmentResponse);
  if (data.fulfillmentResponse.messages?.length > 0) {
    const message = data.fulfillmentResponse.messages[0].text.text[0];
    assertEquals(message.includes("מצטער") || message.includes("לא ניתן"), true);
  }
});

Deno.test("google-webhook handles schedule_appointment tag without user", async () => {
  const dialogflowPayload = {
    fulfillmentInfo: {
      tag: "schedule_appointment"
    },
    sessionInfo: {
      parameters: {
        customer_name: "יוסי",
        date_time: new Date().toISOString()
      }
    },
    languageCode: "he"
  };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/google-webhook`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(dialogflowPayload),
  });

  assertEquals(response.status, 200);
  
  const data = await response.json();
  
  // Should return error message since no user_id
  assertExists(data.fulfillmentResponse);
  if (data.fulfillmentResponse.messages?.length > 0) {
    const message = data.fulfillmentResponse.messages[0].text.text[0];
    assertEquals(message.includes("מצטער") || message.includes("לא ניתן"), true);
  }
});
