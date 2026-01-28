
# תוכנית מקיפה סופית: מוצר סטארט-אפ Production-Ready

## סיכום סקירה מעמיקה

### מה נמצא בקוד הקיים

| רכיב | מצב נוכחי | הערות |
|------|-----------|-------|
| **Media Bridge** | קיים אבל **לא מאובטח** | Token validation מ-URL (שורות 57-65) - שגוי! |
| **TwilioMediaMessage Interface** | **חסר customParameters** | שורות 19-30 ב-session.ts |
| **VAD Processor** | עובד | חסרים getSilentMs(), debugState() |
| **Edge Functions** | 30 פונקציות | כולן verify_jwt=false |
| **RLS Policies** | 90% תקין | **call_metrics עם WITH CHECK (true)** |
| **Secrets** | 8 סיקרטים | **חסרים: MEDIA_BRIDGE_SECRET, MEDIA_BRIDGE_URL** |
| **Subscription Plans** | 4 תוכניות | Free, Basic, Pro, Enterprise עם limits |
| **Usage Stats** | טבלה קיימת | calls_count, appointments_count לפי חודש |

---

## ✅ כל 16 הנקודות שציינת - מכוסות בתוכנית

| # | נקודה | סטטוס | מיקום בתוכנית |
|---|-------|-------|---------------|
| 1 | Static import לauth.ts (לא await import) | ✅ | שלב 1.4 - session.ts |
| 2 | decodeURIComponent רק אם יש ערך | ✅ | שלב 1.4 - handleStartEvent |
| 3 | כל message עובר ל-session (גם לפני validation) | ✅ | שלב 1.3 - index.ts |
| 4 | setInterval.unref() ב-auth.ts | ✅ | שלב 1.2 - auth.ts |
| 5 | Token validation מ-customParameters בלבד | ✅ | שלב 1.4 - handleStartEvent |
| 6 | Guards על media לפני validation | ✅ | שלב 1.4 - handleMessage |
| 7 | UTF-8 safe encoding | ✅ | שלב 1.2 + 1.5 - auth.ts + Edge Function |
| 8 | Replay protection עם JTI | ✅ | שלב 1.2 - auth.ts |
| 9 | Smart heartbeat עם session state | ✅ | שלב 2.1 - session.ts |
| 10 | isAskingQuestion עם patterns עברית/ערבית | ✅ | שלב 2.1 - session.ts |
| 11 | recordWSClose עם context מלא | ✅ | שלב 2.2 - session.ts |
| 12 | getSilentMs() ב-VAD | ✅ | שלב 2.3 - vad.ts |
| 13 | speechStartTime = 0 לאחר dedupe | ✅ | שלב 2.4 - session.ts |
| 14 | onWSMessage עם try/catch | ✅ | שלב 1.4 - session.ts |
| 15 | TwilioMediaMessage interface עם Record<string, string> | ✅ | שלב 1.4 - session.ts |
| 16 | Tenant-based Rate Limiting מלא | ✅ | שלב 3 - כולל userId/agentId/operation |

---

## מבנה התוכנית המלאה

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    PRODUCTION READINESS ROADMAP                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  שלב 1: אבטחה קריטית (P0)                           ████████████  100%  │
│  ├─ 1.1 RLS fix + Leaked Password                                       │
│  ├─ 1.2 auth.ts (HMAC + UTF-8 + replay)                                 │
│  ├─ 1.3 index.ts (refactor + events)                                    │
│  ├─ 1.4 session.ts (guards + validation)                                │
│  ├─ 1.5 Edge Function (token generation)                                │
│  └─ 1.6 Secrets (MEDIA_BRIDGE_SECRET/URL)                               │
│                                                                          │
│  שלב 2: יציבות ואמינות (P1)                         ████████████  100%  │
│  ├─ 2.1 Smart Heartbeat + Activity Tracking                             │
│  ├─ 2.2 WS Close Telemetry                                              │
│  ├─ 2.3 VAD Improvements (getSilentMs, debugState)                      │
│  ├─ 2.4 STT Deduplication                                               │
│  └─ 2.5 Circuit Breaker Pattern                                         │
│                                                                          │
│  שלב 3: Rate Limiting מתקדם (P1)                     ████████████  100%  │
│  ├─ 3.1 Tenant-based Rate Limiter (_shared)                             │
│  ├─ 3.2 Concurrent Call Tracking                                        │
│  ├─ 3.3 Per-Operation Limits (voice/api/webhook/tts/stt/ai)             │
│  ├─ 3.4 Integration in all Edge Functions                               │
│  └─ 3.5 rate_limit_events Table + Monitoring                            │
│                                                                          │
│  שלב 4: Usage Enforcement (P1)                       ████████████  100%  │
│  ├─ 4.1 Real-time Usage Check                                           │
│  ├─ 4.2 Plan-based Limits Integration                                   │
│  └─ 4.3 Billing Alerts Table                                            │
│                                                                          │
│  שלב 5: Monitoring & Observability (P2)              ████████████  100%  │
│  ├─ 5.1 system_health Table                                             │
│  ├─ 5.2 health-check Edge Function                                      │
│  ├─ 5.3 Admin Monitoring Dashboard                                      │
│  └─ 5.4 RateLimitMonitor Component                                      │
│                                                                          │
│  שלב 6: Testing & Documentation (P2)                 ████████████  100%  │
│  ├─ 6.1 E2E Test Cases (8 scenarios)                                    │
│  ├─ 6.2 Load Testing Plan                                               │
│  └─ 6.3 Runbook Documentation                                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## שלב 1: אבטחה קריטית (P0)

### 1.1 תיקון RLS + Leaked Password Protection

**בעיה שזוהתה:** `call_metrics` עם `WITH CHECK (true)` - מאפשר לכל מאומת להכניס metrics

**Migration נדרש:**
```sql
-- Drop permissive policy
DROP POLICY IF EXISTS "Allow insert for authenticated or service" ON public.call_metrics;

-- Create proper policy
CREATE POLICY "Users can insert own metrics"
ON public.call_metrics
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
```

**Leaked Password Protection:** להפעיל ב-Cloud View → Auth Settings

### 1.2 קובץ חדש: media-bridge/src/auth.ts

```typescript
import * as crypto from 'crypto';

interface TokenPayload {
  callSid: string;
  agentId: string;
  userId: string;
  jti: string;
  exp: number;
}

// Replay protection (in-memory for min-instances=1)
const usedTokens = new Map<string, number>();

// Cleanup with unref() for clean exit
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of usedTokens) {
    if (now > exp + 10000) usedTokens.delete(jti);
  }
}, 60000);
cleanup.unref?.();

// base64url → UTF-8 string (Unicode safe)
function base64urlToString(str: string): string {
  const padded = str + '='.repeat((4 - str.length % 4) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function verifySessionToken(
  token: string | undefined | null,
  secret: string
): TokenPayload | null {
  if (!token || !secret) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadB64url, signatureB64url] = parts;

    // Timing-safe HMAC verification
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payloadB64url)
      .digest();

    const providedSig = Buffer.from(
      signatureB64url.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - signatureB64url.length % 4) % 4),
      'base64'
    );

    if (expectedSig.length !== providedSig.length) return null;
    if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

    // Decode payload (UTF-8 safe)
    const payload: TokenPayload = JSON.parse(base64urlToString(payloadB64url));

    // Check expiry
    if (Date.now() > payload.exp) return null;

    // Replay protection
    if (usedTokens.has(payload.jti)) {
      console.log('Token replay detected:', payload.jti);
      return null;
    }
    usedTokens.set(payload.jti, payload.exp);

    return payload;
  } catch (e) {
    console.error('Token verification error:', e);
    return null;
  }
}
```

### 1.3 עדכון: media-bridge/src/index.ts

**שינויים עיקריים (שורות 53-88):**
- הסרת validation מ-connection (שורות 57-65 נמחקות)
- העברת כל message ל-session.onWSMessage()
- הוספת event listeners ל-validation_failed/validated
- תמיכה ב-devToken לבדיקות מקומיות

```typescript
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const sessionId = uuidv4();
  
  // NO TOKEN VALIDATION HERE - Twilio sends token in 'start' event
  
  // DEV mode: allow URL token for local testing only
  let devToken: string | undefined;
  if (process.env.NODE_ENV !== 'production') {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    devToken = url.searchParams.get('devToken') || undefined;
  }

  // Create session with apiSecret
  const session = new MediaBridgeSession(sessionId, ws, {
    apiSecret: API_SECRET,
    devToken
  });

  sessions.set(sessionId, session);

  // Validation events
  session.on('validation_failed', () => {
    console.log(`[${sessionId}] Token validation failed`);
    ws.close(4001, 'Unauthorized');
  });

  session.on('validated', (payload: any) => {
    console.log(`[${sessionId}] Validated for call: ${payload.callSid}`);
  });

  // Forward ALL messages to session (session handles guards)
  ws.on('message', async (data) => {
    await session.onWSMessage(data);
  });

  ws.on('close', (code, reason) => {
    session.recordWSClose(code, reason?.toString() || '');
    session.cleanup();
    sessions.delete(sessionId);
  });
});
```

### 1.4 עדכון: media-bridge/src/session.ts

**שינויים עיקריים:**

**א) Static import (שורה 7):**
```typescript
import { verifySessionToken } from './auth';
```

**ב) עדכון TwilioMediaMessage interface (שורות 19-31):**
```typescript
interface TwilioMediaMessage {
  event: 'start' | 'media' | 'mark' | 'stop' | 'config';
  streamSid?: string;
  media?: {
    payload: string;
    timestamp?: string;
  };
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;  // חדש!
  };
  mark?: { name: string };
}
```

**ג) שדות חדשים (אחרי שורה 49):**
```typescript
// Authentication
private validated: boolean = false;
private apiSecret: string;
private devToken?: string;
private droppedMediaLogged: boolean = false;

// Activity tracking
private lastActivityTime: number = Date.now();
private lastActivityType: string = 'init';

// Session state for smart heartbeat
private sessionState: 'active' | 'awaiting_user' | 'agent_speaking' = 'active';
private healthCheckInterval: NodeJS.Timeout | null = null;

// Endpointing
private speechStartTime: number = 0;
```

**ד) Constructor מעודכן (שורות 60-70):**
```typescript
constructor(sessionId: string, ws: WebSocket, options: SessionOptions = {}) {
  super();
  this.sessionId = sessionId;
  this.ws = ws;
  this.apiSecret = options.apiSecret || '';
  this.devToken = options.devToken;
  // ... initialization
  // Note: NO setupMessageHandler() - index.ts calls onWSMessage directly
}
```

**ה) onWSMessage חדש (מחליף setupMessageHandler):**
```typescript
async onWSMessage(data: any) {
  try {
    const msg = JSON.parse(data.toString()) as TwilioMediaMessage;
    await this.handleMessage(msg);
  } catch (e) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.warn(`[${this.sessionId}] Bad JSON message:`, e);
    }
  }
}
```

**ו) handleMessage עם Guards:**
```typescript
private async handleMessage(message: TwilioMediaMessage) {
  // CRITICAL: Allow 'start' before validation, guard everything else
  if (!this.validated && message.event !== 'start') {
    if (message.event === 'media') {
      if (!this.droppedMediaLogged) {
        console.warn(`[${this.sessionId}] Dropping media - not validated`);
        this.droppedMediaLogged = true;
      }
      return; // DO NOT add to audioBuffer!
    }
    console.warn(`[${this.sessionId}] Dropping ${message.event} - not validated`);
    return;
  }

  switch (message.event) {
    case 'start':
      await this.handleStartEvent(message);
      break;
    case 'media':
      if (message.media?.payload) {
        this.recordActivity('media_in');
        await this.handleAudio(message.media.payload);
      }
      break;
    // ...
  }
}
```

**ז) handleStartEvent הסופי:**
```typescript
private async handleStartEvent(message: TwilioMediaMessage) {
  if (!message.start) return;

  this.streamSid = message.start.streamSid;
  this.callSid = message.start.callSid;

  const customParams = message.start.customParameters || {};
  
  // Token: prefer customParameters, fallback to devToken in dev mode
  const token = customParams.sessionToken || 
    (process.env.NODE_ENV !== 'production' ? this.devToken : undefined);

  if (this.apiSecret) {
    const payload = verifySessionToken(token, this.apiSecret);

    if (!payload) {
      this.emit('validation_failed');
      return;
    }

    if (payload.callSid !== this.callSid) {
      console.log(`[${this.sessionId}] CallSid mismatch`);
      this.emit('validation_failed');
      return;
    }

    this.validated = true;
    this.emit('validated', payload);
  } else {
    this.validated = true;
    console.warn(`[${this.sessionId}] ⚠️ No API secret - skipping validation`);
  }

  // Config from customParameters (decode greeting only if exists)
  const greeting = customParams.greeting 
    ? decodeURIComponent(customParams.greeting) 
    : '';

  // ... continue with startSession()
  await this.startSession();
  this.startSmartHeartbeat();
}
```

### 1.5 עדכון: twilio-dialogflow-bridge Edge Function

**הוספת פונקציות encoding (UTF-8 safe):**
```typescript
// UTF-8 safe string → base64url
function stringToBase64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Generate session token
async function generateSessionToken(
  callSid: string,
  agentId: string,
  userId: string,
  secret: string
): Promise<string> {
  const payload = JSON.stringify({
    callSid,
    agentId,
    userId,
    jti: crypto.randomUUID(),
    exp: Date.now() + 120000  // 2 minutes
  });

  const payloadB64url = stringToBase64url(payload);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64url));
  const signatureB64url = bytesToBase64url(new Uint8Array(signatureBytes));

  return `${payloadB64url}.${signatureB64url}`;
}
```

**עדכון TwiML (שורות 91-110):**
```typescript
const sessionToken = await generateSessionToken(
  callSid,
  profile?.dialogflow_agent_id || '',
  userId,
  Deno.env.get('MEDIA_BRIDGE_SECRET') || ''
);

twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${mediaBridgeUrl}">
      <Parameter name="sessionToken" value="${sessionToken}" />
      <Parameter name="userId" value="${userId}" />
      <Parameter name="agentId" value="${profile?.dialogflow_agent_id || ''}" />
      <Parameter name="language" value="${language}" />
      <Parameter name="greeting" value="${encodeURIComponent(greeting)}" />
    </Stream>
  </Connect>
</Response>`;
```

### 1.6 Secrets נדרשים

| Secret | תיאור | סטטוס |
|--------|-------|-------|
| MEDIA_BRIDGE_SECRET | HMAC signing key | **חסר - להוסיף** |
| MEDIA_BRIDGE_URL | wss://... Cloud Run URL | **חסר - להוסיף** |

---

## שלב 2: יציבות ואמינות (P1)

### 2.1 Smart Heartbeat + Activity Tracking

```typescript
// Activity types
type ActivityType = 'media_in' | 'media_out' | 'stt' | 'tts' | 'mark' | 'gemini';

private recordActivity(type: ActivityType) {
  this.lastActivityTime = Date.now();
  this.lastActivityType = type;
  
  if (process.env.LOG_LEVEL === 'debug') {
    // Rate-limited logging
  }
}

private getEffectiveStaleTimeout(): number {
  if (this.sessionState === 'awaiting_user') return 120000;  // 2 min
  return 90000;  // 1.5 min default
}

private startSmartHeartbeat() {
  this.healthCheckInterval = setInterval(() => {
    const inactiveMs = Date.now() - this.lastActivityTime;
    const timeout = this.getEffectiveStaleTimeout();
    
    if (inactiveMs > timeout) {
      this.emit('connection_stale');
      this.endSession();
    }
  }, 15000);
}

private isAskingQuestion(text: string): boolean {
  if (/[?؟]\s*$/.test(text)) return true;
  if (/מה (השם|הטלפון)|מתי|איפה|האם|איך/.test(text)) return true;
  if (/תן לי|אפשר לדעת|אני צריך/.test(text)) return true;
  if (/شو|مين|وين|كيف|ممكن|بدي/.test(text)) return true;
  return false;
}
```

### 2.2 WS Close Telemetry

```typescript
recordWSClose(code: number, reason: string) {
  console.log(
    `[${this.sessionId}] WS Close: ${code} | ` +
    `validated: ${this.validated} | state: ${this.sessionState} | ` +
    `agentSpeaking: ${this.isAgentSpeaking} | ` +
    `lastActivity: ${this.lastActivityType} ${Date.now() - this.lastActivityTime}ms ago`
  );
}

cleanup() {
  if (this.healthCheckInterval) {
    clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = null;
  }
  // ... rest of cleanup
}
```

### 2.3 VAD Improvements (שורות 129-145)

```typescript
getSilentFrameCount(): number {
  return this.silentFrameCount;
}

getSilentMs(): number {
  return this.silentFrameCount * 20;  // 20ms per frame
}

debugState(): object {
  return {
    isSpeaking: this.isSpeaking,
    silentFrameCount: this.silentFrameCount,
    silentMs: this.getSilentMs(),
    speechFrameCount: this.speechFrameCount,
    adaptiveThreshold: this.adaptiveThreshold,
  };
}
```

### 2.4 STT Deduplication

```typescript
private recentTranscripts: string[] = [];
private readonly MAX_RECENT = 5;

private isDuplicateTranscript(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  if (this.recentTranscripts.includes(normalized)) {
    console.log(`[${this.sessionId}] Duplicate transcript detected`);
    this.speechStartTime = 0;  // Reset timer - נקודה 13!
    return true;
  }
  
  this.recentTranscripts.push(normalized);
  if (this.recentTranscripts.length > this.MAX_RECENT) {
    this.recentTranscripts.shift();
  }
  
  return false;
}
```

### 2.5 Circuit Breaker Pattern

**קובץ חדש: media-bridge/src/circuit-breaker.ts**

```typescript
interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  openedAt: number;
}

const circuits = new Map<string, CircuitState>();

const CONFIG = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
};

export function isCircuitOpen(service: string): boolean {
  const state = circuits.get(service);
  if (!state?.isOpen) return false;
  
  if (Date.now() - state.openedAt > CONFIG.resetTimeoutMs) {
    state.isOpen = false;
    state.failures = 0;
    return false;
  }
  return true;
}

export function recordSuccess(service: string): void {
  const state = circuits.get(service);
  if (state) {
    state.failures = 0;
    state.isOpen = false;
  }
}

export function recordFailure(service: string): void {
  let state = circuits.get(service);
  if (!state) {
    state = { failures: 0, lastFailure: 0, isOpen: false, openedAt: 0 };
    circuits.set(service, state);
  }
  
  state.failures++;
  state.lastFailure = Date.now();
  
  if (state.failures >= CONFIG.failureThreshold) {
    state.isOpen = true;
    state.openedAt = Date.now();
    console.log(`🔴 Circuit OPEN for ${service}`);
  }
}

export function getFallbackResponse(service: string, language: string): string {
  const fallbacks = {
    'google-stt': {
      'he': 'סליחה, לא שמעתי טוב. אפשר לחזור?',
      'ar': 'ما سمعت منيح، ممكن تعيد؟',
      'en': "Sorry, I didn't catch that. Could you repeat?",
    },
  };
  return fallbacks[service]?.[language] || '';
}
```

---

## שלב 3: Tenant-Based Rate Limiting (P1)

### 3.1 Rate Limit Configuration

| Operation Type | Per User/Hour | Per Agent/Hour | Per IP/Min | Burst |
|----------------|---------------|----------------|------------|-------|
| voice_call | 50 | 30 | 10 | 5 |
| api_call | 200 | 100 | 50 | 20 |
| webhook | 500 | 200 | 100 | 50 |
| tts_request | 300 | 150 | 30 | 10 |
| stt_request | 300 | 150 | 30 | 10 |
| ai_request | 100 | 50 | 20 | 5 |
| appointment | 50 | 30 | 10 | 5 |
| media_stream | 100 | 50 | 20 | 10 |

### 3.2 קובץ חדש: _shared/tenant-rate-limiter.ts

**כולל:**
- checkTenantRateLimit() - בדיקה לפי userId, agentId, IP
- trackCallStart() / trackCallEnd() - מעקב שיחות מקבילות
- getRateLimitHeaders() - headers תקניים
- createRateLimitResponse() - תשובות בעברית/ערבית/אנגלית

### 3.3 שילוב ב-Edge Functions

| Edge Function | Rate Limit Type | הערות |
|---------------|-----------------|-------|
| twilio-dialogflow-bridge | voice_call + concurrent | + Usage enforcement |
| twilio-media-stream | media_stream + concurrent | |
| google-webhook | webhook | |
| elevenlabs-webhook | webhook | |
| vapi-webhook | webhook | |
| All API functions | api_call | |

### 3.4 טבלת rate_limit_events

```sql
CREATE TABLE public.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id text,
  ip_address text,
  operation_type text NOT NULL,
  limit_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

---

## שלב 4: Usage Enforcement (P1)

### 4.1 Real-time Usage Check

```typescript
async function checkUsageLimits(userId: string, supabase: any) {
  const monthYear = new Date().toISOString().slice(0, 7);
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_plan_id')
    .eq('user_id', userId)
    .single();
    
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('max_calls_per_month')
    .eq('id', profile.subscription_plan_id)
    .single();
    
  const { data: usage } = await supabase
    .from('usage_stats')
    .select('calls_count')
    .eq('user_id', userId)
    .eq('month_year', monthYear)
    .single();
    
  const currentCalls = usage?.calls_count || 0;
  const maxCalls = plan?.max_calls_per_month || 0;
  
  if (maxCalls !== -1 && currentCalls >= maxCalls) {
    return { 
      allowed: false, 
      message: 'הגעת למגבלת השיחות החודשית. שדרג את החבילה.' 
    };
  }
  
  return { allowed: true };
}
```

### 4.2 טבלת billing_alerts

```sql
CREATE TABLE public.billing_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  alert_type text NOT NULL, -- 'usage_80', 'usage_100', 'payment_failed'
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

---

## שלב 5: Monitoring & Observability (P2)

### 5.1 טבלת system_health

```sql
CREATE TABLE public.system_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz DEFAULT now(),
  active_calls integer DEFAULT 0,
  avg_ttfs_ms integer,
  avg_end_to_audio_ms integer,
  stt_success_rate numeric(5,2),
  tts_success_rate numeric(5,2),
  error_count integer DEFAULT 0,
  circuit_breaker_status jsonb DEFAULT '{}'
);
```

### 5.2 health-check Edge Function

**פונקציה חדשה:** supabase/functions/health-check/index.ts

### 5.3 Admin Components

- AdminMonitoring.tsx - Dashboard מטריקות מערכת
- RateLimitMonitor.tsx - מעקב Rate Limit events

---

## שלב 6: Testing & Documentation (P2)

### 6.1 E2E Test Cases

| # | Test | תיאור | ציפייה |
|---|------|-------|--------|
| 1 | Happy Path | שיחה עם token תקין | validated=true |
| 2 | Invalid Token | חתימה שגויה | WS close 4001 |
| 3 | Media Before Start | media לפני start | נזרק בשקט |
| 4 | Unicode Token | userId עם עברית | עובד |
| 5 | STT Duplicate | restart/overlap | null, speechStartTime=0 |
| 6 | Usage Limit | מקסימום שיחות | הודעה וניתוק |
| 7 | Circuit Open | 5 כשלונות STT | fallback |
| 8 | Barge-in | משתמש מפסיק | TTS מבוטל |

### 6.2 Load Testing Plan

- Phase 1: 5 שיחות מקבילות (baseline)
- Phase 2: 10 שיחות (stress)
- Phase 3: 20 שיחות (peak)

### 6.3 Runbook

**קובץ:** docs/RUNBOOK.md

---

## סיכום קבצים

### קבצים חדשים (7)

| קובץ | תיאור |
|------|-------|
| media-bridge/src/auth.ts | Token verification |
| media-bridge/src/circuit-breaker.ts | Circuit breaker |
| supabase/functions/_shared/tenant-rate-limiter.ts | Rate limiting |
| supabase/functions/health-check/index.ts | System health |
| src/components/admin/AdminMonitoring.tsx | Monitoring UI |
| src/components/admin/RateLimitMonitor.tsx | Rate limit UI |
| docs/RUNBOOK.md | Operations guide |

### קבצים לעדכון (5)

| קובץ | שינויים |
|------|---------|
| media-bridge/src/index.ts | Token validation refactor |
| media-bridge/src/session.ts | Guards, activity, heartbeat |
| media-bridge/src/vad.ts | getSilentMs, debugState |
| twilio-dialogflow-bridge | Token generation, usage check |
| twilio-media-stream | Rate limiting, concurrent tracking |

### Migrations (4)

| Migration | תיאור |
|-----------|-------|
| Fix call_metrics RLS | הסרת WITH CHECK (true) |
| Add rate_limit_events | טבלת Rate Limit events |
| Add billing_alerts | טבלת התראות חיוב |
| Add system_health | טבלת בריאות מערכת |

---

## לוח זמנים מומלץ

### שבוע 1: אבטחה (P0)
| יום | משימות |
|-----|---------|
| 1 | RLS fix + Leaked Password + Secrets |
| 2 | auth.ts + index.ts refactor |
| 3 | session.ts guards + handleStartEvent |
| 4 | Edge Function token generation |
| 5 | E2E security tests |

### שבוע 2: Stability + Rate Limiting (P1)
| יום | משימות |
|-----|---------|
| 1 | Circuit breaker + VAD improvements |
| 2 | STT deduplication + smart heartbeat |
| 3 | Tenant rate limiter |
| 4 | Usage enforcement + billing alerts |
| 5 | Deploy + Integration tests |

### שבוע 3: Monitoring + Polish (P2)
| יום | משימות |
|-----|---------|
| 1 | system_health + health-check |
| 2 | Admin monitoring components |
| 3 | Rate limit monitor UI |
| 4 | Load testing |
| 5 | Documentation + Runbook |

---

## יעדי ביצועים

| מטריקה | יעד |
|--------|-----|
| TTFS | < 400ms |
| End-to-Audio | 600-900ms |
| Barge-in | < 150ms |
| Connection Stability | 99.5% |
| Security | 100% token validation |
| Uptime | 99.9% |

---

## Checklist לפני Pilot

- [ ] Leaked Password Protection מופעל
- [ ] RLS call_metrics תוקן
- [ ] MEDIA_BRIDGE_SECRET מוגדר
- [ ] MEDIA_BRIDGE_URL מוגדר
- [ ] Token validation עובד מ-customParameters
- [ ] Guards על media לפני validation
- [ ] Circuit breaker מיושם
- [ ] Rate limiting פעיל
- [ ] Usage enforcement פעיל
- [ ] Health check endpoint עובד
- [ ] E2E tests עוברים (8 מקרים)
- [ ] Load test הושלם
- [ ] Runbook מתועד

---

## תשובה לשאלה: האם התוכנית מלאה?

**כן, התוכנית מכסה 100% מכל הנקודות שציינת:**

1. ✅ Static import (לא await import)
2. ✅ decodeURIComponent רק אם יש ערך
3. ✅ כל message עובר ל-session
4. ✅ setInterval.unref()
5. ✅ Token מ-customParameters בלבד
6. ✅ Guards על media לפני validation
7. ✅ UTF-8 safe encoding
8. ✅ Replay protection עם JTI
9. ✅ Smart heartbeat עם session state
10. ✅ isAskingQuestion עם patterns
11. ✅ recordWSClose עם context
12. ✅ getSilentMs() ב-VAD
13. ✅ speechStartTime = 0 לאחר dedupe
14. ✅ onWSMessage עם try/catch
15. ✅ TwilioMediaMessage עם Record<string, string>
16. ✅ Tenant-based Rate Limiting מלא

**בנוסף, התוכנית כוללת:**
- תיקון RLS policies
- הפעלת Leaked Password Protection
- הוספת Secrets חסרים
- Circuit Breaker לכל Google APIs
- Usage Enforcement בזמן אמת
- System Health monitoring
- Admin dashboards
- E2E tests + Load testing
- Documentation + Runbook
