
# סקירת תהליך Voice AI ואיתור הבעיה

## תהליך השיחה המלא

```text
+-------------+     TwiML      +----------------+     WSS      +---------------+
|   Twilio    | -------------> |  Edge Function | -----------> | Media Bridge  |
|   (Call)    | <------------- |  (token gen)   | <----------- | (Cloud Run)   |
+-------------+     Voice      +----------------+     Audio    +---------------+
                                                                      |
                    +------------------+------------------+-----------+
                    |                  |                  |
                    v                  v                  v
              +-----------+     +-----------+     +-----------+
              | Google    |     | Google    |     | Dialogflow|
              | STT (V1)  |     | TTS       |     | CX        |
              +-----------+     +-----------+     +-----------+
```

## מה עובד

| שלב | סטטוס | הוכחה |
|-----|--------|------|
| שיחה מגיעה ל-Twilio | ✅ | לוגים מראים `Twilio call received` |
| Edge Function מייצר TwiML | ✅ | לוגים מראים `TwiML Response (token generated)` |
| טוקן נוצר נכון | ✅ | `hasToken: true` בלוגים |
| WebSocket Connection | ✅ | השיחה לא מתנתקת |

## בעיה מזוהה: חסר MEDIA_BRIDGE_SECRET ב-Cloud Run

כשפרסת את ה-Media Bridge, השתמשת בפקודה:
```bash
gcloud run deploy media-bridge \
  --set-env-vars="NODE_ENV=production,LOG_LEVEL=info"
```

**חסר:** `MEDIA_BRIDGE_SECRET` - בלי הסוד הזה:
1. ה-Media Bridge לא יכול לאמת את הטוקן
2. Session לא מאומת → לא נשלחת ברכה → שקט!

## תיקון נדרש

### שלב 1: בדוק את הערך של MEDIA_BRIDGE_SECRET ב-Lovable Cloud

הסוד כבר מוגדר ב-Edge Functions. צריך לקבל את אותו ערך ולהוסיף אותו ל-Cloud Run.

### שלב 2: פרוס מחדש עם כל המשתנים הנדרשים

```bash
gcloud run deploy media-bridge \
  --source . \
  --region me-west1 \
  --project voice-ai-production \
  --service-account=media-bridge-sa@voice-ai-production.iam.gserviceaccount.com \
  --min-instances 1 \
  --session-affinity \
  --set-env-vars="NODE_ENV=production,LOG_LEVEL=info,MEDIA_BRIDGE_SECRET=YOUR_SECRET_VALUE_HERE"
```

### שלב 3: בדוק לוגים של Cloud Run

```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=media-bridge" \
  --project=voice-ai-production \
  --limit=50 \
  --format='value(textPayload)'
```

## פרטים טכניים

### מה קורה בקוד כשאין Secret

ב-`session.ts` שורה 218-224:
```typescript
} else if (!this.apiSecret) {
  // No secret configured - allow connection (development mode)
  console.log(`[${this.sessionId}] No API secret configured, allowing connection`);
  this.validated = true;
  // ...
}
```

למעשה, ה-Session כן מאומת (בגלל dev mode), אז צריך לבדוק בעיה אחרת...

### בעיה אפשרית נוספת: TTS API לא מופעל

ה-service account קיבל `roles/speech.client` אבל לא `roles/texttospeech.client` (כי הוא לא קיים).

צריך לוודא ש-**Text-to-Speech API** מופעל בפרויקט:

```bash
gcloud services enable texttospeech.googleapis.com --project=voice-ai-production
```

### בדיקת לוגים

הרץ את הפקודה הבאה כדי לראות מה קורה ב-Media Bridge:

```bash
gcloud run logs tail media-bridge --project voice-ai-production
```

ותחייג בו-זמנית. תחפש:
- `Session validated` - האם האימות עבר?
- `STT stream started` - האם ה-STT התחיל?
- `Greeting` - האם הברכה נשלחה?
- `TTS error` / `STT error` - האם יש שגיאות?

## סיכום פעולות נדרשות

1. **הפעל Text-to-Speech API:**
   ```bash
   gcloud services enable texttospeech.googleapis.com --project=voice-ai-production
   ```

2. **בדוק לוגים בזמן שיחה:**
   ```bash
   gcloud run logs tail media-bridge --project voice-ai-production
   ```

3. **אם יש שגיאות הרשאה** - הוסף תפקיד:
   ```bash
   gcloud projects add-iam-policy-binding voice-ai-production \
     --member="serviceAccount:media-bridge-sa@voice-ai-production.iam.gserviceaccount.com" \
     --role="roles/texttospeech.admin"
   ```

4. **פרוס מחדש עם MEDIA_BRIDGE_SECRET:**
   ```bash
   gcloud run deploy media-bridge \
     --source . \
     --region me-west1 \
     --project voice-ai-production \
     --service-account=media-bridge-sa@voice-ai-production.iam.gserviceaccount.com \
     --min-instances 1 \
     --session-affinity \
     --set-env-vars="NODE_ENV=production,LOG_LEVEL=info,MEDIA_BRIDGE_SECRET=<SECRET>"
   ```
