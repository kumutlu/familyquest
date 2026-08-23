import { beforeEach, describe, expect, it } from 'vitest';
import {
  isSoundEnabled,
  playCue,
  resetSoundControllerForTests,
  setSoundEnabled,
} from './sound';

beforeEach(() => {
  resetSoundControllerForTests();
  localStorage.clear();
});

describe('sound controller', () => {
  it('defaults to disabled (never surprises users with sound)', () => {
    expect(isSoundEnabled()).toBe(false);
  });

  it('persists the global enable/disable choice', () => {
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(localStorage.getItem('queki.sound.enabled')).toBe('true');
    setSoundEnabled(false);
    expect(localStorage.getItem('queki.sound.enabled')).toBe('false');
  });

  it('playCue is a safe no-op while disabled', () => {
    expect(() => playCue('celebrate')).not.toThrow();
  });

  it('playCue is a safe no-op without WebAudio support', () => {
    setSoundEnabled(true);
    // jsdom has no AudioContext — must not throw.
    expect(() => playCue('success')).not.toThrow();
  });

  // ---- Wave 2 semantic cues -------------------------------------------------
  it.each([
    'holdComplete',
    'submit',
    'approve',
    'reject',
    'queueComplete',
  ] as const)('supports the Wave 2 %s cue as a safe no-op', (cue) => {
    setSoundEnabled(true);
    expect(() => playCue(cue)).not.toThrow();
  });
});
