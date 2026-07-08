# Video Meet - Google Meet Clone on Cloud Run

A real-time video conferencing application similar to Google Meet, built with WebRTC and designed for Google Cloud Run deployment.

## Features

- **Video/Audio Calls** - WebRTC peer-to-peer video and audio
- **Screen Sharing** - Share your screen with participants
- **In-call Chat** - Real-time text messaging during meetings
- **Multiple Participants** - Support for group calls with dynamic grid layout
- **Meeting Links** - Shareable room codes for easy joining
- **Responsive UI** - Works on desktop and mobile
- **Camera/Mic Controls** - Toggle audio/video before and during meetings

## Architecture

- **Frontend**: Vanilla JS with WebRTC APIs, Material Design inspired UI
- **Backend**: Node.js + Express + Socket.IO (signaling server)
- **Communication**: WebRTC for peer-to-peer media, WebSocket for signaling
- **Hosting**: Google Cloud Run (stateful with session affinity)

## Local Development

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open http://localhost:8080
```

## Deploy to Cloud Run

### Option 1: Using gcloud CLI (Recommended)

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Build and deploy in one command
gcloud run deploy video-meet \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --session-affinity \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 3600
```

### Option 2: Using Cloud Build

```bash
gcloud builds submit --config cloudbuild.yaml
```

### Option 3: Manual Docker Build

```bash
# Build the image
docker build -t gcr.io/YOUR_PROJECT_ID/video-meet .

# Push to Container Registry
docker push gcr.io/YOUR_PROJECT_ID/video-meet

# Deploy to Cloud Run
gcloud run deploy video-meet \
  --image gcr.io/YOUR_PROJECT_ID/video-meet \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --session-affinity \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 3600
```

## Important Cloud Run Settings

| Setting | Value | Reason |
|---------|-------|--------|
| `--session-affinity` | enabled | Keeps WebSocket connections on the same instance |
| `--min-instances 1` | 1 | Prevents cold starts that would break connections |
| `--timeout` | 3600 | Allows long-running meeting sessions |
| `--port` | 8080 | Default HTTP port used by the server |

## How It Works

1. **Signaling**: Socket.IO handles WebRTC signaling (SDP offers/answers, ICE candidates)
2. **Media**: After signaling, browsers connect peer-to-peer using WebRTC
3. **STUN**: Google's public STUN servers handle NAT traversal
4. **Rooms**: Server maintains room state for participant management

## Limitations & Production Considerations

- **TURN Server**: For users behind strict firewalls/symmetric NATs, you'll need a TURN server (e.g., Twilio, Xirsys, or self-hosted coturn). Add TURN credentials to the ICE servers config in `public/app.js`.
- **Scaling**: WebRTC peer-to-peer works well up to ~6 participants. For larger meetings, consider an SFU (Selective Forwarding Unit) like mediasoup or Janus.
- **Cloud Run Limits**: WebSocket connections are limited to 60 minutes on Cloud Run. For longer meetings, implement reconnection logic.
- **Recording**: Not included. Could be added with server-side recording via headless browser or media recording APIs.

## Adding a TURN Server (Production)

Update the `iceServers` configuration in `public/app.js`:

```javascript
this.iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'your-username',
      credential: 'your-credential'
    }
  ]
};
```
