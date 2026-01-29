

# תיקון ניתוק שיחות - Media Bridge

## ניתוח הבעיה

### מה קורה
1. שיחה נכנסת למספר **+972765993896**
2. ה-Edge Function `twilio-dialogflow-bridge` מזהה את המספר ומחזיר TwiML תקין
3. ה-TwiML מכוון ל-WebSocket של Media Bridge: `wss://media-bridge-692599475968.me-west1.run.app`
4. **החיבור נכשל** וה-שיחה מתנתקת

### שורש הבעיה

נמצאה **שגיאת קומפילציה** בקוד ה-Media Bridge:

```typescript
// שורה 58:
private sessionActive: boolean = true;

// Session State Tracking
private sessionState: 'idle' | 'awaiting_user' | 'agent_speaking' | 'processing' = 'idle';
private lastActivityType: 'none' | 'media_in' | 'stt_result' | 'tts_sent' | 'dialogflow' = 'none';

// שורה 63 - כפילות!
private sessionActive: boolean = true;
```

הגדרה כפולה של `sessionActive` גורמת לשגיאת TypeScript, מה שמונע את הפריסה של הקוד החדש ל-Cloud Run.

---

## תוכנית תיקון

### שלב 1: תיקון הכפילות ב-session.ts

הסרת השורה הכפולה `private sessionActive: boolean = true;` משורה 63.

**לפני:**
```typescript
private sessionActive: boolean = true;

// Session State Tracking
private sessionState: 'idle' | 'awaiting_user' | 'agent_speaking' | 'processing' = 'idle';
private lastActivityType: 'none' | 'media_in' | 'stt_result' | 'tts_sent' | 'dialogflow' = 'none';
private sessionActive: boolean = true;  // ← כפילות - למחוק!
```

**אחרי:**
```typescript
private sessionActive: boolean = true;

// Session State Tracking
private sessionState: 'idle' | 'awaiting_user' | 'agent_speaking' | 'processing' = 'idle';
private lastActivityType: 'none' | 'media_in' | 'stt_result' | 'tts_sent' | 'dialogflow' = 'none';
```

### שלב 2: פריסה מחדש ל-Cloud Run

לאחר התיקון, יש לפרוס את ה-Media Bridge מחדש:

```bash
cd media-bridge
gcloud run deploy media-bridge \
  --source . \
  --region me-west1 \
  --project voice-ai-production \
  --min-instances 1 \
  --session-affinity \
  --set-env-vars="NODE_ENV=production,LOG_LEVEL=info"
```

### שלב 3: אימות התיקון

1. בדיקת health endpoint:
```bash
curl https://media-bridge-692599475968.me-west1.run.app/health
```

2. בדיקת שיחה חוזרת למספר +972765993896

---

## סיכום טכני

| פריט | סטטוס |
|------|-------|
| Edge Function | ✅ עובד תקין |
| TwiML Response | ✅ מחזיר stream URL נכון |
| Token Generation | ✅ יוצר HMAC token |
| Media Bridge Deploy | ❌ נכשל בגלל שגיאת קומפילציה |
| WebSocket Connection | ❌ נכשל |

הבעיה היא **שגיאת קומפילציה בלבד** - תיקון הכפילות ופריסה מחדש יפתור את הבעיה.

