// TenderScout hiring velocity: which companies are ramping up engineering hiring.
// Find hiring companies (Workable, Lever) -> their job feeds -> classify jobs -> Google Sheet
// (companies, jobs, daily snapshots, spikes) -> spike / burst / stack rules -> Slack summary.

const config = require('./config');
const workable = require('./sources/workable');
const lever = require('./sources/lever');
const companiesFinder = require('./companies');
const { buildTermMatcher, buildTermLister } = require('./filter');
const { detect, daysAgo } = require('./velocity');
const { sleep } = require('./http');
const sheets = require('./sheets');
const slack = require('./slack');

// Job feed per ATS (the "ATS" column in the sheet).
const SOURCES = Object.fromEntries([workable, lever].map((s) => [s.name, s]));

const JOB_HEADERS = [
  'ATS', 'Company', 'Slug', 'Job ID', 'Title', 'Department', 'Location', 'Engineering', 'Stacks',
  'Published On', 'First Seen', 'New', 'URL',
];

const SNAPSHOT_HEADERS = [
  'Date', 'ATS', 'Company', 'Slug', 'Open Jobs', 'Open Engineering', 'New Jobs', 'New Engineering', 'New Stacks',
];

const SPIKE_HEADERS = [
  'Date', 'ATS', 'Company', 'Slug', 'Why', 'Engineering Jobs Before', 'Engineering Jobs Now',
  'New Engineering Jobs (7 days)', 'Hot Stacks', 'Latest Jobs', 'Careers Page',
];

const REASONS = { spike: 'Engineering jobs spiked', burst: 'Burst of new engineering jobs', stack: 'Stack in demand' };

const keyOf = (ats, slug) => `${ats}:${slug}`;

// Error bodies can be whole HTML pages - keep Slack to a short reason.
function shortError(err) {
  const status = err.message.match(/ (\d{3}):/)?.[1];
  if (status === '429') return 'rate limited';
  if (status) return `HTTP ${status}`;
  return `network error (${err.cause?.code || err.message.slice(0, 60)})`;
}

// One company at a time, to stay under Workable's ~1 request/second limit.
async function fetchAll(tracked) {
  const companies = [];
  const notFound = [];
  const errors = [];
  for (const [i, t] of tracked.entries()) {
    if (i) await sleep(config.hiringDelayMs);
    const source = SOURCES[t.ats];
    if (!source) continue;
    try {
      const feed = await source.fetchJobs(t.slug);
      companies.push({ ...feed, ats: t.ats, company: t.company || feed.company, careersUrl: source.careersUrl(t.slug) });
    } catch (err) {
      if (/ 404:/.test(err.message)) {
        notFound.push(`${t.slug} (${t.ats})`);
      } else {
        console.error(`${t.ats} ${t.slug} failed:`, err.message);
        errors.push(`${t.slug} (${t.ats}): ${shortError(err)}`);
      }
    }
  }
  if (!companies.length) throw new Error(`No company job feed could be fetched${errors.length ? ` - ${errors[0]}` : ''}`);
  console.log(`Feeds: ${companies.length}/${tracked.length} companies fetched, ${notFound.length} not found, ${errors.length} errors`);
  return { companies, notFound, errors };
}

function classify(companies) {
  const isEngineering = buildTermMatcher(config.engineeringKeywords);
  const stacksIn = buildTermLister(config.stacks);
  for (const c of companies) {
    for (const j of c.jobs) {
      j.engineering = isEngineering(`${j.title} ${j.department} ${j.function}`);
      j.stacks = stacksIn(`${j.title} ${j.description}`);
    }
  }
}

// "react:3; python:1"
function stackSummary(jobs) {
  const counts = new Map();
  for (const j of jobs) for (const s of j.stacks) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join('; ');
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// Only the companies that are ramping up, one row each per day (re-runs don't duplicate).
async function saveSpikes(conn, alerts, today) {
  const tab = await sheets.openTab(conn, config.hiringSpikesTab, SPIKE_HEADERS);
  const done = new Set((await sheets.readRows(tab)).filter((r) => r[0] === today).map((r) => keyOf(r[1], r[3])));
  await sheets.appendRows(tab, alerts.filter((a) => !done.has(keyOf(a.ats, a.slug))).map((a) => [
    today, a.ats, a.company, a.slug,
    a.reasons.map((r) => REASONS[r]).join('; '),
    a.baseline ?? '', a.openEng, a.newEng,
    a.hotStacks.map(([s, n]) => `${s}:${n}`).join('; '),
    a.latest.map((j) => `${j.title} ${j.url}`.trim()).join('\n'),
    a.careersUrl,
  ]));
}

// Records today's jobs + snapshots and returns the companies that are ramping up.
// A company's first poll only sets its baseline: those jobs are stored with New = N.
async function track(conn, companies, today) {
  const jobsTab = await sheets.openTab(conn, config.hiringJobsTab, JOB_HEADERS);
  const snapTab = await sheets.openTab(conn, config.hiringSnapshotsTab, SNAPSHOT_HEADERS);
  const jobRows = await sheets.readRows(jobsTab);
  const snapRows = await sheets.readRows(snapTab);

  const knownJobs = new Set(jobRows.map((r) => keyOf(r[0], r[3])));
  const since = daysAgo(today, 6);
  const recentNew = groupBy(jobRows
    .filter((r) => r[11] === 'Y' && r[10] >= since)
    .map((r) => ({
      key: keyOf(r[0], r[2]), title: r[4], engineering: r[7] === 'Y', stacks: r[8] ? r[8].split(', ') : [], firstSeen: r[10], url: r[12] || '',
    })), (j) => j.key);
  const history = groupBy(snapRows.map((r) => ({ key: keyOf(r[1], r[3]), date: r[0], openEng: Number(r[5]) || 0 })), (h) => h.key);

  const newJobRows = [];
  const newSnapRows = [];
  const alerts = [];
  let newJobs = 0;
  let baselined = 0;
  for (const c of companies) {
    const key = keyOf(c.ats, c.slug);
    const firstPoll = !history.has(key);
    if (firstPoll) baselined++;
    const added = c.jobs.filter((j) => !knownJobs.has(keyOf(c.ats, j.id)));
    added.forEach((j) => knownJobs.add(keyOf(c.ats, j.id)));
    newJobRows.push(...added.map((j) => [
      c.ats, c.company, c.slug, j.id, j.title, j.department, j.location, j.engineering ? 'Y' : 'N',
      j.stacks.join(', '), j.publishedOn, today, firstPoll ? 'N' : 'Y', j.url,
    ]));

    const fresh = firstPoll ? [] : added;
    newJobs += fresh.length;
    const openEng = c.jobs.filter((j) => j.engineering).length;
    if (!(history.get(key) || []).some((h) => h.date === today)) {
      newSnapRows.push([today, c.ats, c.company, c.slug, c.jobs.length, openEng, fresh.length,
        fresh.filter((j) => j.engineering).length, stackSummary(fresh)]);
    }

    const alert = detect({
      today,
      openEng,
      history: history.get(key) || [],
      recentNew: [...(recentNew.get(key) || []), ...fresh.map((j) => ({ ...j, firstSeen: today }))],
    }, config);
    if (alert) alerts.push({ ats: c.ats, company: c.company, slug: c.slug, careersUrl: c.careersUrl, ...alert });
  }

  await sheets.appendRows(jobsTab, newJobRows);
  await sheets.appendRows(snapTab, newSnapRows);
  alerts.sort((a, b) => (b.newEng + b.openEng - (b.baseline ?? b.openEng)) - (a.newEng + a.openEng - (a.baseline ?? a.openEng)));
  await saveSpikes(conn, alerts, today);
  console.log(`Hiring: ${newJobs} new jobs, ${baselined} companies baselined, ${alerts.length} alerts`);
  return { alerts, newJobs, baselined, firstRun: snapRows.length === 0 };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  // Dry runs work without Google credentials, try at most 10 new companies per source and write nothing.
  const conn = !config.dryRun || (config.googleCredentials && config.sheetId) ? await sheets.connect(config) : null;
  const { companies: tracked, newCompanies } = await companiesFinder.update(conn, today, { dryRun: config.dryRun });
  if (!tracked.length) throw new Error('No companies found to track');
  console.log(`Polling ${tracked.length} companies...`);
  const { companies, notFound, errors } = await fetchAll(tracked);
  classify(companies);

  const perAts = Object.keys(SOURCES).map((ats) => [ats, companies.filter((c) => c.ats === ats).length]).filter(([, n]) => n);
  const totals = {
    polled: companies.length,
    perAts,
    openJobs: companies.reduce((n, c) => n + c.jobs.length, 0),
    openEng: companies.reduce((n, c) => n + c.jobs.filter((j) => j.engineering).length, 0),
    newCompanies,
    notFound,
    errors,
  };

  if (config.dryRun) {
    console.log(`\n[dry-run] ${totals.openJobs} open jobs, ${totals.openEng} engineering. Top 15 companies by open engineering jobs:`);
    console.table(companies
      .map((c) => ({ ats: c.ats, company: c.company.slice(0, 28), open: c.jobs.length, eng: c.jobs.filter((j) => j.engineering).length, stacks: stackSummary(c.jobs).slice(0, 45) }))
      .sort((a, b) => b.eng - a.eng)
      .slice(0, 15));
    if (notFound.length) console.log(`Not found: ${notFound.join(', ')}`);
    return;
  }

  const result = await track(conn, companies, today);

  await slack.post(config.slackWebhookUrl, slack.buildHiringReport({
    date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    ...result,
    ...totals,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${config.sheetId}`,
  }));

  if (errors.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  if (!config.dryRun) {
    await slack.post(config.slackWebhookUrl, `⚠️ TenderScout hiring velocity failed: ${err.message}`).catch(() => {});
  }
  process.exit(1);
});
