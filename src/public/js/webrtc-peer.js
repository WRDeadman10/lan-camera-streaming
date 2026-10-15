/**
 * @file webrtc-peer.js
 * Browser WebRTC peer connection manager handling RTCPeerConnection lifecycle,
 * ICE candidates, stats collection, and stream attachment.
 */

import { getRecommendedBitrateHints, isQualityMode, mungeVideoBitrate } from './sdp-bitrate.js';

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
    this.degradationPreference = null;
    this.qualityCeilingBps = null;
    this.qualityMode = 'fps';
    this.graceTimer = null;
    this.graceStarted = false;
    this.lastAppliedParams = null;
    this.seedBitrate = config.seedBitrate !== false;
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

  async createOffer({ withAudio = true } = {}) {
    if (!this.peerConnection) {
      this.createPeerConnection();
    }
    const offer = await this.peerConnection.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: Boolean(withAudio)
    });
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  /**
   * Puts one video codec first in this peer's offer while keeping every other codec after it, so a viewer that
   * cannot decode the preferred codec still negotiates the next one. Must run before createOffer().
   */
  preferVideoCodec(mimeType) {
    if (!this.peerConnection || typeof RTCRtpSender === 'undefined' || typeof RTCRtpSender.getCapabilities !== 'function') {
      return false;
    }
    const capabilities = RTCRtpSender.getCapabilities('video');
    if (!capabilities || !Array.isArray(capabilities.codecs)) {
      return false;
    }
    const wanted = mimeType.toLowerCase();
    const preferred = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === wanted);
    if (preferred.length === 0) {
      return false;
    }
    const others = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== wanted);
    const transceiver = this.peerConnection.getTransceivers().find((t) => t.sender && t.sender.track && t.sender.track.kind === 'video');
    if (!transceiver || typeof transceiver.setCodecPreferences !== 'function') {
      return false;
    }
    try {
      transceiver.setCodecPreferences([...preferred, ...others]);
      return true;
    } catch (err) {
      console.warn('Failed to set codec preferences:', err);
      return false;
    }
  }

  /**
   * Chooses what this peer's encoder protects when CPU or bandwidth runs short and applies the matching bitrate ceiling.
   * 'fps' keeps 30 FPS and lets resolution drop, 'resolution' keeps the resolution, 'both' asks for no adaptation at all
   * ('maintain-framerate-and-resolution', falling back to 'maintain-resolution' on browsers that reject it).
   * 'fps' holds resolution for a grace period first (see sdp-bitrate.js); pass armGrace after connecting, after a source
   * switch, or when the viewer changes mode. Returns the accepted degradationPreference or null.
   */
  async applyQualityPriority(mode, { armGrace = false } = {}) {
    const resolvedMode = isQualityMode(mode) ? mode : 'fps';
    const hints = getRecommendedBitrateHints(resolvedMode);
    this.qualityMode = resolvedMode;
    this.qualityCeilingBps = hints.encodingMaxBitrateBps;

    if (hints.degradation.graceMs <= 0) {
      this._clearGraceTimer();
      this.graceStarted = false;
    } else if (armGrace) {
      this._clearGraceTimer();
      this.graceStarted = true;
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        this._applyPreferenceChain(hints.degradation.afterGrace).catch((err) => {
          console.warn('Failed to leave the resolution grace period:', err);
        });
      }, hints.degradation.graceMs);
    }

    const waitingForGrace = hints.degradation.graceMs > 0 && (this.graceTimer !== null || !this.graceStarted);
    return this._applyPreferenceChain(waitingForGrace ? hints.degradation.duringGrace : hints.degradation.afterGrace);
  }

  isInGracePeriod() {
    return this.graceTimer !== null;
  }

  async applyBitrateLimit(maxBitrateBps, scaleResolutionDownBy = 1.0) {
    return this._setSendParameters({ maxBitrateBps, scaleResolutionDownBy, preference: null });
  }

  _clearGraceTimer() {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  async _applyPreferenceChain(preferences) {
    for (const preference of preferences) {
      const applied = await this._setSendParameters({
        maxBitrateBps: this.qualityCeilingBps,
        scaleResolutionDownBy: 1.0,
        preference
      });
      if (applied) {
        return preference;
      }
    }
    return null;
  }

  _getVideoSender() {
    if (!this.peerConnection) {
      return null;
    }
    return this.peerConnection.getSenders().find((s) => s.track && s.track.kind === 'video') || null;
  }

  // degradationPreference is only remembered after setParameters succeeded, so a rejected value never lingers in this state.
  async _setSendParameters({ maxBitrateBps, scaleResolutionDownBy, preference }) {
    try {
      const videoSender = this._getVideoSender();
      if (!videoSender || !videoSender.getParameters) {
        return false;
      }
      const nextPreference = preference || this.degradationPreference;
      const scale = scaleResolutionDownBy && scaleResolutionDownBy > 1.0 ? scaleResolutionDownBy : 1.0;
      const last = this.lastAppliedParams;
      if (last && last.maxBitrateBps === maxBitrateBps && last.scale === scale && last.preference === nextPreference) {
        return true;
      }
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      if (maxBitrateBps && maxBitrateBps > 0) {
        params.encodings[0].maxBitrate = maxBitrateBps;
      } else {
        delete params.encodings[0].maxBitrate;
      }
      if (scale > 1.0) {
        params.encodings[0].scaleResolutionDownBy = scale;
      } else {
        delete params.encodings[0].scaleResolutionDownBy;
      }
      if (nextPreference) {
        params.degradationPreference = nextPreference;
      }
      await videoSender.setParameters(params);
      this.degradationPreference = nextPreference || null;
      this.lastAppliedParams = { maxBitrateBps, scale, preference: nextPreference };
      return true;
    } catch (err) {
      console.warn('Failed to apply sender parameters:', err);
      return false;
    }
  }

  /** What Chrome actually holds for the video sender right now (for the diagnostics log). */
  getSenderDiagnostics() {
    const videoSender = this._getVideoSender();
    if (!videoSender) {
      return null;
    }
    const params = videoSender.getParameters ? videoSender.getParameters() : {};
    const encoding = params.encodings && params.encodings[0] ? params.encodings[0] : {};
    const track = videoSender.track;
    const settings = track && track.getSettings ? track.getSettings() : {};
    return {
      maxBitrate: encoding.maxBitrate || null,
      scaleResolutionDownBy: encoding.scaleResolutionDownBy || 1,
      active: encoding.active !== false,
      degradationPreference: params.degradationPreference || null,
      trackWidth: settings.width || null,
      trackHeight: settings.height || null,
      trackFrameRate: settings.frameRate || null,
      contentHint: track ? track.contentHint || '' : '',
      graceActive: this.isInGracePeriod(),
      qualityMode: this.qualityMode
    };
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
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(this._withBitrateHints(answer)));
    this.hasRemoteDescription = true;
    await this._flushQueuedCandidates();
  }

  // Chrome reads x-google-start-bitrate for the sender's own stream only from the remote description, i.e. this answer.
  _withBitrateHints(answer) {
    if (!this.seedBitrate || !answer || typeof answer.sdp !== 'string') {
      return answer;
    }
    try {
      const hints = getRecommendedBitrateHints(this.qualityMode);
      return { type: answer.type, sdp: mungeVideoBitrate(answer.sdp, hints.sdp) };
    } catch (err) {
      console.warn('Could not add bitrate hints to the answer; using it unchanged:', err);
      return answer;
    }
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
        rawRttMs: null,
        packetsLost: null,
        bytesReceived: null,
        bytesSent: null,
        framesPerSecond: null,
        frameWidth: null,
        frameHeight: null,
        qualityLimitationReason: null,
        encoderImplementation: null,
        codec: null,
        powerEfficientEncoder: null,
        framesEncoded: null,
        targetBitrate: null,
        availableOutgoingBitrate: null,
        qualityLimitationDurations: null,
        qualityLimitationResolutionChanges: null,
        contentType: null,
        totalEncodeTime: null,
        framesSent: null,
        sourceFramesPerSecond: null,
        sourceWidth: null,
        sourceHeight: null
      };

      let hasSelectedPair = false;
      stats.forEach((stat) => {
        const isSelectedPair = stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated === true;
        const isUsablePair = stat.type === 'candidate-pair' && (stat.state === 'succeeded' || stat.nominated === true);
        if (isSelectedPair || (isUsablePair && !hasSelectedPair)) {
          hasSelectedPair = hasSelectedPair || isSelectedPair;
          report.rawRttMs = stat.currentRoundTripTime ? Math.round(stat.currentRoundTripTime * 1000) : null;
          report.availableOutgoingBitrate = typeof stat.availableOutgoingBitrate === 'number' ? stat.availableOutgoingBitrate : null;
          report.rtt = report.rawRttMs !== null ? report.rawRttMs + ' ms' : null;
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

        if (stat.type === 'media-source' && stat.kind === 'video') {
          report.sourceFramesPerSecond = typeof stat.framesPerSecond === 'number' ? stat.framesPerSecond : null;
          report.sourceWidth = stat.width || null;
          report.sourceHeight = stat.height || null;
        }

        if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
          report.bytesSent = stat.bytesSent;
          report.framesPerSecond = stat.framesPerSecond;
          report.frameWidth = stat.frameWidth;
          report.frameHeight = stat.frameHeight;
          report.qualityLimitationReason = stat.qualityLimitationReason || null;
          report.encoderImplementation = stat.encoderImplementation || null;
          report.powerEfficientEncoder = typeof stat.powerEfficientEncoder === 'boolean' ? stat.powerEfficientEncoder : null;
          report.framesEncoded = stat.framesEncoded || 0;
          report.framesSent = stat.framesSent || 0;
          report.targetBitrate = typeof stat.targetBitrate === 'number' ? stat.targetBitrate : null;
          report.qualityLimitationDurations = stat.qualityLimitationDurations || null;
          report.qualityLimitationResolutionChanges = typeof stat.qualityLimitationResolutionChanges === 'number' ? stat.qualityLimitationResolutionChanges : null;
          report.contentType = stat.contentType || null;
          report.totalEncodeTime = typeof stat.totalEncodeTime === 'number' ? stat.totalEncodeTime : null;
          const codecStat = stat.codecId ? stats.get(stat.codecId) : null;
          report.codec = codecStat && codecStat.mimeType ? codecStat.mimeType.replace('video/', '') : null;
        }
      });

      return report;
    } catch (err) {
      return null;
    }
  }

  close() {
    this._clearGraceTimer();
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

