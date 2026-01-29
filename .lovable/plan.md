
# אבחון ותיקון: Media Bridge מתנתק מהר מדי

## הבעיה שזיהיתי

כשאתה מתקשר, ה-Media Bridge מתנתק תוך ~10 שניות ואתה שומע:
> "יש בעיה זמנית בחיבור. נמשיך בשיחה רגילה..."

זו הודעת Fallback שמופעלת כשה-WebSocket Stream נכשל.

## סיבות אפשריות (לפי סדר סבירות)

| סיבה | הסבר |
|------|------|
| TTS API לא מופעל | ה-Session שולח ברכה, TTS נכשל → קריסה |
| STT API לא עובד | streamingRecognize נכשל → קריסה |
| Secret לא תואם | הטוקן לא מאומת → Session לא עובד כראוי |
| GOOGLE_CLOUD_CREDENTIALS חסר | Media Bridge לא יכול להתחבר ל-Google Cloud |

## פעולות נדרשות

### שלב 1: בדוק את לוגי Cloud Run
הרץ בטרמינל בזמן שאתה מחייג:
```bash
gcloud run logs tail media-bridge --project voice-ai-production
```

חפש:
- `Session validated` או `Validation failed`
- `STT stream started` או `STT error`
- `TTS error`
- `GOOGLE_APPLICATION_CREDENTIALS`

### שלב 2: ודא שה-APIs מופעלים
```bash
gcloud services list --enabled --project=voice-ai-production | grep -E "(speech|text)"
```

אם לא רואים `speech.googleapis.com` ו-`texttospeech.googleapis.com`:
```bash
gcloud services enable speech.googleapis.com --project=voice-ai-production
gcloud services enable texttospeech.googleapis.com --project=voice-ai-production
```

### שלב 3: ודא שה-Credentials מוגדרים ב-Cloud Run

ב-Media Bridge, ה-Google Cloud SDKs מצפים לאחד מהבאים:
- קובץ credentials בנתיב שמוגדר ב-`GOOGLE_APPLICATION_CREDENTIALS`
- Service Account אוטומטי של Cloud Run (אם מפעילים עם `--service-account`)

**פריסה נכונה עם Service Account:**
```bash
gcloud run deploy media-bridge \
  --source . \
  --region me-west1 \
  --project voice-ai-production \
  --service-account=media-bridge-sa@voice-ai-production.iam.gserviceaccount.com \
  --min-instances 1 \
  --session-affinity \
  --set-env-vars="NODE_ENV=production,LOG_LEVEL=debug,MEDIA_BRIDGE_SECRET=<הסוד שהזנת>"
```

**שים לב:** הוספתי `LOG_LEVEL=debug` כדי לקבל יותר לוגים.

### שלב 4: הענק הרשאות ל-Service Account
```bash
gcloud projects add-iam-policy-binding voice-ai-production \
  --member="serviceAccount:media-bridge-sa@voice-ai-production.iam.gserviceaccount.com" \
  --role="roles/speech.client"
```

**הערה:** לעומת TTS שלא צריך role מיוחד, STT דורש `roles/speech.client`.

### שלב 5: בדיקה

1. פרוס מחדש עם `LOG_LEVEL=debug`
2. פתח טרמינל חדש עם `gcloud run logs tail`
3. חייג ל-+972765993896
4. צפה בלוגים ושלח לי את מה שאתה רואה

---

## פרטים טכניים

### למה זה קורה?

הקוד ב-`session.ts` מנסה:
1. לפתוח STT stream (שורה 248-271)
2. לשלוח ברכה באמצעות TTS (שורה 278-281)

אם אחד מהם נכשל בגלל credentials/API, ה-session קורס או מתנתק.

### מה מציג ללקוח?

כשה-WebSocket נסגר, Twilio עובר ל-Fallback ב-TwiML (שורות 175-181):
```xml
<Say>יש בעיה זמנית בחיבור...</Say>
<Gather input="speech" action="twilio-dialogflow-bridge">
```

זה מסביר למה אתה שומע את ההודעה הזו ואז השיחה ממשיכה (אבל רק דרך Dialogflow ישיר, לא דרך Media Bridge).

### ההבדל בין השיחות

| תאריך | סוג | מה קרה |
|-------|-----|---------|
| 28/01 22:52 | Media Bridge עבד | שיחה של 8 שניות עם תמלול |
| 29/01 07:52 | Media Bridge נכשל | Fallback ל-Dialogflow ישיר |

ייתכן שהפרסת מחדש בין לבין ומשהו השתנה (חסר secret/credentials).
