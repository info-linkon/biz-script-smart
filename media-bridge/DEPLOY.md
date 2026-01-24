# Media-Bridge Deployment Guide for Google Cloud Run

## Prerequisites

1. **Google Cloud CLI** installed and authenticated
2. **Docker** installed locally (optional, for local testing)
3. **Google Cloud Project** with billing enabled
4. Required APIs enabled:
   - Cloud Run API
   - Artifact Registry API
   - Cloud Speech-to-Text API
   - Cloud Text-to-Speech API

## Step 1: Set Up Environment Variables

```bash
# Set your project ID
export PROJECT_ID="voice-ai-production"
export REGION="me-west1"  # Israel region for low latency
export SERVICE_NAME="media-bridge"

# Configure gcloud
gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION
```

## Step 2: Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  speech.googleapis.com \
  texttospeech.googleapis.com
```

## Step 3: Create Artifact Registry Repository

```bash
gcloud artifacts repositories create voice-ai-repo \
  --repository-format=docker \
  --location=$REGION \
  --description="Voice AI Docker images"
```

## Step 4: Configure Docker for Artifact Registry

```bash
gcloud auth configure-docker $REGION-docker.pkg.dev
```

## Step 5: Build and Push Docker Image

```bash
# Navigate to media-bridge directory
cd media-bridge

# Build the image
docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/voice-ai-repo/$SERVICE_NAME:latest .

# Push to Artifact Registry
docker push $REGION-docker.pkg.dev/$PROJECT_ID/voice-ai-repo/$SERVICE_NAME:latest
```

## Step 6: Create Service Account

```bash
# Create service account for the media bridge
gcloud iam service-accounts create media-bridge-sa \
  --display-name="Media Bridge Service Account"

# Grant required roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:media-bridge-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/speech.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:media-bridge-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/texttospeech.client"
```

## Step 7: Generate API Secret

```bash
# Generate a secure random secret
export MEDIA_BRIDGE_SECRET=$(openssl rand -base64 32)
echo "Your MEDIA_BRIDGE_SECRET: $MEDIA_BRIDGE_SECRET"
# Save this - you'll need it for the Edge Function
```

## Step 8: Deploy to Cloud Run

```bash
gcloud run deploy $SERVICE_NAME \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/voice-ai-repo/$SERVICE_NAME:latest \
  --platform=managed \
  --region=$REGION \
  --allow-unauthenticated \
  --service-account=media-bridge-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars="MEDIA_BRIDGE_SECRET=$MEDIA_BRIDGE_SECRET" \
  --min-instances=1 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=3600 \
  --concurrency=100 \
  --session-affinity
```

### Important Flags Explained:
- `--min-instances=1`: Keep at least one instance warm for low latency
- `--timeout=3600`: 1 hour max for long calls
- `--session-affinity`: Ensure WebSocket connections stay on same instance
- `--allow-unauthenticated`: Required for WebSocket connections (we handle auth internally)

## Step 9: Get Service URL

```bash
gcloud run services describe $SERVICE_NAME --format='value(status.url)'
```

Example output: `https://media-bridge-xxxxxxxxxx-xx.a.run.app`

## Step 10: Update Lovable Cloud Secrets

Add these secrets in your Lovable Cloud project:

1. `MEDIA_BRIDGE_URL` - The Cloud Run service URL (with /ws suffix for WebSocket)
2. `MEDIA_BRIDGE_SECRET` - The secret you generated in Step 7

## Step 11: Verify Deployment

```bash
# Health check
curl https://media-bridge-xxxxxxxxxx-xx.a.run.app/health

# Expected response:
# {"status":"healthy","activeSessions":0,"timestamp":"2024-01-25T12:00:00.000Z"}
```

## Local Testing (Optional)

```bash
# Build and run locally
cd media-bridge
npm install
npm run build
MEDIA_BRIDGE_SECRET=test npm start

# Test health endpoint
curl http://localhost:8080/health
```

## Updating the Service

When you need to update the code:

```bash
# Rebuild and push
docker build -t $REGION-docker.pkg.dev/$PROJECT_ID/voice-ai-repo/$SERVICE_NAME:latest .
docker push $REGION-docker.pkg.dev/$PROJECT_ID/voice-ai-repo/$SERVICE_NAME:latest

# Deploy new version
gcloud run deploy $SERVICE_NAME \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/voice-ai-repo/$SERVICE_NAME:latest
```

## Monitoring

View logs in Cloud Console:
```bash
gcloud run logs read $SERVICE_NAME --limit=100
```

Or stream logs:
```bash
gcloud run logs tail $SERVICE_NAME
```

## Cost Optimization

For production, consider:

1. **Reduce min-instances** during low-traffic hours using Cloud Scheduler
2. **Use committed use discounts** for predictable workloads
3. **Monitor and adjust memory/CPU** based on actual usage

## Troubleshooting

### WebSocket Connection Issues
- Ensure `--session-affinity` is enabled
- Check that `--timeout` is sufficient for your call duration
- Verify the secret is correct

### High Latency
- Consider using a region closer to your users
- Increase `--min-instances` to reduce cold starts
- Check STT/TTS quotas

### Out of Memory
- Increase `--memory` allocation
- Check for memory leaks in long-running sessions

## Architecture Diagram

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Twilio    │────▶│  Edge Function   │────▶│  Media Bridge   │
│   (Calls)   │◀────│  (WebSocket)     │◀────│  (Cloud Run)    │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
                           ┌──────────────────────────┼──────────────────────────┐
                           │                          │                          │
                           ▼                          ▼                          ▼
                    ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
                    │  Google     │          │  Google     │          │ Dialogflow  │
                    │  STT (V1)   │          │  TTS        │          │ CX          │
                    └─────────────┘          └─────────────┘          └─────────────┘
```
