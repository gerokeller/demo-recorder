import { describe, expect, it } from 'vitest';

/**
 * TTS provider detection pokes at the filesystem and spawns subprocesses,
 * so we test the module's pure-logic surface: the exported types and the
 * integration surface of generateVoiceOver when called with zero texts
 * (which should short-circuit without invoking any provider).
 */
describe('tts module', () => {
  it('exposes generateVoiceOver and detectProvider', async () => {
    const mod = await import('../tts.ts');
    expect(typeof mod.generateVoiceOver).toBe('function');
    expect(typeof mod.detectProvider).toBe('function');
  });

  it('returns no clips when every text is empty or null', async () => {
    const { generateVoiceOver } = await import('../tts.ts');
    const result = await generateVoiceOver({
      texts: [null, '', '   '],
      outputDir: '/tmp/demo-recorder-tts-empty',
      // Pick a provider explicitly so we skip detection; `say` is always
      // present in the code path (falls through cleanly when no text).
      provider: 'say',
    });
    expect(result.clips).toHaveLength(0);
  });
});
