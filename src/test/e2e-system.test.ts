import { describe, it, expect } from "vitest";

/**
 * E2E Test Suite for Voice AI System
 * 
 * These tests verify the complete flow of the system:
 * 1. Health check endpoint works
 * 2. Webhooks handle requests correctly
 * 3. Rate limiting is enforced
 * 4. Media Bridge is responsive
 */

describe("Voice AI System E2E Tests", () => {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  // Helper to skip tests if no credentials
  const skipIfNoCredentials = () => !SUPABASE_URL || !SUPABASE_KEY;

  describe("Health Check Endpoint", () => {
    it("returns healthy status", async () => {
      if (skipIfNoCredentials()) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/health-check`, {
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        }
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty("mediaBridge");
      expect(data).toHaveProperty("performance");
      expect(data).toHaveProperty("timestamp");
    }, 15000);

    it("returns Media Bridge configuration status", async () => {
      if (skipIfNoCredentials()) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/health-check`, {
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        }
      });

      const data = await response.json();
      expect(data.mediaBridge).toHaveProperty("configured");
      expect(data.mediaBridge.configured).toBe(true);
    }, 15000);
  });

  describe("Google Webhook", () => {
    it("handles CORS preflight", async () => {
      if (skipIfNoCredentials()) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/google-webhook`, {
        method: "OPTIONS",
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }, 15000);

    it("returns Dialogflow CX format response", async () => {
      if (skipIfNoCredentials()) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/google-webhook`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fulfillmentInfo: { tag: "test" },
          sessionInfo: { parameters: {} },
          languageCode: "he"
        })
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty("fulfillmentResponse");
      expect(data).toHaveProperty("sessionInfo");
    }, 15000);
  });

  describe("ElevenLabs Webhook", () => {
    it("handles CORS preflight", async () => {
      if (skipIfNoCredentials()) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-webhook`, {
        method: "OPTIONS",
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }, 15000);

    it("returns fallback for unknown phone", async () => {
      if (skipIfNoCredentials()) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-webhook`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to_number: "+972500000000",
          from_number: "+972501234567"
        })
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty("prompt");
      expect(data).toHaveProperty("greeting");
    }, 15000);
  });

  describe("Rate Limiting", () => {
    it("health check shows rate limit events count", async () => {
      if (skipIfNoCredentials()) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/health-check`, {
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        }
      });

      const data = await response.json();
      expect(data.rateLimiting).toHaveProperty("eventsLastHour");
      expect(typeof data.rateLimiting.eventsLastHour).toBe("number");
    }, 15000);
  });

  describe("Performance Metrics", () => {
    it("health check includes performance data", async () => {
      if (skipIfNoCredentials()) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/health-check`, {
        headers: {
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        }
      });

      const data = await response.json();
      expect(data.performance).toHaveProperty("avgTtfsMs");
      expect(data.performance).toHaveProperty("avgEndToAudioMs");
      expect(data.performance).toHaveProperty("bargeIns24h");
      expect(data.performance).toHaveProperty("sttFailures24h");
    }, 15000);
  });
});
