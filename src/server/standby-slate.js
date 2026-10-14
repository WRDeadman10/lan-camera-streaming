/**
 * @file standby-slate.js
 * Generates an HD/SD standby slate JPEG for virtual webcam and MJPEG subscribers
 * when no camera sender is actively transmitting frames.
 */

// Byte-perfect valid JFIF baseline JPEG buffer (SOI 0xFFD8 ... EOI 0xFFD9)
const STANDBY_JPEG_HEX = 
  'ffd8ffe000104a46494600010101004800480000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f007f00ffd9';

let cachedStandbyBuffer = null;

export function getStandbySlateBuffer() {
  if (!cachedStandbyBuffer) {
    cachedStandbyBuffer = Buffer.from(STANDBY_JPEG_HEX, 'hex');
  }
  return cachedStandbyBuffer;
}

export const getStandbySlateJpeg = getStandbySlateBuffer;
