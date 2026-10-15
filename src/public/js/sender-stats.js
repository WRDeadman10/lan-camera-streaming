/**
 * @file sender-stats.js
 * Formats the per-viewer sender diagnostics line so the cause of a low resolution or frame rate can be read from the log.
 */

function formatMbps(bitsPerSecond) {
  return typeof bitsPerSecond === 'number' && Number.isFinite(bitsPerSecond) ? `${(bitsPerSecond / 1000000).toFixed(2)} Mbps` : '?';
}

function formatNumber(value, digits = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '?';
}

function formatSize(width, height) {
  return width && height ? `${width}x${height}` : '?';
}

function formatDurations(durations) {
  if (!durations || typeof durations !== 'object') {
    return '?';
  }
  return ['none', 'bandwidth', 'cpu', 'other']
    .map((key) => `${key}:${typeof durations[key] === 'number' ? durations[key].toFixed(1) : '?'}`)
    .join(',');
}

/**
 * @param {object} input
 * @param {object} input.stats result of WebRtcPeer.getStatsReport()
 * @param {object|null} input.diagnostics result of WebRtcPeer.getSenderDiagnostics()
 * @param {string} input.mode viewer quality mode
 * @param {string} input.abrLevel current adaptive-bitrate level
 * @param {string} input.pairInfo selected candidate pair description
 */
export function formatSenderStats({ stats, diagnostics, mode, abrLevel, pairInfo }) {
  const diag = diagnostics || {};
  const parts = [
    `Pair: ${pairInfo}`,
    `RTT: ${stats.rtt || '?'}`,
    `mode=${mode} pref=${diag.degradationPreference || '?'}${diag.graceActive ? ' (resolution hold)' : ''}`,
    `sent ${formatSize(stats.frameWidth, stats.frameHeight)} @ ${formatNumber(stats.framesPerSecond)} fps (src ${formatNumber(stats.sourceFramesPerSecond)} fps ${formatSize(stats.sourceWidth, stats.sourceHeight)})`,
    `target ${formatMbps(stats.targetBitrate)}`,
    `availOut ${formatMbps(stats.availableOutgoingBitrate)}`,
    `maxBitrate ${formatMbps(diag.maxBitrate)}`,
    `scaleDownBy ${formatNumber(diag.scaleResolutionDownBy, 1)}`,
    `LimitReason=${stats.qualityLimitationReason || '?'}`,
    `resChanges ${formatNumber(stats.qualityLimitationResolutionChanges)}`,
    `limitDur ${formatDurations(stats.qualityLimitationDurations)}`,
    `enc ${stats.codec || '?'} ${stats.encoderImplementation || '?'}`,
    `type=${stats.contentType || '?'} hint=${diag.contentHint || 'none'} track ${formatSize(diag.trackWidth, diag.trackHeight)}@${formatNumber(diag.trackFrameRate)}`,
    `abr=${abrLevel}`
  ];
  return parts.join(' | ');
}
