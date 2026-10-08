// What runs once a day: the look at the one-year passes (passes.js) and, on
// Mondays, the week's summary to the owner (counts.js). One function for
// both, because the hosting plan allows twelve functions in all.
import { endFinishedPasses } from './passes.js';
import { weeklySummary } from './counts.js';

export async function runScheduled(query, deps) {
  const passes = await endFinishedPasses({}, {}, deps);
  const monday = deps.now().getUTCDay() === 1;
  // "?summary=1" asks for the summary on another day; it still goes once a day at most
  const summary = monday || query.summary ? await weeklySummary({}, {}, deps) : null;
  return { ok: true, passes, ...(summary ? { summary } : {}) };
}
