import fs from 'node:fs';
import path from 'node:path';

export const COOLDOWN_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Manages an arbitrary number of Groq API keys defined in .env
 * (GROQ_KEY_COUNT=N, GROQ_API_KEY_1 ... GROQ_API_KEY_N).
 * Tracks 24-hour cooldown timestamps in .groq_key_state.json and wraps circularly (1 -> 2 -> ... -> N -> 1).
 */
export class GroqKeyPoolManager {
  constructor(options = {}) {
    this.keyCount = parseInt(process.env.GROQ_KEY_COUNT || '0', 10);
    this.stateFile = options.stateFile || path.resolve(process.cwd(), '.groq_key_state.json');
    this.state = this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        if (typeof raw === 'object' && raw !== null) {
          return {
            currentIndex: typeof raw.currentIndex === 'number' ? raw.currentIndex : 1,
            keys: typeof raw.keys === 'object' && raw.keys !== null ? raw.keys : {},
          };
        }
      }
    } catch {
      // Fallback on read/parse error
    }
    return {
      currentIndex: 1,
      keys: {},
    };
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.warn(`⚠️ [KeyPool] Could not persist key pool state: ${err.message}`);
    }
  }

  isKeyHealthy(index) {
    const keyRecord = this.state.keys[String(index)];
    if (!keyRecord || !keyRecord.lastHitTime) {
      return true;
    }
    const elapsed = Date.now() - keyRecord.lastHitTime;
    return elapsed >= COOLDOWN_24H_MS;
  }

  getKeyValue(index) {
    const envVarName = `GROQ_API_KEY_${index}`;
    return process.env[envVarName]?.trim();
  }

  /**
   * Finds the next usable key index starting from startIndex or wrapping around.
   */
  findUsableKey(startIndex) {
    if (this.keyCount <= 0) return null;

    let checked = 0;
    let idx = startIndex;

    while (checked < this.keyCount) {
      if (idx > this.keyCount || idx < 1) {
        idx = 1;
      }

      const val = this.getKeyValue(idx);
      if (val && this.isKeyHealthy(idx)) {
        return { index: idx, value: val };
      }

      idx = (idx % this.keyCount) + 1;
      checked++;
    }

    return null;
  }

  getEarliestResetInfo() {
    let earliest = Infinity;
    let earliestIndex = 1;

    for (let i = 1; i <= this.keyCount; i++) {
      const rec = this.state.keys[String(i)];
      if (rec && rec.lastHitTime) {
        const remaining = COOLDOWN_24H_MS - (Date.now() - rec.lastHitTime);
        if (remaining < earliest) {
          earliest = remaining;
          earliestIndex = i;
        }
      }
    }

    const waitMinutes = Math.max(1, Math.ceil(earliest / (60 * 1000)));
    const waitHours = (waitMinutes / 60).toFixed(1);

    return {
      earliestIndex,
      waitMinutes,
      waitHours,
    };
  }

  /**
   * Selects an active healthy key and injects it into process.env.GROQ_API_KEY.
   */
  activate() {
    if (this.keyCount <= 0) {
      return false;
    }

    const usable = this.findUsableKey(this.state.currentIndex);

    if (!usable) {
      const reset = this.getEarliestResetInfo();
      console.error('='.repeat(70));
      console.error(`❌ [KeyPool] All ${this.keyCount} Groq API keys have hit their daily token limits (TPD).`);
      console.error(`⏳ Earliest key (GROQ_API_KEY_${reset.earliestIndex}) recovers in ~${reset.waitHours}h (${reset.waitMinutes} minutes).`);
      console.error('='.repeat(70));
      process.exit(1);
    }

    this.state.currentIndex = usable.index;
    this.saveState();

    process.env.GROQ_API_KEY = usable.value;
    console.log(`🔑 [KeyPool] Active key: GROQ_API_KEY_${usable.index} (out of ${this.keyCount} configured keys)`);
    return true;
  }

  /**
   * Called when a daily limit (TPD) is encountered.
   * Logs the hit time, sets 24h cooldown, and switches process.env.GROQ_API_KEY to the next key.
   */
  rotateOnDailyLimit() {
    const exhaustedIndex = this.state.currentIndex;
    const hitTime = Date.now();
    const hitIso = new Date(hitTime).toISOString();

    if (!this.state.keys[String(exhaustedIndex)]) {
      this.state.keys[String(exhaustedIndex)] = {};
    }
    this.state.keys[String(exhaustedIndex)].lastHitTime = hitTime;
    this.state.keys[String(exhaustedIndex)].lastHitIso = hitIso;

    console.warn('\n' + '='.repeat(70));
    console.warn(`⚠️ [KeyPool] GROQ_API_KEY_${exhaustedIndex} hit 24-hour daily limit (TPD) at ${hitIso}`);
    console.warn(`🕒 24-hour cooldown initiated for GROQ_API_KEY_${exhaustedIndex}.`);

    // Advance to next key: (current % count) + 1
    const nextIndex = (exhaustedIndex % this.keyCount) + 1;
    const nextUsable = this.findUsableKey(nextIndex);

    if (!nextUsable) {
      this.saveState();
      const reset = this.getEarliestResetInfo();
      console.error(`❌ [KeyPool] All ${this.keyCount} Groq API keys are currently exhausted!`);
      console.error(`⏳ Earliest key (GROQ_API_KEY_${reset.earliestIndex}) recovers in ~${reset.waitHours}h.`);
      console.error('='.repeat(70) + '\n');
      throw new Error(`All ${this.keyCount} Groq API keys have reached daily limits (TPD).`);
    }

    this.state.currentIndex = nextUsable.index;
    this.saveState();

    process.env.GROQ_API_KEY = nextUsable.value;
    console.warn(`🔄 [KeyPool] Switched to GROQ_API_KEY_${nextUsable.index} for failover.`);
    console.warn('='.repeat(70) + '\n');

    return nextUsable.value;
  }
}

