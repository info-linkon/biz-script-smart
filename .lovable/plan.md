
# תוכנית המשך יישום - Production Ready

## סיכום סטטוס נוכחי

| רכיב | סטטוס | הערות |
|------|-------|-------|
| Media Bridge Cloud Run | ✅ פעיל | /health מחזיר healthy |
| MEDIA_BRIDGE_SECRET | ✅ מוגדר | |
| MEDIA_BRIDGE_URL | ✅ מוגדר | |
| rate_limit_events | ✅ טבלה קיימת | |
| billing_alerts | ✅ טבלה קיימת | |
| system_health | ✅ טבלה קיימת | |
| auth.ts | ❌ חסר | Token verification |
| index.ts refactor | ❌ נדרש | Token מ-customParameters |
| session.ts guards | ❌ נדרש | Guards + validation |
| circuit-breaker.ts | ❌ חסר | |
| tenant-rate-limiter.ts | ❌ חסר | |
| health-check function | ❌ חסר | |
| Admin Monitoring UI | ❌ חסר | |

---

## שלבי יישום

### שלב 1: אבטחה קריטית (P0)

#### 1.1 יצירת media-bridge/src/auth.ts

קובץ חדש לאימות tokens עם:
- HMAC-SHA256 verification
- UTF-8 safe encoding/decoding
- Replay protection עם JTI
- setInterval.unref() לניקוי tokens

#### 1.2 עדכון media-bridge/src/index.ts

שינויים עיקריים:
- הסרת validation מ-URL (שורות 57-65)
- העברת כל message ל-session.onWSMessage()
- event listeners ל-validation_failed/validated
- תמיכה ב-devToken לסביבת פיתוח

#### 1.3 עדכון media-bridge/src/session.ts

שינויים מקיפים:
- Static import לauth.ts
- TwilioMediaMessage interface עם customParameters
- שדות validated, apiSecret, devToken
- Guards על media לפני validation
- handleStartEvent עם token validation
- Smart heartbeat + activity tracking
- recordWSClose עם context מלא
- STT deduplication

#### 1.4 עדכון supabase/functions/twilio-dialogflow-bridge

הוספות:
- stringToBase64url (UTF-8 safe)
- generateSessionToken function
- שינוי TwiML להעביר sessionToken ב-customParameters
- שילוב MEDIA_BRIDGE_URL ו-MEDIA_BRIDGE_SECRET

---

### שלב 2: יציבות (P1)

#### 2.1 יצירת media-bridge/src/circuit-breaker.ts

קובץ חדש עם:
- isCircuitOpen(service)
- recordSuccess(service)
- recordFailure(service)
- getFallbackResponse(service, language)

#### 2.2 עדכון media-bridge/src/vad.ts

הוספת:
- getSilentMs() - זמן שקט במילישניות
- getSilentFrameCount()
- debugState() - לוג מצב מלא

---

### שלב 3: Rate Limiting (P1)

#### 3.1 יצירת supabase/functions/_shared/tenant-rate-limiter.ts

קובץ משותף עם:
- checkTenantRateLimit(userId, agentId, ip, operation)
- trackCallStart(userId)
- trackCallEnd(userId)
- getRateLimitHeaders()
- createRateLimitResponse(language)

#### 3.2 שילוב ב-Edge Functions

עדכון הפונקציות הבאות:
- twilio-dialogflow-bridge (voice_call + concurrent)
- twilio-media-stream (media_stream)
- google-webhook (webhook)
- elevenlabs-webhook (webhook)

---

### שלב 4: Monitoring (P2)

#### 4.1 יצירת supabase/functions/health-check/index.ts

פונקציה חדשה שמחזירה:
- סטטוס Media Bridge
- שיחות פעילות
- מטריקות ביצועים
- סטטוס Circuit Breaker

#### 4.2 יצירת src/components/admin/AdminMonitoring.tsx

Dashboard עם:
- גרף שיחות בזמן אמת
- מטריקות TTFS / End-to-Audio
- סטטוס services

#### 4.3 יצירת src/components/admin/RateLimitMonitor.tsx

מסך עם:
- אירועי rate limit אחרונים
- סינון לפי משתמש/פעולה
- גרף מגמות

#### 4.4 עדכון src/pages/Admin.tsx

הוספת tabs חדשים:
- Monitoring
- Rate Limits

---

## סיכום קבצים

### קבצים חדשים (5)

| קובץ | תיאור |
|------|-------|
| media-bridge/src/auth.ts | Token verification |
| media-bridge/src/circuit-breaker.ts | Circuit breaker pattern |
| supabase/functions/_shared/tenant-rate-limiter.ts | Rate limiting |
| supabase/functions/health-check/index.ts | System health check |
| src/components/admin/AdminMonitoring.tsx | Monitoring UI |

### קבצים לעדכון (5)

| קובץ | שינויים |
|------|---------|
| media-bridge/src/index.ts | Token validation refactor |
| media-bridge/src/session.ts | Guards, activity, heartbeat |
| media-bridge/src/vad.ts | getSilentMs, debugState |
| supabase/functions/twilio-dialogflow-bridge/index.ts | Token generation |
| src/pages/Admin.tsx | Monitoring tabs |

---

## לוח זמנים

### יום 1: אבטחה קריטית
- auth.ts (token verification)
- index.ts refactor
- session.ts guards

### יום 2: השלמת אבטחה + יציבות
- twilio-dialogflow-bridge token generation
- circuit-breaker.ts
- vad.ts improvements

### יום 3: Rate Limiting + Deploy
- tenant-rate-limiter.ts
- שילוב בכל Edge Functions
- Deploy Media Bridge מעודכן

### יום 4: Monitoring + Testing
- health-check function
- AdminMonitoring.tsx
- E2E tests

---

## הערות טכניות

### Deploy לאחר שינויים

לאחר עדכון הקבצים ב-media-bridge, יש לבצע deploy מחדש:

```text
cd media-bridge
gcloud run deploy media-bridge \
  --source . \
  --region me-west1 \
  --project voice-ai-production \
  --min-instances 1 \
  --session-affinity
```

### בדיקות נדרשות

1. Token validation מ-customParameters
2. Media drops לפני validation
3. Replay protection (JTI)
4. Circuit breaker fallback
5. Rate limiting per user

---

## Checklist לאישור

- [ ] auth.ts נוצר ועובד
- [ ] index.ts לא מאמת מ-URL יותר
- [ ] session.ts עם guards נכונים
- [ ] twilio-dialogflow-bridge מייצר tokens
- [ ] circuit-breaker.ts מיושם
- [ ] rate-limiter משולב
- [ ] health-check endpoint עובד
- [ ] Admin monitoring UI מוכן
- [ ] Deploy Media Bridge הושלם
- [ ] E2E tests עוברים
