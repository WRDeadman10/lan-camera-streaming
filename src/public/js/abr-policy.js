/**
 * @file abr-policy.js
 * Pure adaptive-bitrate policy: classifies the sender's measured round-trip time into a throttle level with hysteresis
 * and maps a level to bitrate and scale limits for a viewer's quality mode.
 */

export const AbrLevel = {
  Ok: 'ok',
  Moderate: 'moderate',
  Severe: 'severe'
};

const ModerateRttMs = 150;
const SevereRttMs = 350;
const RestoreRttMs = 120;
const ConfirmSamples = 2;
const ModerateBitrateBps = 1500000;
const SevereBitrateBps = 600000;

export function createAbrState() {
  return { level: AbrLevel.Ok, candidate: null, candidateCount: 0 };
}

/** Returns the level the RTT points at, or null to keep the current level (missing sample or the 120-150 ms band). */
export function classifyRtt(rawRttMs) {
  if (typeof rawRttMs !== 'number' || !Number.isFinite(rawRttMs)) {
    return null;
  }
  if (rawRttMs > SevereRttMs) {
    return AbrLevel.Severe;
  }
  if (rawRttMs > ModerateRttMs) {
    return AbrLevel.Moderate;
  }
  if (rawRttMs < RestoreRttMs) {
    return AbrLevel.Ok;
  }
  return null;
}

/**
 * Feeds one RTT sample. A level change needs ConfirmSamples consecutive samples that point at the same new level, so a
 * single spike (Wi-Fi uplink queue) neither throttles nor restores. Mutates and returns { changed, level, previousLevel }.
 */
export function stepAbr(state, rawRttMs) {
  const target = classifyRtt(rawRttMs);
  if (target === null || target === state.level) {
    state.candidate = null;
    state.candidateCount = 0;
    return { changed: false, level: state.level, previousLevel: state.level };
  }
  if (state.candidate === target) {
    state.candidateCount += 1;
  } else {
    state.candidate = target;
    state.candidateCount = 1;
  }
  if (state.candidateCount < ConfirmSamples) {
    return { changed: false, level: state.level, previousLevel: state.level };
  }
  const previousLevel = state.level;
  state.level = target;
  state.candidate = null;
  state.candidateCount = 0;
  return { changed: true, level: target, previousLevel };
}

/**
 * Limits for a level. Only 'fps' viewers get a smaller picture when throttled; 'resolution' and 'both' viewers keep their
 * resolution and only lose bitrate, matching what they asked for.
 */
export function getAbrLimits(level, mode, ceilingBps) {
  const scalesResolution = mode === 'fps';
  if (level === AbrLevel.Severe) {
    return { maxBitrateBps: SevereBitrateBps, scaleResolutionDownBy: scalesResolution ? 2.0 : 1.0 };
  }
  if (level === AbrLevel.Moderate) {
    return { maxBitrateBps: ModerateBitrateBps, scaleResolutionDownBy: scalesResolution ? 1.5 : 1.0 };
  }
  return { maxBitrateBps: ceilingBps, scaleResolutionDownBy: 1.0 };
}
