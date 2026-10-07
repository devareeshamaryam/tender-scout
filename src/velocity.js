// Hiring-velocity rules. No I/O, so they can be checked against made-up history.

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// YYYY-MM-DD n days before date.
const daysAgo = (date, n) => new Date(Date.parse(date) - n * 864e5).toISOString().slice(0, 10);

// today:     YYYY-MM-DD
// openEng:   open engineering jobs right now
// history:   earlier daily snapshots [{ date, openEng }]
// recentNew: jobs first seen in the last 7 days, today included, excluding a company's
//            first poll [{ title, url, engineering, stacks: [], firstSeen }]
// Returns null, or why the company is ramping up.
function detect({ today, openEng, history, recentNew }, cfg) {
  const reasons = [];

  const prior = history.filter((h) => h.date < today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-cfg.baselineDays);
  let baseline = null;
  if (prior.length >= 3) {
    baseline = median(prior.map((h) => h.openEng));
    if (openEng - baseline >= cfg.spikeMinIncrease && openEng >= baseline * cfg.spikeRatio) reasons.push('spike');
  }

  const newEng = recentNew.filter((j) => j.engineering);
  if (newEng.length >= cfg.burstMinNewEng) reasons.push('burst');

  const stackCounts = new Map();
  for (const j of recentNew) for (const s of j.stacks) stackCounts.set(s, (stackCounts.get(s) || 0) + 1);
  const hotStacks = [...stackCounts].filter(([, n]) => n >= cfg.stackSpikeMin).sort((a, b) => b[1] - a[1]);
  if (hotStacks.length) reasons.push('stack');

  // Only alert on days something relevant was posted, so one burst isn't repeated all week.
  const postedToday = recentNew.some((j) => j.firstSeen === today && (j.engineering || j.stacks.length));
  if (!reasons.length || !postedToday) return null;

  const latest = [...(newEng.length ? newEng : recentNew)]
    .sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : -1))
    .slice(0, 3);
  return { reasons, baseline, openEng, newEng: newEng.length, hotStacks, latest };
}

module.exports = { detect, daysAgo, median };
