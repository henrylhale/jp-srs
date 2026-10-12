import * as db from './db.js';
import { State } from './fsrs.js';
import { todayStart } from './queue.js';

const DAY = 86400000;

export async function todayStats(now = Date.now()) {
  const start = todayStart(now);
  const logs = await db.logsSince(Math.min(start, now - 30 * DAY));
  const today = logs.filter((l) => l.ts >= start);
  const reviewsToday = today.filter((l) => l.prevState !== State.New).length;
  const newToday = today.filter((l) => l.prevState === State.New).length;
  const retention = (list) => {
    const rev = list.filter((l) => l.prevState === State.Review);
    return rev.length ? rev.filter((l) => l.grade > 1).length / rev.length : null;
  };
  return {
    reviewsToday,
    newToday,
    retentionToday: retention(today),
    retention30: retention(logs),
    reviews30: logs.length,
  };
}
