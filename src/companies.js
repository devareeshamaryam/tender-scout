// Finds the companies to track, so there is no list to maintain. Everything found is stored
// in the 'Hiring Companies' tab, and a company stays tracked once found.
// - Workable: search jobs.workable.com for engineering jobs in the configured locations.
// - Lever (no cross-company search): starter slugs from config, plus every tender award
//   winner in the awards tab of the tender sheet checked for a Lever page.

const config = require('./config');
const workable = require('./sources/workable');
const lever = require('./sources/lever');
const { cleanCompanyName } = require('./apollo');
const sheets = require('./sheets');
const { sleep } = require('./http');

// Columns A-H describe how the company was found; I-P are refreshed by every run.
const HEADERS = [
  'ATS', 'Slug', 'Company', 'Status', 'Website', 'Source ID', 'First Found', 'Found Via',
  'Open Jobs', 'Open Engineering', 'New Engineering Jobs (7 days)', 'Hiring Trend', 'Top Stacks',
  'Last Spike', 'Last Checked', 'Engineering History',
];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i]));
const TRACKED = 'tracked';
// Days of open-engineering counts kept in the Engineering History cell.
const HISTORY_DAYS = 60;

// "2026-10-07:4; 2026-10-08:6" <-> [{ date, openEng }]
const parseHistory = (cell) => (cell || '').split('; ').filter(Boolean)
  .map((e) => e.split(':')).map(([date, n]) => ({ date, openEng: Number(n) || 0 }));
const formatHistory = (entries) => entries.slice(-HISTORY_DAYS).map((h) => `${h.date}:${h.openEng}`).join('; ');

const squash = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// "Ocean Infinity Ltd" + oceaninfinity.com -> ocean-infinity, oceaninfinity
function slugCandidates({ title, website }) {
  const name = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(ltd|limited|plc|inc|llc|llp|gmbh|ag|s\.?a\.?|b\.?v\.?|group|uk|c\.i\.c)\b\.?/g, ' ')
    .trim();
  const out = new Set([name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name.replace(/[^a-z0-9]/g, '')]);
  try {
    const host = new URL(website).hostname.replace(/^www\./, '');
    out.add(host.split('.')[0]);
    out.add(host.replace(/\./g, '-'));
  } catch {
    // no / bad website
  }
  return [...out].filter((s) => s.length > 1);
}

// Same company if one squashed name starts the other (handles "X Ltd" vs "X").
function sameCompany(a, b) {
  const [x, y] = [squash(a), squash(b)];
  return x.length > 2 && y.length > 2 && (x.startsWith(y.slice(0, 8)) || y.startsWith(x.slice(0, 8)));
}

// Workable companies hiring for the search queries, by Workable company ID.
async function searchWorkable() {
  const companies = new Map();
  for (const location of config.workableLocations) {
    for (const query of config.workableQueries) {
      let token = null;
      for (let page = 0; page < config.workableSearchPages; page++) {
        const res = await workable.searchJobs(query, location, token);
        for (const job of res.jobs) {
          const c = job.company;
          if (c?.id && c.title && !companies.has(c.id)) companies.set(c.id, { ...c, via: `${query} / ${location}` });
        }
        await sleep(config.hiringDelayMs);
        if (!(token = res.nextPageToken)) break;
      }
    }
  }
  console.log(`Workable search: ${companies.size} hiring companies`);
  return [...companies.values()];
}

// [slug, status] for a newly seen Workable company.
async function resolveWorkable(company, knownSlugs) {
  const candidates = slugCandidates(company);
  const dupe = candidates.find((s) => knownSlugs.has(s));
  if (dupe) return ['', `same as ${dupe}`];
  for (const slug of candidates) {
    const feed = await workable.probe(slug);
    await sleep(config.hiringDelayMs);
    if (feed && feed.jobCount && sameCompany(feed.name, company.title)) return [slug, TRACKED];
  }
  return ['', 'no Workable page found'];
}

// [slug, status] for a tender award winner on Lever. Lever doesn't return a company name to
// check against, so very short names are skipped to avoid matching an unrelated company.
async function resolveLever(name, knownSlugs) {
  const candidates = slugCandidates({ title: name }).filter((s) => s.length >= 4);
  const dupe = candidates.find((s) => knownSlugs.has(s));
  if (dupe) return ['', `same as ${dupe}`];
  for (const slug of candidates) {
    const feed = await lever.probe(slug);
    await sleep(config.hiringDelayMs);
    if (feed && feed.jobCount) return [slug, TRACKED];
  }
  return ['', 'no Lever page found'];
}

// Unique award-winning supplier names from the awards tab ("A; B" cells split).
async function awardWinners(conn) {
  try {
    const rows = await sheets.readRows({ ...conn, sheetTab: config.awardsTab });
    const names = rows.flatMap((r) => (r[3] || '').split('; ')).map((n) => cleanCompanyName(n)).filter(Boolean);
    return [...new Map(names.map((n) => [squash(n), n])).values()];
  } catch {
    return []; // no awards tab yet
  }
}

// Finds new companies, stores them (unless dryRun) and returns the companies to poll:
// [{ ats, slug, company }]. A rate-limit block during discovery doesn't stop the run.
async function update(conn, today, { dryRun = false, awardsConn = null } = {}) {
  let tab = null;
  let rows = [];
  if (conn && !dryRun) {
    tab = await sheets.openTab(conn, config.hiringCompaniesTab, HEADERS);
    rows = await sheets.readRows(tab);
  } else if (conn) {
    rows = await sheets.readRows({ ...conn, sheetTab: config.hiringCompaniesTab }).catch(() => []);
  }
  const knownIds = new Set(rows.map((r) => `${r[0]}:${r[5]}`));
  const tracked = new Map(rows.filter((r) => r[COL.Status] === TRACKED).map((r) => [`${r[0]}:${r[1]}`, {
    ats: r[0], slug: r[1], company: r[2], history: parseHistory(r[COL['Engineering History']]), lastSpike: r[COL['Last Spike']] || '',
  }]));
  const slugsOf = (ats) => new Set([...tracked.values()].filter((t) => t.ats === ats).map((t) => t.slug));
  const limit = (n) => (dryRun ? Math.min(n, 10) : n);

  let pending = [];
  let added = 0;
  const flush = async () => {
    if (tab) await sheets.appendRows(tab, pending);
    pending = [];
  };
  // Saved in batches so a crash or long rate-limit block doesn't lose what was found.
  const record = async (ats, slug, company, status, website, sourceId, via) => {
    if (status === TRACKED) {
      console.log(`+ ${ats} ${slug} (${company})`);
      tracked.set(`${ats}:${slug}`, { ats, slug, company, history: [], lastSpike: '' });
      added++;
    }
    knownIds.add(`${ats}:${sourceId}`);
    pending.push([ats, slug, company, status, website, sourceId, today, via]);
    if (pending.length >= 10) await flush();
  };

  try {
    const slugs = slugsOf(workable.name);
    const fresh = (await searchWorkable()).filter((c) => !knownIds.has(`${workable.name}:${c.id}`));
    for (const c of fresh.slice(0, limit(config.workableMaxNewPerRun))) {
      const [slug, status] = await resolveWorkable(c, slugs);
      if (slug) slugs.add(slug);
      await record(workable.name, slug, c.title, status, c.website || '', c.id, c.via);
    }
  } catch (err) {
    console.error(`Workable discovery stopped early: ${err.message.slice(0, 120)}`);
  }

  try {
    const slugs = slugsOf(lever.name);
    for (const slug of config.leverCompanies.filter((s) => !knownIds.has(`${lever.name}:starter:${s}`))) {
      const feed = slugs.has(slug) ? null : await lever.probe(slug);
      await sleep(config.hiringDelayMs);
      const status = slugs.has(slug) ? 'already tracked' : feed ? TRACKED : 'no Lever page found';
      if (status === TRACKED) slugs.add(slug);
      const name = slug.charAt(0).toUpperCase() + slug.slice(1);
      await record(lever.name, status === TRACKED ? slug : '', name, status, '', `starter:${slug}`, 'starter list');
    }
    const winners = awardsConn ? (await awardWinners(awardsConn)).filter((n) => !knownIds.has(`${lever.name}:tender:${squash(n)}`)) : [];
    for (const name of winners.slice(0, limit(config.leverMaxNewPerRun))) {
      const [slug, status] = await resolveLever(name, slugs);
      if (slug) slugs.add(slug);
      await record(lever.name, slug, name, status, '', `tender:${squash(name)}`, 'tender award winner');
    }
  } catch (err) {
    console.error(`Lever discovery stopped early: ${err.message.slice(0, 120)}`);
  }

  await flush();
  const list = [...tracked.values()];
  console.log(`Companies: ${added} new, ${list.length} tracked`);
  return { companies: list, newCompanies: added };
}

// Writes today's numbers into each polled company's row. stats: Map "ATS:slug" ->
// { openJobs, openEng, newEng7, trend, topStacks, spiked, history: [{ date, openEng }] }
async function saveStats(conn, stats, today) {
  const tab = { ...conn, sheetTab: config.hiringCompaniesTab };
  const rows = (await sheets.readRows(tab)).map((r) => HEADERS.map((_, i) => r[i] ?? ''));
  for (const r of rows) {
    const s = stats.get(`${r[0]}:${r[1]}`);
    if (!s) continue;
    r[COL['Open Jobs']] = s.openJobs;
    r[COL['Open Engineering']] = s.openEng;
    r[COL['New Engineering Jobs (7 days)']] = s.newEng7;
    r[COL['Hiring Trend']] = s.trend;
    r[COL['Top Stacks']] = s.topStacks;
    if (s.spiked) r[COL['Last Spike']] = today;
    r[COL['Last Checked']] = today;
    r[COL['Engineering History']] = formatHistory(s.history);
  }
  await sheets.writeAll(tab, HEADERS, rows);
}

module.exports = { update, saveStats, HEADERS };
