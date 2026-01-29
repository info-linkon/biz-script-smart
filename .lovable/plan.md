
# תיקון: הסוכן לא מדבר - חסרות הרשאות Google Cloud

## ניתוח הבעיה

השיחה **לא מתנתקת** עכשיו (יש חיבור WebSocket), אבל הסוכן **לא מדבר** כי:

1. **Media Bridge משתמש ב-Google Cloud APIs**:
   - `@google-cloud/speech` - STT (זיהוי דיבור)
   - `@google-cloud/text-to-speech` - TTS (המרת טקסט לדיבור)

2. **הפריסה חסרה Service Account**:
   - פרסת עם `gcloud run deploy --source .` בלי `--service-account`
   - ה-default service account אין לו הרשאות ל-Speech/TTS APIs
   - לכן הברכה לא נשלחת

---

## תוכנית תיקון

### שלב 1: ודא שה-Service Account קיים ויש לו הרשאות

```bash
# בדוק אם ה-service account קיים
gcloud iam service-accounts list --project=voice-ai-production | grep media-bridge

# אם לא קיים, צור אותו
gcloud iam service-accounts create media-bridge-sa \
  --display-name="Media Bridge Service Account" \
  --project=voice-ai-production

# הוסף הרשאות STT
gcloud projects add-iam-policy-binding voice-ai-production \
  --member="serviceAccount:media-bridge-sa@voice-ai-production.iam.gserviceaccount.com" \
  --role="roles/speech.client"

# הוסף הרשאות TTS
gcloud projects add-iam-policy-binding voice-ai-production \
  --member="serviceAccount:media-bridge-sa@voice-ai-production.iam.gserviceaccount.com" \
  --role="roles/texttospeech.client"
```

### שלב 2: פרוס מחדש עם Service Account

```bash
cd media-bridge && gcloud run deploy media-bridge \
  --source . \
  --region me-west1 \
  --project voice-ai-production \
  --service-account=media-bridge-sa@voice-ai-production.iam.gserviceaccount.com \
  --min-instances 1 \
  --session-affinity \
  --set-env-vars="NODE_ENV=production,LOG_LEVEL=info"
```

### שלב 3: בדוק לוגים

```bash
gcloud run logs tail media-bridge --project voice-ai-production
```

תחפש שגיאות כמו:
- `Permission denied` 
- `API not enabled`
- `Could not load the default credentials`

---

## פרטים טכניים

| רכיב | סטטוס |
|------|-------|
| WebSocket Connection | ✅ עובד |
| Token Validation | ✅ עובד |
| Google STT | ❌ חסרות הרשאות |
| Google TTS | ❌ חסרות הרשאות |
| Greeting | ❌ לא נשלח |

הבעיה היא **הרשאות בלבד** - הקוד תקין, פשוט צריך לפרוס עם ה-service account הנכון.
