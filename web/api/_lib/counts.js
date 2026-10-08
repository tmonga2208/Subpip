// Anonymous usage counts from the extension. Each one is a single fact with
// nothing about its sender: a window was opened on such a site and captions
// were or were not found; a free viewer tapped a Premium feature; someone
// went on towards Premium. The server keeps a day's totals, one number per
// kind of fact, and never a row per event. Once a week the owner is told.
import { HttpsError } from './http.js';
import { day } from './alerts.js';
import { log } from './log.js';

// Sites known by name. Any other is "other": its name is never sent or kept.
export const SITES = ['youtube', 'netflix', 'hotstar', 'primevideo', 'disneyplus', 'crunchyroll', 'other'];
const CAPTIONS = ['found', 'none'];
const PLANS = ['free', 'premium'];
const FEATURES = ['translate', 'speed', 'speech', 'study', 'subtitles', 'saved'];
const PLACES = ['popup', 'window'];
const COUNTED_PER_DAY = 50000;

const oneOf = (value, choices, name) => {
  if (typeof value === 'string' && choices.includes(value)) return value;
  throw new HttpsError('invalid-argument', `Unknown ${name}`);
};

// The total an event adds to, e.g. "opened|youtube|found|free|4.8|154"
function totalFor(data) {
  if (typeof data.version !== 'string' || !/^\d[\d.]{0,11}$/.test(data.version)) throw new HttpsError('invalid-argument', 'Unknown version');
  if (!Number.isInteger(data.browser) || data.browser < 1 || data.browser > 999) throw new HttpsError('invalid-argument', 'Unknown browser');
  const tail = [data.version, data.browser];
  if (data.event === 'opened') {
    const site = typeof data.site === 'string' && SITES.includes(data.site) ? data.site : 'other';
    return ['opened', site, oneOf(data.captions, CAPTIONS, 'captions'), oneOf(data.plan, PLANS, 'plan'), ...tail].join('|');
  }
  if (data.event === 'premium_tap') return ['premium_tap', oneOf(data.feature, FEATURES, 'feature'), oneOf(data.where, PLACES, 'place'), ...tail].join('|');
  if (data.event === 'upgrade_click') return ['upgrade_click', oneOf(data.where, PLACES, 'place'), ...tail].join('|');
  throw new HttpsError('invalid-argument', 'Unknown event');
}

export async function countUsage(data, ctx, deps) {
  const key = totalFor(data);
  const ref = deps.db.collection('stats').doc(day(deps.now()));
  await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const { total = 0, counts = {} } = snap.exists ? snap.data() : {};
    // Over the limit it is still answered: there is nothing the sender can do
    if (total >= COUNTED_PER_DAY) return;
    tx.set(ref, { total: total + 1, counts: { ...counts, [key]: (counts[key] || 0) + 1 } });
  });
  return { ok: true };
}

// ---- once a week, what the totals say ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
const add = (totals, name, count) => { totals[name] = (totals[name] || 0) + count; };
const rows = (totals, line) => Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([name, count]) => line(name, count));

export async function weeklySummary(data, ctx, deps) {
  const now = deps.now();
  // At most one a day, so the address can be called by anybody without harm
  const sentRef = deps.db.collection('alerts').doc(`weekly-summary_${day(now)}`);
  const first = await deps.db.runTransaction(async (tx) => {
    if ((await tx.get(sentRef)).exists) return false;
    tx.set(sentRef, { count: 1 });
    return true;
  });
  if (!first || !deps.mailer || !deps.alertTo) return { ok: true, sent: false };

  const days = [7, 6, 5, 4, 3, 2, 1].map((back) => new Date(now.getTime() - back * 24 * 60 * 60 * 1000));
  const opened = {};
  const without = {};
  const plans = { free: 0, premium: 0 };
  const taps = {};
  const clicks = {};
  for (const date of days) {
    const snap = await deps.db.collection('stats').doc(day(date)).get();
    for (const [key, count] of Object.entries((snap.exists && snap.data().counts) || {})) {
      const [event, a, b, c] = key.split('|');
      if (event === 'opened') {
        add(opened, a, count);
        if (b === 'none') add(without, a, count);
        add(plans, c, count);
      } else if (event === 'premium_tap') add(taps, a, count);
      else if (event === 'upgrade_click') add(clicks, a, count);
    }
  }
  const sum = (totals) => Object.values(totals).reduce((all, count) => all + count, 0);
  const windows = sum(opened);
  const missing = sum(without);
  const lines = [`SubPIP, ${shortDate(days[0])} to ${shortDate(days[6])}. Anonymous counts from people who have not switched them off.`, ''];
  if (!windows && !sum(taps) && !sum(clicks)) lines.push('Nothing was counted.');
  else {
    lines.push('Windows opened, by site:');
    lines.push(...rows(opened, (site, count) => `  ${site.padEnd(12)} ${count} opened, ${without[site] || 0} without captions (${Math.round(((without[site] || 0) / count) * 100)}%)`));
    lines.push('', `Opened by: free ${plans.free}, Premium ${plans.premium}`, '');
    lines.push('Premium features tapped by free users:');
    lines.push(...(sum(taps) ? rows(taps, (feature, count) => `  ${feature.padEnd(12)} ${count}`) : ['  none']));
    lines.push('', `On the way to Premium: ${sum(clicks)}${sum(clicks) ? ` (${rows(clicks, (where, count) => `${where} ${count}`).join(', ')})` : ''}`);
  }
  await deps.mailer.send({ to: deps.alertTo, subject: `[SubPIP week] ${windows} windows opened, ${missing} without captions`, text: lines.join('\n') })
    .catch((error) => log('error', 'weekly-summary-failed', { error: error.message }));
  return { ok: true, sent: true };
}
