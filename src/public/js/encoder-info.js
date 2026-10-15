/**
 * @file encoder-info.js
 * Classifies the video encoder Chrome reports in outbound-rtp stats as hardware, software or unknown.
 */

const SoftwarePattern = /openh264|libvpx|libaom|ffmpeg|software/i;
const HardwarePattern = /external|mediafoundation|d3d11|d3d12|videoencodeaccelerator|nvenc|qsv|amf|vaapi|v4l2|videotoolbox|mediacodec|hardware/i;

/**
 * @param {{encoderImplementation?: string|null, powerEfficientEncoder?: boolean|null}} stats
 * @returns {'hardware'|'software'|'unknown'} 'unknown' means the name is not recognised and powerEfficientEncoder is missing,
 * so callers must not treat it as a reason to abandon the hardware path.
 */
export function classifyEncoder(stats) {
  const implementation = (stats && stats.encoderImplementation) || '';
  if (stats && stats.powerEfficientEncoder === true) {
    return 'hardware';
  }
  if (SoftwarePattern.test(implementation)) {
    return 'software';
  }
  if (HardwarePattern.test(implementation)) {
    return 'hardware';
  }
  if (stats && stats.powerEfficientEncoder === false) {
    return 'software';
  }
  return 'unknown';
}
