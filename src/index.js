const config = require('./config');
const { fetchOpenTenders } = require('./sources/contractsFinder');
const sheets = require('./sheets');
const slack = require('./slack');

// Pure comparison of today's fetch against what the sheet already holds.
function diff(fetched, rows) {
  const fetchedIds = new Set(fetched.map((n) => n.id));
  const rowsById = new Map(rows.map((r) => [r.id, r]));

  const added = fetched.filter((n) => !rowsById.has(n.id));
  const reopened = fetched.filter((n) => rowsById.get(n.id)?.status === 'Revoked');
  const revoked = rows.filter((r) => r.status === 'Active' && !fetchedIds.has(r.id));
  return { added, reopened, revoked };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const fetched = await fetchOpenTenders(config);

  if (config.dryRun) {
    console.log(`[dry-run] ${fetched.length} open tenders. Sample:`);
    console.table(fetched.slice(0, 5).map((n) => ({ title: n.title.slice(0, 60), buyer: n.buyer, deadline: n.deadline.slice(0, 10) })));
    return;
  }

  const sheet = await sheets.connect(config);
  const rows = await sheets.readRows(sheet);
  const firstRun = rows.length === 0;
  const { added, reopened, revoked } = diff(fetched, rows);

  await sheets.appendTenders(sheet, added, today);
  await sheets.setStatuses(sheet, [
    ...revoked.map((r) => ({ row: r.row, status: 'Revoked', revokedDate: today })),
    ...reopened.map((n) => ({ row: rows.find((r) => r.id === n.id).row, status: 'Active', revokedDate: '' })),
  ]);

  const newOnes = [...added, ...reopened];
  console.log(`New: ${newOnes.length}, Revoked: ${revoked.length}, Active: ${fetched.length}`);

  await slack.post(config.slackWebhookUrl, slack.buildReport({
    date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    added: newOnes,
    revoked,
    activeTotal: fetched.length,
    firstRun,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${config.sheetId}`,
  }));
}

main().catch(async (err) => {
  console.error(err);
  if (!config.dryRun) {
    await slack.post(config.slackWebhookUrl, `⚠️ TenderScout failed: ${err.message}`).catch(() => {});
  }
  process.exit(1);
});
