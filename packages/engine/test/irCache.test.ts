import { describe, expect, it } from 'vitest';
import { createAsyncCache } from '../src/audio/effects/irCache';

describe('createAsyncCache', () => {
  it('loads each key once and shares the promise', async () => {
    let calls = 0;
    const get = createAsyncCache(async (key: string) => {
      calls += 1;
      return `decoded:${key}`;
    });
    const [a, b] = await Promise.all([get('/ir/a.wav'), get('/ir/a.wav')]);
    expect(a).toBe('decoded:/ir/a.wav');
    expect(b).toBe(a);
    await get('/ir/a.wav');
    expect(calls).toBe(1);
  });

  it('caches per key, not globally', async () => {
    let calls = 0;
    const get = createAsyncCache(async () => ++calls);
    expect(await get('a')).toBe(1);
    expect(await get('b')).toBe(2);
    expect(await get('a')).toBe(1);
  });

  it('evicts a failed load so the next call retries', async () => {
    let calls = 0;
    const get = createAsyncCache(async (key: string) => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return `decoded:${key}`;
    });
    await expect(get('/ir/a.wav')).rejects.toThrow('network down');
    await expect(get('/ir/a.wav')).resolves.toBe('decoded:/ir/a.wav');
    expect(calls).toBe(2);
  });
});
