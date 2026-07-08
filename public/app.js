const BASE_PATH = window.__BASE_PATH__ || '';

function appPath(subpath = '') {
  const suffix = subpath.startsWith('/') ? subpath : `/${subpath}`;
  return `${BASE_PATH}${suffix}`.replace(/\/{2,}/g, '/') || '/';
}

function getAppPathname() {
  const pathname = window.location.pathname;
  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    return pathname.slice(BASE_PATH.length) || '/';
  }
  return pathname;
}

class VideoMeetApp {
  constructor() {
    this.socket = null;
    this.localStream = null;
    this.screenStream = null;
    this.peers = new Map();
    this.roomId = null;
    this.userName = '';
    this.isAudioEnabled = true;
    this.isVideoEnabled = true;
    this.isScreenSharing = false;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordingCanvas = null;
    this.recordingCtx = null;
    this.recordingAnimFrame = null;
    this.meetingStartTime = null;
    this.timerInterval = null;
    this.consentAccepted = false;

    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    };

    this.init();
  }

  init() {
    this.bindLandingEvents();
    this.bindPreviewEvents();
    this.bindMeetingEvents();
    this.bindScheduleEvents();
    this.bindConsentEvents();
    this.handleUrlRoom();
  }

  handleUrlRoom() {
    const path = getAppPathname();
    const match = path.match(/^\/([a-f0-9]+-[a-f0-9]+-[a-f0-9]+)$/) ||
                  path.match(/^\/(meet-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+)$/);
    if (match) {
      this.roomId = match[1];
      this.showPreview();
    } else if (path === '/schedule') {
      this.switchPage('schedule-page');
      this.loadMeetings();
    }
  }

  // Landing Page
  bindLandingEvents() {
    document.getElementById('btn-new-meeting').addEventListener('click', () => {
      this.createRoom();
    });

    document.getElementById('btn-schedule-meeting').addEventListener('click', () => {
      this.switchPage('schedule-page');
      window.history.pushState({}, '', appPath('/schedule'));
      this.loadMeetings();
    });

    const input = document.getElementById('input-room-code');
    const joinBtn = document.getElementById('btn-join');

    input.addEventListener('input', () => {
      joinBtn.disabled = !input.value.trim();
    });

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        this.joinWithCode(input.value.trim());
      }
    });

    joinBtn.addEventListener('click', () => {
      this.joinWithCode(input.value.trim());
    });
  }

  async createRoom() {
    const res = await fetch(appPath('/api/create-room'));
    const data = await res.json();
    this.roomId = data.roomId;
    window.history.pushState({}, '', appPath(`/${this.roomId}`));
    this.showPreview();
  }

  joinWithCode(code) {
    const roomId = code.replace(/.*\//, '').trim();
    this.roomId = roomId;
    window.history.pushState({}, '', appPath(`/${this.roomId}`));
    this.showPreview();
  }

  // Preview Page
  async showPreview() {
    this.consentAccepted = false;
    this.switchPage('preview-page');
    document.getElementById('preview-room-id').textContent = this.roomId;
    this.setPreviewJoinEnabled(false);
    this.showConsentModal();

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      document.getElementById('preview-video').srcObject = this.localStream;
      document.getElementById('preview-no-video').classList.add('hidden');
    } catch (err) {
      console.warn('Could not access media devices:', err);
      document.getElementById('preview-no-video').classList.remove('hidden');
    }
  }

  showConsentModal() {
    const modal = document.getElementById('consent-modal');
    const checkbox = document.getElementById('consent-checkbox');
    const acceptBtn = document.getElementById('btn-consent-accept');

    checkbox.checked = false;
    acceptBtn.disabled = true;
    modal.classList.remove('hidden');
  }

  hideConsentModal() {
    document.getElementById('consent-modal').classList.add('hidden');
  }

  setPreviewJoinEnabled(enabled) {
    const joinBtn = document.getElementById('btn-join-now');
    const nameInput = document.getElementById('input-user-name');
    joinBtn.disabled = !enabled;
    joinBtn.classList.toggle('preview-join-disabled', !enabled);
    nameInput.disabled = !enabled;
  }

  bindConsentEvents() {
    const checkbox = document.getElementById('consent-checkbox');
    const acceptBtn = document.getElementById('btn-consent-accept');
    const declineBtn = document.getElementById('btn-consent-decline');

    checkbox.addEventListener('change', () => {
      acceptBtn.disabled = !checkbox.checked;
    });

    acceptBtn.addEventListener('click', () => {
      if (!checkbox.checked) return;
      this.consentAccepted = true;
      this.hideConsentModal();
      this.setPreviewJoinEnabled(true);
      document.getElementById('input-user-name').focus();
    });

    declineBtn.addEventListener('click', () => {
      this.hideConsentModal();
      this.stopLocalStream();
      this.switchPage('landing-page');
      window.history.pushState({}, '', appPath('/'));
    });
  }

  bindPreviewEvents() {
    document.getElementById('preview-toggle-audio').addEventListener('click', (e) => {
      this.isAudioEnabled = !this.isAudioEnabled;
      const btn = e.currentTarget;
      btn.querySelector('.material-icons').textContent = this.isAudioEnabled ? 'mic' : 'mic_off';
      btn.classList.toggle('muted', !this.isAudioEnabled);
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => t.enabled = this.isAudioEnabled);
      }
    });

    document.getElementById('preview-toggle-video').addEventListener('click', (e) => {
      this.isVideoEnabled = !this.isVideoEnabled;
      const btn = e.currentTarget;
      btn.querySelector('.material-icons').textContent = this.isVideoEnabled ? 'videocam' : 'videocam_off';
      btn.classList.toggle('muted', !this.isVideoEnabled);
      if (this.localStream) {
        this.localStream.getVideoTracks().forEach(t => t.enabled = this.isVideoEnabled);
      }
      document.getElementById('preview-no-video').classList.toggle('hidden', this.isVideoEnabled);
    });

    document.getElementById('btn-join-now').addEventListener('click', () => {
      if (!this.consentAccepted) {
        this.showConsentModal();
        return;
      }
      this.userName = document.getElementById('input-user-name').value.trim() || 'Guest';
      this.joinMeeting();
    });

    document.getElementById('btn-back').addEventListener('click', () => {
      this.stopLocalStream();
      this.switchPage('landing-page');
      window.history.pushState({}, '', appPath('/'));
    });

    document.getElementById('input-user-name').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        if (!this.consentAccepted) {
          this.showConsentModal();
          return;
        }
        this.userName = document.getElementById('input-user-name').value.trim() || 'Guest';
        this.joinMeeting();
      }
    });
  }

  // Meeting
  joinMeeting() {
    if (!this.consentAccepted) {
      this.showConsentModal();
      return;
    }

    this.switchPage('meeting-page');
    this.setupLocalVideo();
    this.connectSocket();
    this.startTimer();

    document.getElementById('meeting-id-display').textContent = this.roomId;
    document.getElementById('meeting-id-bottom').textContent = this.roomId;
    document.getElementById('local-name').textContent = `${this.userName} (You)`;
    document.getElementById('local-avatar').textContent = this.userName[0];
    document.getElementById('preview-avatar').textContent = this.userName[0];
  }

  setupLocalVideo() {
    const video = document.getElementById('local-video');
    video.srcObject = this.localStream;

    if (!this.isVideoEnabled) {
      document.getElementById('local-no-video').classList.remove('hidden');
    }
    if (!this.isAudioEnabled) {
      document.getElementById('local-mic-status').classList.add('muted');
      document.getElementById('local-mic-status').querySelector('.material-icons').textContent = 'mic_off';
    }
  }

  connectSocket() {
    this.socket = io({
      path: appPath('/socket.io'),
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      this.socket.emit('join-room', { roomId: this.roomId, userName: this.userName });
      setTimeout(() => {
        if (!this.isRecording) this.startRecording();
      }, 2000);
    });

    this.socket.on('room-users', (users) => {
      users.forEach(user => this.createPeerConnection(user.id, user.name, true));
    });

    this.socket.on('user-joined', (user) => {
      this.createPeerConnection(user.id, user.name, false);
      this.showToast(`${user.name} joined the meeting`);
      this.updateParticipantsList();
      this.adjustStreamQuality();
    });

    this.socket.on('offer', async ({ from, offer, userName }) => {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        this.socket.emit('answer', { to: from, answer });
      }
    });

    this.socket.on('answer', async ({ from, answer }) => {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    this.socket.on('ice-candidate', ({ from, candidate }) => {
      const peer = this.peers.get(from);
      if (peer && candidate) {
        peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    this.socket.on('user-left', ({ userId }) => {
      this.removePeer(userId);
      this.updateParticipantsList();
    });

    this.socket.on('chat-message', (msg) => {
      this.addChatMessage(msg);
    });

    this.socket.on('user-toggle-media', ({ userId, type, enabled }) => {
      const peer = this.peers.get(userId);
      if (!peer) return;

      if (type === 'video') {
        const noVideo = peer.tile.querySelector('.no-video-overlay');
        noVideo.classList.toggle('hidden', enabled);
      } else if (type === 'audio') {
        const micStatus = peer.tile.querySelector('.tile-mic-status');
        micStatus.classList.toggle('muted', !enabled);
        micStatus.querySelector('.material-icons').textContent = enabled ? 'mic' : 'mic_off';
      }
    });
  }

  async createPeerConnection(userId, userName, initiator) {
    const connection = new RTCPeerConnection(this.iceServers);
    const tile = this.createVideoTile(userId, userName);

    this.peers.set(userId, { connection, userName, tile });

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        connection.addTrack(track, this.localStream);
      });
    }

    if (!connection.getSenders().some(s => s.track?.kind === 'video')) {
      connection.addTransceiver('video', { direction: 'sendonly' });
    }

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', { to: userId, candidate: event.candidate });
      }
    };

    connection.ontrack = (event) => {
      const video = tile.querySelector('video');
      if (video.srcObject !== event.streams[0]) {
        video.srcObject = event.streams[0];
      }
    };

    connection.oniceconnectionstatechange = () => {
      if (connection.iceConnectionState === 'disconnected' || connection.iceConnectionState === 'failed') {
        this.removePeer(userId);
      }
    };

    if (initiator) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      this.socket.emit('offer', { to: userId, offer });
    }

    this.updateGridLayout();
    this.updateParticipantsList();
    this.adjustStreamQuality();
  }

  adjustStreamQuality() {
    const count = this.peers.size + 1;
    let maxBitrate = 1500000;
    if (count > 4) maxBitrate = 800000;
    if (count > 8) maxBitrate = 400000;

    this.peers.forEach(peer => {
      peer.connection.getSenders().forEach(sender => {
        if (sender.track?.kind !== 'video') return;
        try {
          const params = sender.getParameters();
          if (!params.encodings?.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = maxBitrate;
          sender.setParameters(params);
        } catch (e) { /* ignore */ }
      });
    });
  }

  createVideoTile(userId, userName) {
    const tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${userId}`;
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="no-video-overlay hidden">
        <div class="avatar-circle">${userName[0]}</div>
      </div>
      <div class="tile-name"><span>${userName}</span></div>
      <div class="tile-mic-status"><span class="material-icons">mic</span></div>
    `;
    document.getElementById('video-grid').appendChild(tile);
    return tile;
  }

  removePeer(userId) {
    const peer = this.peers.get(userId);
    if (peer) {
      peer.connection.close();
      peer.tile.remove();
      this.peers.delete(userId);
      this.showToast(`${peer.userName} left the meeting`);
      this.updateGridLayout();
      this.adjustStreamQuality();
    }
  }

  updateGridLayout() {
    const grid = document.getElementById('video-grid');
    const count = grid.children.length;

    grid.className = 'video-grid';
    if (count === 2) grid.classList.add('grid-2');
    else if (count === 3) grid.classList.add('grid-3');
    else if (count === 4) grid.classList.add('grid-4');
    else if (count <= 6) grid.classList.add('grid-6');
    else if (count > 6) grid.classList.add('grid-many');
  }

  // Meeting Controls
  bindMeetingEvents() {
    document.getElementById('btn-toggle-mic').addEventListener('click', (e) => {
      this.isAudioEnabled = !this.isAudioEnabled;
      const btn = e.currentTarget;
      btn.querySelector('.material-icons').textContent = this.isAudioEnabled ? 'mic' : 'mic_off';
      btn.classList.toggle('muted', !this.isAudioEnabled);

      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => t.enabled = this.isAudioEnabled);
      }

      const micStatus = document.getElementById('local-mic-status');
      micStatus.classList.toggle('muted', !this.isAudioEnabled);
      micStatus.querySelector('.material-icons').textContent = this.isAudioEnabled ? 'mic' : 'mic_off';

      this.socket?.emit('toggle-media', { roomId: this.roomId, type: 'audio', enabled: this.isAudioEnabled });
    });

    document.getElementById('btn-toggle-camera').addEventListener('click', (e) => {
      this.isVideoEnabled = !this.isVideoEnabled;
      const btn = e.currentTarget;
      btn.querySelector('.material-icons').textContent = this.isVideoEnabled ? 'videocam' : 'videocam_off';
      btn.classList.toggle('muted', !this.isVideoEnabled);
      btn.title = this.isVideoEnabled ? 'Turn off camera' : 'Turn on camera';

      if (this.localStream) {
        this.localStream.getVideoTracks().forEach(t => { t.enabled = this.isVideoEnabled; });
      }

      document.getElementById('local-no-video').classList.toggle('hidden', this.isVideoEnabled);
      this.socket?.emit('toggle-media', { roomId: this.roomId, type: 'video', enabled: this.isVideoEnabled });
    });

    document.getElementById('btn-screen-share').addEventListener('click', () => this.toggleScreenShare());
    document.getElementById('btn-record').addEventListener('click', () => this.toggleRecording());
    document.getElementById('btn-end-call').addEventListener('click', () => this.endCall());

    // Chat
    document.getElementById('btn-toggle-chat').addEventListener('click', () => this.togglePanel('chat'));
    document.getElementById('btn-toggle-participants').addEventListener('click', () => this.togglePanel('participants'));
    document.getElementById('btn-close-panel').addEventListener('click', () => this.closePanel());

    document.getElementById('btn-send-chat').addEventListener('click', () => this.sendChatMessage());
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });
  }

  async getDisplayMediaStream() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing is not supported in this browser');
    }

    const attempts = [
      { video: true, audio: false },
      { video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } }, audio: false }
    ];

    let lastError;
    for (const options of attempts) {
      try {
        return await navigator.mediaDevices.getDisplayMedia(options);
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'AbortError') throw err;
        lastError = err;
        console.warn('getDisplayMedia attempt failed:', err.name, err.message);
      }
    }
    throw lastError || new Error('Could not access screen');
  }

  async sendScreenTrackToPeers(screenTrack) {
    const updates = [];

    this.peers.forEach((peer, userId) => {
      updates.push((async () => {
        let sender = peer.connection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
        } else {
          peer.connection.addTrack(screenTrack, this.screenStream);
          const offer = await peer.connection.createOffer();
          await peer.connection.setLocalDescription(offer);
          this.socket.emit('offer', { to: userId, offer });
        }
      })());
    });

    await Promise.all(updates);
  }

  async toggleScreenShare() {
    const btn = document.getElementById('btn-screen-share');

    if (this.isScreenSharing) {
      this.stopScreenShare();
      return;
    }

    try {
      this.screenStream = await this.getDisplayMediaStream();
      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error('No screen video track received');

      await this.sendScreenTrackToPeers(screenTrack);

      const screenCapture = document.getElementById('local-screen-capture');
      screenCapture.srcObject = this.screenStream;

      document.getElementById('local-screen-share-overlay').classList.remove('hidden');
      if (this.localStream) {
        document.getElementById('local-video').srcObject = this.localStream;
      }

      this.isScreenSharing = true;
      btn.classList.add('sharing');
      this.socket.emit('screen-share-started', { roomId: this.roomId });

      const surfaceLabels = { monitor: 'entire screen', window: 'window', browser: 'tab' };
      const surface = screenTrack.getSettings().displaySurface;
      this.showToast(`Sharing ${surfaceLabels[surface] || 'screen'}`);

      screenTrack.onended = () => this.stopScreenShare();
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') return;
      console.error('Screen share failed:', err);
      this.showToast(`Screen share failed: ${err.message || 'Unknown error'}`);
    }
  }

  async stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }

    const screenCapture = document.getElementById('local-screen-capture');
    screenCapture.srcObject = null;

    const videoTrack = this.localStream?.getVideoTracks()[0];
    const restorePromises = [];

    if (videoTrack) {
      this.peers.forEach((peer, userId) => {
        restorePromises.push((async () => {
          const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(videoTrack);
          }
        })());
      });
    }

    await Promise.all(restorePromises);

    document.getElementById('local-screen-share-overlay').classList.add('hidden');
    document.getElementById('local-video').srcObject = this.localStream;
    this.isScreenSharing = false;
    document.getElementById('btn-screen-share').classList.remove('sharing');
    this.socket?.emit('screen-share-stopped', { roomId: this.roomId });
  }

  // Recording
  async toggleRecording() {
    if (this.isRecording) {
      this.showToast('This meeting is fully recorded and cannot be stopped');
      return;
    }
    await this.startRecording();
  }

  async startRecording() {
    try {
      this.recordedChunks = [];

      // Create a canvas to composite all video streams
      this.recordingCanvas = document.createElement('canvas');
      this.recordingCanvas.width = 1280;
      this.recordingCanvas.height = 720;
      this.recordingCtx = this.recordingCanvas.getContext('2d');

      // Create audio context to mix all audio streams
      const audioContext = new AudioContext();
      const audioDestination = audioContext.createMediaStreamDestination();
      this.audioContext = audioContext;

      // Add local audio
      if (this.localStream && this.localStream.getAudioTracks().length > 0) {
        const localAudioSource = audioContext.createMediaStreamSource(this.localStream);
        localAudioSource.connect(audioDestination);
      }

      // Add remote audio streams
      this.peers.forEach(peer => {
        const video = peer.tile.querySelector('video');
        if (video && video.srcObject) {
          const audioTracks = video.srcObject.getAudioTracks();
          if (audioTracks.length > 0) {
            const remoteSource = audioContext.createMediaStreamSource(video.srcObject);
            remoteSource.connect(audioDestination);
          }
        }
      });

      // Draw video frames to canvas
      this.drawRecordingFrame();

      // Combine canvas video stream with mixed audio
      const canvasStream = this.recordingCanvas.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);

      this.mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: this.getSupportedMimeType(),
        videoBitsPerSecond: 2500000
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this._recordingStopResolve?.();
      };

      this.mediaRecorder.start(1000);
      this.isRecording = true;

      document.getElementById('btn-record').classList.add('recording');
      document.getElementById('btn-record').title = 'Recording in progress';
      document.getElementById('recording-indicator').classList.remove('hidden');

      this.showToast('Meeting recording started');

    } catch (err) {
      console.error('Failed to start recording:', err);
      this.showToast('Failed to start recording');
    }
  }

  drawRecordingFrame() {
    const ctx = this.recordingCtx;
    const canvas = this.recordingCanvas;
    const videos = [];

    // Collect all video elements for recording
    if (this.isScreenSharing) {
      const screenCapture = document.getElementById('local-screen-capture');
      if (screenCapture?.srcObject) videos.push(screenCapture);
    } else {
      const localVideo = document.getElementById('local-video');
      if (localVideo?.srcObject) videos.push(localVideo);
    }

    this.peers.forEach(peer => {
      const video = peer.tile.querySelector('video');
      if (video && video.srcObject) {
        videos.push(video);
      }
    });

    // Clear canvas
    ctx.fillStyle = '#202124';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (videos.length === 0) {
      this.recordingAnimFrame = requestAnimationFrame(() => this.drawRecordingFrame());
      return;
    }

    // Calculate grid layout
    const cols = videos.length <= 1 ? 1 : videos.length <= 4 ? 2 : 3;
    const rows = Math.ceil(videos.length / cols);
    const tileW = canvas.width / cols;
    const tileH = canvas.height / rows;
    const padding = 4;

    videos.forEach((video, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * tileW + padding;
      const y = row * tileH + padding;
      const w = tileW - padding * 2;
      const h = tileH - padding * 2;
      const isLocal = video.id === 'local-screen-capture' || video.id === 'local-video';
      const showAvatar = isLocal && !this.isScreenSharing && !this.isVideoEnabled;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.clip();

      if (showAvatar) {
        ctx.fillStyle = '#171717';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#1a73e8';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.userName[0].toUpperCase(), x + w / 2, y + h / 2);
      } else {
        try {
          ctx.drawImage(video, x, y, w, h);
        } catch (e) {
          ctx.fillStyle = '#171717';
          ctx.fillRect(x, y, w, h);
        }
      }

      ctx.restore();
    });

    // Add timestamp overlay
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(canvas.width - 160, canvas.height - 30, 155, 25);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width - 150, canvas.height - 12);

    this.recordingAnimFrame = requestAnimationFrame(() => this.drawRecordingFrame());
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve();
        return;
      }

      this._recordingStopResolve = resolve;

      if (this.recordingAnimFrame) {
        cancelAnimationFrame(this.recordingAnimFrame);
        this.recordingAnimFrame = null;
      }

      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }

      this.isRecording = false;
      document.getElementById('btn-record').classList.remove('recording');
      document.getElementById('btn-record').title = 'Record meeting';
      document.getElementById('recording-indicator').classList.add('hidden');

      this.mediaRecorder.stop();
    });
  }

  async saveRecording() {
    const mimeType = this.getSupportedMimeType();
    const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
    const blob = new Blob(this.recordedChunks, { type: mimeType });

    if (blob.size === 0) {
      this.recordedChunks = [];
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `meeting-${this.roomId}-${timestamp}.${ext}`;

    try {
      const formData = new FormData();
      formData.append('recording', blob, filename);
      formData.append('roomId', this.roomId);
      formData.append('recordedBy', this.userName);

      const res = await fetch(appPath('/api/recordings/stage'), {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Upload failed');
      }

      this.showToast('Recording saved on server');
    } catch (err) {
      console.error('Failed to stage recording:', err);
      this.showToast('Failed to save recording on server');
    }

    this.recordedChunks = [];
  }

  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
  }

  async endCall() {
    if (this.isRecording) {
      await this.stopRecording();
      await this.saveRecording();
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    this.isScreenSharing = false;
    const shareBtn = document.getElementById('btn-screen-share');
    shareBtn.classList.remove('sharing');
    document.getElementById('local-screen-share-overlay').classList.add('hidden');
    document.getElementById('local-screen-capture').srcObject = null;

    this.peers.forEach((peer, userId) => {
      peer.connection.close();
      peer.tile.remove();
    });
    this.peers.clear();
    this.stopLocalStream();
    this.socket?.disconnect();
    this.stopTimer();

    this.switchPage('landing-page');
    window.history.pushState({}, '', appPath('/'));
  }

  // Chat & Participants
  togglePanel(type) {
    const panel = document.getElementById('side-panel');
    const chatPanel = document.getElementById('chat-panel');
    const participantsPanel = document.getElementById('participants-panel');
    const title = document.getElementById('panel-title');

    if (!panel.classList.contains('hidden') && 
        ((type === 'chat' && chatPanel.classList.contains('active')) ||
         (type === 'participants' && participantsPanel.classList.contains('active')))) {
      this.closePanel();
      return;
    }

    panel.classList.remove('hidden');

    if (type === 'chat') {
      chatPanel.classList.add('active');
      participantsPanel.classList.remove('active');
      title.textContent = 'In-call messages';
      document.getElementById('chat-input').focus();
    } else {
      participantsPanel.classList.add('active');
      chatPanel.classList.remove('active');
      title.textContent = `People (${this.peers.size + 1})`;
      this.updateParticipantsList();
    }

    this.updateGridLayout();
  }

  closePanel() {
    document.getElementById('side-panel').classList.add('hidden');
    this.updateGridLayout();
  }

  sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    this.socket.emit('chat-message', {
      roomId: this.roomId,
      message,
      userName: this.userName
    });
    input.value = '';
  }

  addChatMessage({ userName, message, timestamp }) {
    const container = document.getElementById('chat-messages');
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const el = document.createElement('div');
    el.className = 'chat-message';
    el.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-message-name">${userName}</span>
        <span class="chat-message-time">${time}</span>
      </div>
      <div class="chat-message-text">${this.escapeHtml(message)}</div>
    `;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  updateParticipantsList() {
    const list = document.getElementById('participants-list');
    list.innerHTML = `
      <div class="participant-item">
        <div class="participant-avatar">${this.userName[0]}</div>
        <span class="participant-name">${this.userName} (You)</span>
      </div>
    `;

    this.peers.forEach(peer => {
      const el = document.createElement('div');
      el.className = 'participant-item';
      el.innerHTML = `
        <div class="participant-avatar">${peer.userName[0]}</div>
        <span class="participant-name">${peer.userName}</span>
      `;
      list.appendChild(el);
    });

    const title = document.getElementById('panel-title');
    if (document.getElementById('participants-panel').classList.contains('active')) {
      title.textContent = `People (${this.peers.size + 1})`;
    }
  }

  // Utilities
  switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
  }

  stopLocalStream() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
  }

  startTimer() {
    this.meetingStartTime = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - this.meetingStartTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      document.getElementById('meeting-timer').textContent = 
        `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Schedule Page
  bindScheduleEvents() {
    document.getElementById('schedule-logo-home').addEventListener('click', () => {
      this.switchPage('landing-page');
      window.history.pushState({}, '', appPath('/'));
    });

    document.getElementById('schedule-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.scheduleMeeting();
    });

    document.getElementById('btn-refresh-meetings').addEventListener('click', () => {
      this.loadMeetings();
    });

    // Set default date to now + 1 hour
    const dateInput = document.getElementById('meeting-date');
    const now = new Date();
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
    dateInput.value = now.toISOString().slice(0, 16);
  }

  async scheduleMeeting() {
    const title = document.getElementById('meeting-title').value.trim();
    const description = document.getElementById('meeting-description').value.trim();
    const scheduledTime = new Date(document.getElementById('meeting-date').value).getTime();
    const duration = parseInt(document.getElementById('meeting-duration').value);
    const hostName = document.getElementById('host-name').value.trim();

    if (!title || !scheduledTime || !hostName) return;

    const res = await fetch(appPath('/api/meetings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, scheduledTime, duration, hostName })
    });

    const data = await res.json();
    if (data.success) {
      this.showToast(`Meeting scheduled! Session ID: ${data.meeting.sessionId}`);
      document.getElementById('schedule-form').reset();
      // Reset date
      const now = new Date();
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
      document.getElementById('meeting-date').value = now.toISOString().slice(0, 16);
      this.loadMeetings();
    }
  }

  async loadMeetings() {
    const res = await fetch(appPath('/api/meetings'));
    const data = await res.json();
    this.renderMeetingsList(data.meetings);
  }

  renderMeetingsList(meetings) {
    const container = document.getElementById('meetings-list');

    if (!meetings || meetings.length === 0) {
      container.innerHTML = `
        <div class="meetings-empty">
          <span class="material-icons">event_available</span>
          <p>No meetings scheduled yet</p>
        </div>
      `;
      return;
    }

    container.innerHTML = meetings.map(m => {
      const date = new Date(m.scheduledTime);
      const dateStr = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const statusClass = m.status === 'active' ? 'active' : 'scheduled';

      return `
        <div class="meeting-item" data-session-id="${m.sessionId}">
          <div class="meeting-item-header">
            <span class="meeting-item-title">${this.escapeHtml(m.title)}</span>
            <span class="meeting-item-status ${statusClass}">${m.status}</span>
          </div>
          ${m.description ? `<div style="font-size:13px;color:var(--text-secondary)">${this.escapeHtml(m.description)}</div>` : ''}
          <div class="meeting-item-meta">
            <span><span class="material-icons">schedule</span>${dateStr}, ${timeStr}</span>
            <span><span class="material-icons">timelapse</span>${m.duration} min</span>
            <span><span class="material-icons">person</span>${this.escapeHtml(m.hostName)}</span>
            ${m.participantCount > 0 ? `<span><span class="material-icons">group</span>${m.participantCount} in call</span>` : ''}
          </div>
          <div class="meeting-item-session">${m.sessionId}</div>
          <div class="meeting-item-actions">
            <button class="btn btn-primary btn-small" onclick="app.joinScheduledMeeting('${m.sessionId}')">
              <span class="material-icons" style="font-size:14px">videocam</span> Join
            </button>
            <button class="btn btn-copy btn-small" onclick="app.copySessionId('${m.sessionId}')">
              <span class="material-icons" style="font-size:14px">content_copy</span> Copy Link
            </button>
            <button class="btn btn-danger btn-small" onclick="app.deleteMeeting('${m.sessionId}')">
              <span class="material-icons" style="font-size:14px">delete</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  joinScheduledMeeting(sessionId) {
    this.roomId = sessionId;
    window.history.pushState({}, '', appPath(`/${sessionId}`));
    this.showPreview();
  }

  copySessionId(sessionId) {
    const url = `${window.location.origin}${appPath(`/${sessionId}`)}`;
    navigator.clipboard.writeText(url).then(() => {
      this.showToast('Meeting link copied to clipboard!');
    }).catch(() => {
      this.showToast(`Session ID: ${sessionId}`);
    });
  }

  async deleteMeeting(sessionId) {
    const res = await fetch(appPath(`/api/meetings/${sessionId}`), { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      this.showToast('Meeting deleted');
      this.loadMeetings();
    }
  }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new VideoMeetApp();
});
