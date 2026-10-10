/**
 * @file webrtc-peer.js
 * Browser WebRTC peer connection manager handling RTCPeerConnection lifecycle,
 * ICE candidates, stats collection, and stream attachment.
 */

export function isPrivateAddress(address) {
  if (!address) {
    return false;
  }
  const host = address.toLowerCase();
  if (host.endsWith('.local')) {
    return true;
  }
  if (host.includes(':')) {
    return host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd');
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!match) {
    return false;
  }
  const first = parseInt(match[1], 10);
  const second = parseInt(match[2], 10);
  return first === 10 || first === 127 || (first === 169 && second === 254) || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

export function classifyPath(localType, localIp, remoteType, remoteIp) {
  if (localType === 'relay' || remoteType === 'relay') {
    return 'relay';
  }
  if (localType === 'srflx' || remoteType === 'srflx') {
    return 'internet';
  }
  const localIsLan = !localIp || isPrivateAddress(localIp);
  const remoteIsLan = !remoteIp || isPrivateAddress(remoteIp);
  return localIsLan && remoteIsLan ? 'lan' : 'internet';
}

export class WebRtcPeer {
  constructor(config = {}) {
    this.iceServers = config.iceServers || [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ];
    this.peerConnection = null;
    this.onIceCandidate = config.onIceCandidate || (() => {});
    this.onIceCandidateError = config.onIceCandidateError || (() => {});
    this.onIceGatheringStateChange = config.onIceGatheringStateChange || (() => {});
    this.onSignalingStateChange = config.onSignalingStateChange || (() => {});
    this.onTrack = config.onTrack || (() => {});
    this.onConnectionStateChange = config.onConnectionStateChange || (() => {});
    this.onIceConnectionStateChange = config.onIceConnectionStateChange || (() => {});
    this.queuedIceCandidates = [];
    this.hasRemoteDescription = false;
  }

  createPeerConnection() {
    this.close();

    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle'
    });

    this.peerConnection.onicecandidate = (event) => {
      this.onIceCandidate(event.candidate);
    };

    this.peerConnection.onicecandidateerror = (event) => {
      this.onIceCandidateError(event);
    };

    this.peerConnection.onicegatheringstatechange = () => {
      if (this.peerConnection) {
        this.onIceGatheringStateChange(this.peerConnection.iceGatheringState);
      }
    };

    this.peerConnection.onsignalingstatechange = () => {
      if (this.peerConnection) {
        this.onSignalingStateChange(this.peerConnection.signalingState);
      }
    };

    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.onTrack(event.streams[0]);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (this.peerConnection) {
        this.onConnectionStateChange(this.peerConnection.connectionState);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      if (this.peerConnection) {
        this.onIceConnectionStateChange(this.peerConnection.iceConnectionState);
      }
    };

    return this.peerConnection;
  }

  addTrack(track, stream) {
    if (!this.peerConnection) {
      throw new Error('RTCPeerConnection not initialized.');
    }
    return this.peerConnection.addTrack(track, stream);
  }

  async createOffer() {
    if (!this.peerConnection) {
      this.createPeerConnection();
    }
    const offer = await this.peerConnection.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false
    });
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(offer) {
    if (!this.peerConnection) {
      this.createPeerConnection();
    }
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    this.hasRemoteDescription = true;
    await this._flushQueuedCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(answer) {
    if (!this.peerConnection) {
      throw new Error('Cannot set remote answer without peer connection.');
    }
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    this.hasRemoteDescription = true;
    await this._flushQueuedCandidates();
  }

  async addIceCandidate(candidateInit) {
    if (!candidateInit) {
      return;
    }

    if (!this.hasRemoteDescription || !this.peerConnection || !this.peerConnection.remoteDescription) {
      this.queuedIceCandidates.push(candidateInit);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (err) {
      console.warn('Failed to add received ICE candidate:', err);
    }
  }

  async _flushQueuedCandidates() {
    while (this.queuedIceCandidates.length > 0) {
      const cand = this.queuedIceCandidates.shift();
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('Failed to add queued ICE candidate:', err);
      }
    }
  }

  async getStatsReport() {
    if (!this.peerConnection) {
      return null;
    }
    try {
      const stats = await this.peerConnection.getStats();
      const report = {
        candidatePairType: null,
        localCandidateType: null,
        remoteCandidateType: null,
        localAddress: null,
        remoteAddress: null,
        pathKind: null,
        protocol: null,
        rtt: null,
        bytesReceived: null,
        bytesSent: null,
        framesPerSecond: null,
        frameWidth: null,
        frameHeight: null
      };

      let hasSelectedPair = false;
      stats.forEach((stat) => {
        const isSelectedPair = stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated === true;
        const isUsablePair = stat.type === 'candidate-pair' && (stat.state === 'succeeded' || stat.nominated === true);
        if (isSelectedPair || (isUsablePair && !hasSelectedPair)) {
          hasSelectedPair = hasSelectedPair || isSelectedPair;
          report.rtt = stat.currentRoundTripTime ? Math.round(stat.currentRoundTripTime * 1000) + ' ms' : null;
          const localCand = stats.get(stat.localCandidateId);
          const remoteCand = stats.get(stat.remoteCandidateId);
          let localIp = null;
          let remoteIp = null;
          if (localCand) {
            localIp = localCand.ip || localCand.address || null;
            report.localCandidateType = localCand.candidateType;
            report.localAddress = (localIp || '?') + ':' + (localCand.port || '?');
            report.protocol = localCand.protocol ? localCand.protocol.toUpperCase() : null;
          }
          if (remoteCand) {
            remoteIp = remoteCand.ip || remoteCand.address || null;
            report.remoteCandidateType = remoteCand.candidateType;
            report.remoteAddress = (remoteIp || '?') + ':' + (remoteCand.port || '?');
          }
          if (localCand && remoteCand) {
            report.pathKind = classifyPath(report.localCandidateType, localIp, report.remoteCandidateType, remoteIp);
          }
        }

        if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
          report.bytesReceived = stat.bytesReceived;
          report.framesPerSecond = stat.framesPerSecond;
          report.frameWidth = stat.frameWidth;
          report.frameHeight = stat.frameHeight;
        }

        if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
          report.bytesSent = stat.bytesSent;
          report.framesPerSecond = stat.framesPerSecond;
          report.frameWidth = stat.frameWidth;
          report.frameHeight = stat.frameHeight;
        }
      });

      return report;
    } catch (err) {
      return null;
    }
  }

  close() {
    if (this.peerConnection) {
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.onicecandidateerror = null;
      this.peerConnection.onicegatheringstatechange = null;
      this.peerConnection.onsignalingstatechange = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.hasRemoteDescription = false;
    this.queuedIceCandidates = [];
  }
}

