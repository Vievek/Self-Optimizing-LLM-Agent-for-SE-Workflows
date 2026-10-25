import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GroqKeyPoolManager, COOLDOWN_24H_MS } from './groq-key-pool.js';

describe('GroqKeyPoolManager', () => {
  const testStateFile = path.resolve(process.cwd(), '.test_groq_key_state.json');

  beforeEach(() => {
    if (fs.existsSync(testStateFile)) {
      fs.unlinkSync(testStateFile);
    }
    process.env.GROQ_KEY_COUNT = '3';
    process.env.GROQ_API_KEY_1 = 'gsk_key_one';
    process.env.GROQ_API_KEY_2 = 'gsk_key_two';
    process.env.GROQ_API_KEY_3 = 'gsk_key_three';
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (fs.existsSync(testStateFile)) {
      fs.unlinkSync(testStateFile);
    }
    delete process.env.GROQ_KEY_COUNT;
    delete process.env.GROQ_API_KEY_1;
    delete process.env.GROQ_API_KEY_2;
    delete process.env.GROQ_API_KEY_3;
    delete process.env.GROQ_API_KEY;
  });

  it('initializes and activates first healthy key', () => {
    const pool = new GroqKeyPoolManager({ stateFile: testStateFile });
    const success = pool.activate();

    expect(success).toBe(true);
    expect(process.env.GROQ_API_KEY).toBe('gsk_key_one');
    expect(pool.state.currentIndex).toBe(1);
  });

  it('rotates to next key on daily limit and saves lastHitTime', () => {
    const pool = new GroqKeyPoolManager({ stateFile: testStateFile });
    pool.activate();
    expect(process.env.GROQ_API_KEY).toBe('gsk_key_one');

    const nextKey = pool.rotateOnDailyLimit();
    expect(nextKey).toBe('gsk_key_two');
    expect(process.env.GROQ_API_KEY).toBe('gsk_key_two');
    expect(pool.state.currentIndex).toBe(2);
    expect(typeof pool.state.keys['1'].lastHitTime).toBe('number');
  });

  it('wraps around from last key (3) back to first key (1) if key 1 is healthy', () => {
    const pool = new GroqKeyPoolManager({ stateFile: testStateFile });
    pool.state.currentIndex = 3;

    const nextKey = pool.rotateOnDailyLimit();
    expect(nextKey).toBe('gsk_key_one');
    expect(process.env.GROQ_API_KEY).toBe('gsk_key_one');
    expect(pool.state.currentIndex).toBe(1);
  });

  it('restores key health after 24 hours have elapsed', () => {
    const pool = new GroqKeyPoolManager({ stateFile: testStateFile });
    const twentyFiveHoursAgo = Date.now() - (COOLDOWN_24H_MS + 3600000);

    pool.state.keys['1'] = { lastHitTime: twentyFiveHoursAgo };
    expect(pool.isKeyHealthy(1)).toBe(true);
  });

  it('keeps key in cooldown if less than 24 hours elapsed', () => {
    const pool = new GroqKeyPoolManager({ stateFile: testStateFile });
    const oneHourAgo = Date.now() - 3600000;

    pool.state.keys['1'] = { lastHitTime: oneHourAgo };
    expect(pool.isKeyHealthy(1)).toBe(false);
  });

  it('throws error when all keys are exhausted', () => {
    const pool = new GroqKeyPoolManager({ stateFile: testStateFile });
    const now = Date.now();
    pool.state.keys['1'] = { lastHitTime: now };
    pool.state.keys['2'] = { lastHitTime: now };
    pool.state.keys['3'] = { lastHitTime: now };
    pool.state.currentIndex = 1;

    expect(() => pool.rotateOnDailyLimit()).toThrow('All 3 Groq API keys have reached daily limits');
  });
});

