// TenderScout: daily "who won IT contracts" report.
// Award notices from Contracts Finder, Find a Tender and TED -> filter -> Google Sheet
// -> (optional) Apollo hiring-manager lookup -> Slack summary.

const config = require('./config');
const contractsFinder = require('./sources/contractsFinder');
const findTender = require('./sources/findTender');
const ted = require('./sources/ted');
const { buildMatcher } = require('./filter');
const { toGbp } = require('./fx');
const apollo = require('./apollo');
const sheets = require('./sheets');
const slack = require('./slack');

const AWARD_HEADERS = [
  'Source', 'Notice ID', 'Award Date', 'Supplier(s)', 'Buyer', 'Title', 'Value',
  'Currency', 'Value (GBP approx)', 'Buyer Country', 'CPV', 'Link', 'First Seen',
];

const HM_HEADERS = [
  'Supplier', 'Award Notice ID', 'Award Title', 'Award Value (GBP approx)', 'Apollo Company',
  'Domain', 'Name', 'Title', 'Email', 'Email Status', 'LinkedIn', 'Location', 'Apollo Person ID', 'Found On',
];

// Re-read the last few days of award notices from every source and keep the
// relevant, large ones. Each source runs independently so one failing doesn't block the rest.
async function fetchAwards() {
  const since = new Date(Date.now() - config.awardLookbackDays * 864e5);
  const sources = [
    ['Contracts Finder', () => contractsFinder.fetchAwards(since)],
    ['Find a Tender', () => findTender.fetchAwards(since)],
    ['TED', () => ted.fetchAwards({ since, cpvPrefixes: config.cpvPrefixes, countries: config.tedCountries })],
  ];
  const all = [];
  const errors = [];
  for (const [name, fetchFn] of sources) {
    try {
      all.push(...(await fetchFn()));
    } catch (err) {
      console.error(`${name} failed:`, err);
      errors.push(`${name}: ${err.message}`);
    }
  }
  if (errors.length === sources.length) throw new Error(`All sources failed - ${errors.join('; ')}`);

  const matches = buildMatcher(config);
  const awards = all
    .map((a) => ({ ...a, valueGbp: toGbp(a.value, a.currency) }))
    .filter((a) => matches(a) && (a.valueGbp === null || a.valueGbp >= config.awardMinGbp))
    .sort((a, b) => (b.valueGbp ?? -1) - (a.valueGbp ?? -1));
  console.log(`Awards: ${all.length} fetched, ${awards.length} relevant & >= £${config.awardMinGbp}`);
  return { awards, errors };
}

// Append awards not already in the sheet; returns the new ones.
async function saveAwards(conn, awards, today) {
  const tab = await sheets.openTab(conn, config.awardsTab, AWARD_HEADERS);
  const existing = new Set(await sheets.readColumn(tab, 'B'));
  const added = awards.filter((a) => !existing.has(a.id));
  await sheets.appendRows(tab, added.map((a) => [
    a.source, a.id, a.awardDate, a.suppliers, a.buyer, a.title, a.value, a.currency,
    a.valueGbp ?? '', a.country, a.cpv, a.url, today,
  ]));
  return { added, firstRun: existing.size === 0 };
}

// For the biggest new award winners, find the likely hiring manager in Apollo.
// Each supplier is looked up once ever (misses are recorded too) to save credits.
async function findHiringManagers(conn, awards, today) {
  // One entry per supplier, keeping its biggest new award (awards are sorted by value).
  const bySupplier = new Map();
  for (const a of awards) {
    for (const supplier of a.suppliers.split('; ').filter(Boolean)) {
      const key = supplier.toLowerCase();
      if (!bySupplier.has(key)) bySupplier.set(key, { supplier, award: a });
    }
  }

  const tab = await sheets.openTab(conn, config.hiringManagersTab, HM_HEADERS);
  const done = new Set((await sheets.readColumn(tab, 'A')).map((x) => x.toLowerCase()));
  const queue = [...bySupplier.entries()].filter(([key]) => !done.has(key))
    .slice(0, config.apolloMaxCompaniesPerRun);

  const rows = [];
  const found = [];
  for (const [, { supplier, award }] of queue) {
    const base = [supplier, award.id, award.title, award.valueGbp ?? ''];
    try {
      const { org, people } = await apollo.findHiringManagers(config.apolloApiKey, supplier, {
        country: award.country, titles: config.apolloTitles, perCompany: config.apolloContactsPerCompany,
      });
      if (!people.length) {
        rows.push([...base, org?.name || '', org?.primary_domain || '', '', org ? 'No matching contact' : 'No Apollo company match', '', '', '', '', '', today]);
        continue;
      }
      for (const p of people) {
        rows.push([...base, org.name, org.primary_domain || '', p.name, p.title, p.email, p.emailStatus, p.linkedin, p.location, p.id, today]);
        found.push({ ...p, company: org.name, award });
      }
    } catch (err) {
      // Plan/key problems affect every lookup - stop and report once.
      if (/API_INACCESSIBLE|401|403/.test(err.message)) {
        await sheets.appendRows(tab, rows);
        throw new Error(`Apollo API not available on this plan/key (${err.message.match(/"error":"([^"]+)/)?.[1] || err.message})`);
      }
      // Not recorded, so it's retried next run.
      console.error(`Apollo lookup failed for ${supplier}:`, err.message);
    }
  }
  await sheets.appendRows(tab, rows);
  console.log(`Hiring managers: ${queue.length} companies looked up, ${found.length} contacts found`);
  return { added: found, companies: queue.length };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const { awards, errors } = await fetchAwards();

  if (config.dryRun) {
    console.log(`\n[dry-run] ${awards.length} award signals. Top 10 by value:`);
    console.table(awards.slice(0, 10).map((a) => ({ source: a.source, supplier: a.suppliers.slice(0, 30), title: a.title.slice(0, 45), gbp: a.valueGbp })));
    return;
  }

  const conn = await sheets.connect(config);
  const awardsResult = { ...(await saveAwards(conn, awards, today)), errors };
  console.log(`New awards: ${awardsResult.added.length}`);

  let hiring = null;
  if (!config.apolloApiKey) {
    console.log('APOLLO_API_KEY not set - skipping hiring-manager lookup');
  } else if (awardsResult.added.length) {
    try {
      hiring = await findHiringManagers(conn, awardsResult.added, today);
    } catch (err) {
      console.error('Hiring managers failed:', err);
      hiring = { error: err.message };
    }
  }

  await slack.post(config.slackWebhookUrl, slack.buildReport({
    date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    awards: awardsResult,
    hiring,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${config.sheetId}`,
  }));

  if (errors.length || hiring?.error) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  if (!config.dryRun) {
    await slack.post(config.slackWebhookUrl, `⚠️ TenderScout failed: ${err.message}`).catch(() => {});
  }
  process.exit(1);
});
