import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AbrLevel, classifyRtt, createAbrState, getAbrLimits, stepAbr } from '../src/public/js/abr-policy.js';

describe('ABR policy', () => {
  test('classifies RTT with a hold band between 120 and 150 ms and ignores missing samples', () => {
    assert.equal(classifyRtt(1), AbrLevel.Ok);
    assert.equal(classifyRtt(119), AbrLevel.Ok);
    assert.equal(classifyRtt(120), null);
    assert.equal(classifyRtt(150), null);
    assert.equal(classifyRtt(151), AbrLevel.Moderate);
    assert.equal(classifyRtt(350), AbrLevel.Moderate);
    assert.equal(classifyRtt(351), AbrLevel.Severe);
    assert.equal(classifyRtt(null), null);
    assert.equal(classifyRtt(undefined), null);
    assert.equal(classifyRtt(NaN), null);
  });

  test('a single RTT spike does not throttle (two consecutive samples are required)', () => {
    const state = createAbrState();
    assert.equal(stepAbr(state, 400).changed, false);
    assert.equal(stepAbr(state, 5).changed, false);
    assert.equal(state.level, AbrLevel.Ok);
  });

  test('two consecutive high samples throttle, two low samples restore', () => {
    const state = createAbrState();
    stepAbr(state, 200);
    const throttled = stepAbr(state, 210);
    assert.deepEqual(throttled, { changed: true, level: AbrLevel.Moderate, previousLevel: AbrLevel.Ok });

    stepAbr(state, 30);
    assert.equal(state.level, AbrLevel.Moderate, 'one low sample must not restore');
    const restored = stepAbr(state, 20);
    assert.deepEqual(restored, { changed: true, level: AbrLevel.Ok, previousLevel: AbrLevel.Moderate });
  });

  test('samples in the 120-150 ms band and missing samples keep the level and reset the streak', () => {
    const state = createAbrState();
    stepAbr(state, 200);
    stepAbr(state, 130);
    assert.equal(stepAbr(state, 200).changed, false, 'the band sample broke the streak');
    assert.equal(stepAbr(state, null).changed, false);
    assert.equal(state.level, AbrLevel.Ok);
  });

  test('severe throttling can step down to moderate and back', () => {
    const state = createAbrState();
    stepAbr(state, 500);
    assert.equal(stepAbr(state, 600).level, AbrLevel.Severe);
    stepAbr(state, 200);
    assert.equal(stepAbr(state, 220).level, AbrLevel.Moderate);
  });

  test('only fps viewers get a smaller picture; resolution and both only lose bitrate', () => {
    const ceiling = 12000000;
    assert.deepEqual(getAbrLimits(AbrLevel.Ok, 'fps', ceiling), { maxBitrateBps: ceiling, scaleResolutionDownBy: 1.0 });
    assert.deepEqual(getAbrLimits(AbrLevel.Moderate, 'fps', ceiling), { maxBitrateBps: 1500000, scaleResolutionDownBy: 1.5 });
    assert.deepEqual(getAbrLimits(AbrLevel.Severe, 'fps', ceiling), { maxBitrateBps: 600000, scaleResolutionDownBy: 2.0 });
    for (const mode of ['resolution', 'both']) {
      assert.equal(getAbrLimits(AbrLevel.Moderate, mode, ceiling).scaleResolutionDownBy, 1.0, mode);
      assert.equal(getAbrLimits(AbrLevel.Severe, mode, ceiling).scaleResolutionDownBy, 1.0, mode);
      assert.equal(getAbrLimits(AbrLevel.Moderate, mode, ceiling).maxBitrateBps, 1500000, mode);
    }
  });
});
