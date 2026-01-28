

# תוכנית עבודה לפרודקשן - Runbook Gaps Analysis

## סיכום מצב נוכחי

### מה כבר מיושם ✅

| Gate | סטטוס | הערות |
|------|-------|-------|
| Token validation מ-customParameters | ✅ מיושם | session.ts |
| Media drop לפני validation | ✅ מיושם | session.ts |
| Replay Protection (JTI) | ✅ מיושם | auth.ts |
| UTF-8 safe encoding | ✅ מיושם | Buffer.from('utf-8') |
| STT Deduplication | ✅ מיושם | session.ts |
| Circuit Breaker | ✅ מיושם | circuit-breaker.ts |
| Heartbeat דינמי | ✅ מיושם | 90s/120s/180s לפי state |
| sessionState tracking | ✅ מיושם | idle/awaiting_user/agent_speaking/processing |
| lastActivityType | ✅ מיושם | media_in/stt_result/tts_sent/dialogflow |
| isQuestionText | ✅ מיושם | Hebrew/Arabic question detection |
| recordWSClose עם JSON מלא | ✅ מיושם | כל הקונטקסט כולל metrics |
| Startup logging | ✅ מיושם | ENV/LOG_LEVEL/PORT/secrets |

---

## Gap Analysis - מה חסר

### Gate 1: Secrets + Env - דרוש וידוא

**בעיות נוכחיות:**
- אין וידוא ש-`NODE_ENV=production` מוגדר
- אין `LOG_LEVEL` configurable
- חסר logging ב-startup לסביבה

**נדרש:**
```typescript
// index.ts - הוסף ב-startup
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Log level: ${process.env.LOG_LEVEL || 'info'}`);
```

---

### Gate 5: יציבות חיבור - חסרים שדות קריטיים

**בעיות בקוד הנוכחי:**

1. **חסר `sessionState`** - אין מעקב אחר מצב הסשן (awaiting_user, agent_speaking, idle)
2. **חסר `lastActivityType`** - יודעים רק `lastActivityTime`, לא איזה סוג פעילות
3. **Heartbeat timeout קבוע** - 5 דקות לכולם, לא דינמי לפי state
4. **חסר `isAskingQuestion`** - לא מזהים אם התוכן שאלה

**הקוד הנוכחי (session.ts:111-129):**
```typescript
private startHeartbeat() {
  this.heartbeatTimer = setInterval(() => {
    const idleTime = Date.now() - this.lastActivityTime;
    
    if (idleTime > 60000) {
      console.log(`[${this.sessionId}] Session idle for ${Math.round(idleTime / 1000)}s`);
    }
    
    // Close sessions that are idle for too long (5 minutes)
    if (idleTime > 300000) {  // ❌ קבוע, לא דינמי
      console.log(`[${this.sessionId}] Session timed out due to inactivity`);
      this.cleanup();
      this.emit('end');
    }
  }, 30000);
}
```

**נדרש:**
- הוספת `sessionState: 'idle' | 'awaiting_user' | 'agent_speaking' | 'processing'`
- הוספת `lastActivityType: 'media_in' | 'stt_result' | 'tts_sent' | 'dialogflow'`
- Timeout דינמי: 90s ב-idle, 120s ב-awaiting_user

---

### Gate 7: Close Context - חסרים שדות

**הקוד הנוכחי (session.ts:621-625):**
```typescript
recordWSClose(code: number, reason: string) {
  console.log(`[${this.sessionId}] WS Close recorded - Code: ${code}, Reason: ${reason}, ` +
    `Validated: ${this.validated}, Turns: ${this.turnsCount}, ` +
    `Duration: ${this.getDuration()}ms, MediaDropped: ${this.mediaPacketsBeforeValidation}`);
}
```

**חסר:**
- `sessionState`
- `isAgentSpeaking` (קיים אבל לא בלוג)
- `lastActivityType`
- `lastActivityAgoMs`

---

### שינויים נדרשים ב-session.ts

#### 1. הוספת שדות state

```typescript
// Security
private validated: boolean = false;
// ... existing fields ...

// Session State Tracking (NEW)
private sessionState: 'idle' | 'awaiting_user' | 'agent_speaking' | 'processing' = 'idle';
private lastActivityType: 'none' | 'media_in' | 'stt_result' | 'tts_sent' | 'dialogflow' = 'none';
```

#### 2. עדכון updateActivity

```typescript
private updateActivity(type: 'media_in' | 'stt_result' | 'tts_sent' | 'dialogflow' = 'media_in') {
  this.lastActivityTime = Date.now();
  this.lastActivityType = type;
}
```

#### 3. עדכון handleAudio

```typescript
private async handleAudio(base64Audio: string) {
  this.updateActivity('media_in');
  // ... rest of code
}
```

#### 4. עדכון handleRecognitionResult

```typescript
private handleRecognitionResult(response: any) {
  // ... existing code ...
  
  console.log(`[${this.sessionId}] Final: "${transcript}" (${(confidence * 100).toFixed(1)}%)`);
  this.updateActivity('stt_result');
  this.sessionState = 'processing';
  // ... rest of code
}
```

#### 5. עדכון speakText

```typescript
private async speakText(text: string) {
  if (!text.trim()) return;
  
  this.sessionState = 'agent_speaking';
  this.isAgentSpeaking = true;
  
  // ... existing TTS code ...
  
  this.updateActivity('tts_sent');
  this.isAgentSpeaking = false;
  
  // Check if this was a question
  this.sessionState = this.isQuestionText(text) ? 'awaiting_user' : 'idle';
}

private isQuestionText(text: string): boolean {
  const questionPatterns = [
    /\?$/,                    // Ends with ?
    /؟$/,                     // Arabic question mark
    /^(מה|איך|למה|מתי|איפה|האם)/,  // Hebrew question words
    /^(ما|كيف|لماذا|متى|أين|هل)/,  // Arabic question words
  ];
  return questionPatterns.some(p => p.test(text.trim()));
}
```

#### 6. עדכון Heartbeat דינמי

```typescript
private startHeartbeat() {
  this.heartbeatTimer = setInterval(() => {
    const idleTime = Date.now() - this.lastActivityTime;
    
    // Dynamic timeout based on state
    const timeout = this.sessionState === 'awaiting_user' ? 120000 : 
                    this.sessionState === 'agent_speaking' ? 180000 : 90000;
    
    if (idleTime > 60000) {
      console.log(`[${this.sessionId}] Session idle for ${Math.round(idleTime / 1000)}s, state: ${this.sessionState}`);
    }
    
    if (idleTime > timeout) {
      console.log(`[${this.sessionId}] Session timed out: state=${this.sessionState}, idle=${Math.round(idleTime/1000)}s, timeout=${timeout/1000}s`);
      this.ws.close(4000, 'connection_stale');
      this.cleanup();
      this.emit('end');
    }
  }, 30000);
  
  this.heartbeatTimer.unref();
}
```

#### 7. עדכון recordWSClose

```typescript
recordWSClose(code: number, reason: string) {
  const lastActivityAgoMs = Date.now() - this.lastActivityTime;
  
  console.log(`[${this.sessionId}] WS Close Context:`, JSON.stringify({
    code,
    reason,
    validated: this.validated,
    sessionState: this.sessionState,
    isAgentSpeaking: this.isAgentSpeaking,
    lastActivityType: this.lastActivityType,
    lastActivityAgoMs,
    turnsCount: this.turnsCount,
    durationMs: this.getDuration(),
    mediaDroppedBeforeValidation: this.mediaPacketsBeforeValidation,
    metrics: this.metrics
  }));
}
```

---

### שינויים נדרשים ב-index.ts

#### 1. Startup logging

```typescript
const PORT = parseInt(process.env.PORT || '8080', 10);
const API_SECRET = process.env.MEDIA_BRIDGE_SECRET || '';
const DEV_TOKEN = process.env.DEV_TOKEN || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// ... later in server.listen callback:

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=== Media Bridge Starting ===`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Log level: ${LOG_LEVEL}`);
  console.log(`Port: ${PORT}`);
  console.log(`API Secret configured: ${API_SECRET ? 'Yes' : 'No (WARNING: dev mode)'}`);
  console.log(`Dev Token configured: ${DEV_TOKEN ? 'Yes' : 'No'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`=============================`);
});
```

---

## Checklist לפריסה

### Gate 0: Secrets (לפני קוד)
- [ ] Cloud Run: `MEDIA_BRIDGE_SECRET` מוגדר
- [ ] Cloud Run: `NODE_ENV=production`
- [ ] Cloud Run: `LOG_LEVEL=info`
- [ ] Supabase: `MEDIA_BRIDGE_SECRET` זהה
- [ ] Supabase: `MEDIA_BRIDGE_URL` = wss://...

### Gate 1: Happy Path
- [ ] שיחה נכנסת → TwiML מחזיר Stream עם sessionToken
- [ ] WS נפתח → אין validation ב-connection
- [ ] start מגיע → session קורא customParameters.sessionToken
- [ ] verifySessionToken עובר → validated=true
- [ ] media מתחיל רק אחרי validation
- [ ] לוג: "Validated for call: ..."

### Gate 2: Security Guards
- [ ] Token שגוי → 4001 Unauthorized
- [ ] Token פג → 4001 Token expired
- [ ] media לפני start → drop בשקט (לוג פעם ב-100)
- [ ] Replay attack → 4001 Token already used

### Gate 3: Unicode Token
- [ ] userId עם עברית → token נוצר ומאומת
- [ ] userId עם ערבית → token נוצר ומאומת

### Gate 4: יציבות חיבור
- [ ] שקט 70-80 שניות → לא מתנתק
- [ ] שקט 100+ שניות (idle) → מתנתק עם connection_stale
- [ ] בזמן agent_speaking → לא מתנתק
- [ ] אחרי שאלה → timeout 120s

### Gate 5: STT Dedupe
- [ ] transcript כפול תוך 2 שניות → נזרק
- [ ] לא מעביר ל-Dialogflow כפולים

### Gate 6: Close Context
- [ ] כל close יש JSON מלא עם:
  - code, reason
  - validated
  - sessionState
  - isAgentSpeaking
  - lastActivityType
  - lastActivityAgoMs

### Gate 7: עומס בסיסי
- [ ] 10 שיחות רצופות של 3-5 דקות
- [ ] זיכרון חוזר לקו בסיס
- [ ] אין accumulate ב-audioBuffer

---

## סיכום פעולות

| # | פעולה | קובץ | עדיפות |
|---|-------|------|--------|
| 1 | הוסף sessionState + lastActivityType | session.ts | P0 |
| 2 | עדכן updateActivity לקבל type | session.ts | P0 |
| 3 | עדכן heartbeat לdynamic timeout | session.ts | P0 |
| 4 | הוסף isQuestionText | session.ts | P1 |
| 5 | עדכן recordWSClose עם JSON מלא | session.ts | P0 |
| 6 | הוסף startup logging | index.ts | P1 |
| 7 | Deploy עם NODE_ENV=production | Cloud Run | P0 |

---

## פקודות Deploy

### Cloud Run
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

### בדיקת Health
```bash
curl https://media-bridge-692599475968.me-west1.run.app/health
```

### בדיקת Logs
```bash
gcloud run logs tail media-bridge --region me-west1
```

