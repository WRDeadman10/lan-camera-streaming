/**
 * @file sdp-bitrate.js
 * Pure SDP helpers that add Chrome's x-google-start/min/max-bitrate codec parameters (kbps) to the active video
 * m-sections of an SDP, plus the per-mode bitrate and degradation hints the sender uses.
 *
 * Measured on Chrome 155 (see docs/decisions.md ADR-029):
 *  - Apply it to the ANSWER the sender receives, right before setRemoteDescription(answer). Chrome reads these parameters for
 *    the sender's own stream only from the sender's REMOTE description; munging the sender's own offer has no effect.
 *  - x-google-start-bitrate seeds the initial bandwidth estimate (default 300 kbps), which avoids the early quality-scaler
 *    downscale. x-google-max-bitrate only matters when encodings[0].maxBitrate is not set. x-google-min-bitrate had no
 *    measurable effect and min > max makes Chrome reject the whole answer, so no preset uses it and values are normalised.
 */

const BitrateKeys = ['x-google-start-bitrate', 'x-google-min-bitrate', 'x-google-max-bitrate'];
const AuxiliaryCodecNames = new Set(['rtx', 'red', 'ulpfec', 'flexfec-03', 'flexfec']);

export const QualityModes = ['fps', 'resolution', 'both'];

/**
 * LAN values per viewer quality mode. encodingMaxBitrateBps goes to RTCRtpEncodingParameters.maxBitrate and sdp to
 * mungeVideoBitrate(); keep both in step. degradation lists RTCRtpSendParameters.degradationPreference candidates (first
 * accepted wins) for the grace period after connect or a source switch and for the steady state afterwards.
 * 'fps' holds resolution for graceMs because Chrome's quality scaler downscales 1080p to 720p ~2 s after connect while the
 * bandwidth estimate is still ramping; switching the preference clears that restriction.
 */
export const RecommendedBitrateHints = {
  fps: {
    encodingMaxBitrateBps: 12000000,
    sdp: { startKbps: 10000, maxKbps: 12000 },
    degradation: { duringGrace: ['maintain-resolution'], afterGrace: ['maintain-framerate'], graceMs: 6000 }
  },
  resolution: {
    encodingMaxBitrateBps: 12000000,
    sdp: { startKbps: 10000, maxKbps: 12000 },
    degradation: { duringGrace: ['maintain-resolution'], afterGrace: ['maintain-resolution'], graceMs: 0 }
  },
  both: {
    encodingMaxBitrateBps: 16000000,
    sdp: { startKbps: 12000, maxKbps: 16000 },
    degradation: { duringGrace: ['maintain-framerate-and-resolution', 'maintain-resolution'], afterGrace: ['maintain-framerate-and-resolution', 'maintain-resolution'], graceMs: 0 }
  }
};

export function isQualityMode(mode) {
  return QualityModes.includes(mode);
}

export function getRecommendedBitrateHints(mode) {
  return RecommendedBitrateHints[mode] || RecommendedBitrateHints.fps;
}

function normalizeKbps(name, value) {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new RangeError(`${name} must be a positive number of kbps, got ${value}`);
  }
  return Math.round(numeric);
}

/**
 * Resolves the three values and makes them consistent (min <= start <= max). Returns the ordered "key=value" list,
 * empty when no value was requested. Throws RangeError for non-positive or non-numeric values.
 */
export function buildBitrateParams({ startKbps, minKbps, maxKbps } = {}) {
  let start = normalizeKbps('startKbps', startKbps);
  let min = normalizeKbps('minKbps', minKbps);
  const max = normalizeKbps('maxKbps', maxKbps);
  if (max !== null && min !== null && min > max) {
    min = max;
  }
  if (start !== null) {
    if (max !== null && start > max) {
      start = max;
    }
    if (min !== null && start < min) {
      start = min;
    }
  }
  const params = [];
  if (start !== null) {
    params.push(`x-google-start-bitrate=${start}`);
  }
  if (min !== null) {
    params.push(`x-google-min-bitrate=${min}`);
  }
  if (max !== null) {
    params.push(`x-google-max-bitrate=${max}`);
  }
  return params;
}

function isBitrateParam(token) {
  const key = token.split('=')[0].trim().toLowerCase();
  return BitrateKeys.includes(key);
}

/**
 * Adds the bitrate parameters to every real video codec of every active m=video section. rtx/red/ulpfec/flexfec payloads,
 * audio and rejected (port 0) sections are left alone, an existing fmtp line is extended (old x-google values replaced),
 * a codec without an fmtp line gets one, and the line ending style is preserved.
 * options.codecs optionally restricts the change to the named codecs (case-insensitive).
 */
export function mungeVideoBitrate(sdp, options = {}) {
  if (typeof sdp !== 'string' || sdp.length === 0) {
    return sdp;
  }
  const bitrateParams = buildBitrateParams(options);
  if (bitrateParams.length === 0) {
    return sdp;
  }
  const only = Array.isArray(options.codecs) && options.codecs.length > 0 ? new Set(options.codecs.map((name) => name.toLowerCase())) : null;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r?\n/);
  const endsWithBreak = lines.length > 0 && lines[lines.length - 1] === '';
  if (endsWithBreak) {
    lines.pop();
  }

  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.startsWith('m=')) {
      output.push(line);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length && !lines[end].startsWith('m=')) {
      end += 1;
    }
    const section = lines.slice(index, end);
    const header = section[0].split(' ');
    const isActiveVideo = header[0] === 'm=video' && header[1] !== '0';
    output.push(...(isActiveVideo ? mungeVideoSection(section, bitrateParams, only) : section));
    index = end;
  }
  return output.join(eol) + (endsWithBreak ? eol : '');
}

function mungeVideoSection(section, bitrateParams, only) {
  const codecNames = new Map();
  const auxiliaryPayloads = new Set();
  for (const line of section) {
    const rtpmap = /^a=rtpmap:(\d+) ([^/\s]+)/.exec(line);
    if (rtpmap) {
      const name = rtpmap[2].toLowerCase();
      codecNames.set(rtpmap[1], name);
      if (AuxiliaryCodecNames.has(name)) {
        auxiliaryPayloads.add(rtpmap[1]);
      }
    }
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (fmtp && /(^|;)\s*apt=\d+/.test(fmtp[2])) {
      auxiliaryPayloads.add(fmtp[1]);
    }
  }

  const targets = [];
  for (const [payload, name] of codecNames.entries()) {
    if (!auxiliaryPayloads.has(payload) && (!only || only.has(name))) {
      targets.push(payload);
    }
  }
  if (targets.length === 0) {
    return section;
  }

  const result = section.slice();
  for (const payload of targets) {
    const fmtpIndex = result.findIndex((line) => line.startsWith(`a=fmtp:${payload} `));
    if (fmtpIndex >= 0) {
      const existing = result[fmtpIndex].slice(`a=fmtp:${payload} `.length);
      const kept = existing.split(';').map((token) => token.trim()).filter((token) => token.length > 0 && !isBitrateParam(token));
      result[fmtpIndex] = `a=fmtp:${payload} ${[...kept, ...bitrateParams].join(';')}`;
      continue;
    }
    let insertAfter = -1;
    for (let i = 0; i < result.length; i += 1) {
      if (result[i].startsWith(`a=rtpmap:${payload} `) || result[i].startsWith(`a=rtcp-fb:${payload} `)) {
        insertAfter = i;
      }
    }
    if (insertAfter >= 0) {
      result.splice(insertAfter + 1, 0, `a=fmtp:${payload} ${bitrateParams.join(';')}`);
    }
  }
  return result;
}

/** Reads the x-google bitrate parameters back per payload of the active video sections (tests and diagnostics). */
export function readVideoBitrateParams(sdp) {
  const found = [];
  if (typeof sdp !== 'string') {
    return found;
  }
  let inActiveVideo = false;
  const names = new Map();
  const params = new Map();
  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('m=')) {
      inActiveVideo = line.startsWith('m=video ') && line.split(' ')[1] !== '0';
      continue;
    }
    if (!inActiveVideo) {
      continue;
    }
    const rtpmap = /^a=rtpmap:(\d+) ([^/\s]+)/.exec(line);
    if (rtpmap) {
      names.set(rtpmap[1], rtpmap[2]);
    }
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (fmtp) {
      for (const token of fmtp[2].split(';')) {
        const [key, value] = token.trim().split('=');
        if (BitrateKeys.includes(key)) {
          if (!params.has(fmtp[1])) {
            params.set(fmtp[1], {});
          }
          params.get(fmtp[1])[key] = Number(value);
        }
      }
    }
  }
  for (const [payload, values] of params.entries()) {
    found.push({ payload, codec: names.get(payload) || '?', params: values });
  }
  return found;
}
