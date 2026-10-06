const MAX_LISTED = 10;

const money = (n) =>
  n.value === '' ? 'value n/a'
    : new Intl.NumberFormat('en-GB', { style: 'currency', currency: n.currency || 'GBP', maximumFractionDigits: 0 }).format(n.value);

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '¦');

function line(n) {
  return `• <${n.url}|${escape(n.title)}> – ${escape(n.buyer)} – ${money(n)} – closes ${n.deadline.slice(0, 10)}`;
}

function buildReport({ date, added, revoked, activeTotal, firstRun, sheetUrl }) {
  const lines = [`*TenderScout daily report – ${date}*`];
  if (firstRun) {
    lines.push(`📥 Initial load: *${added.length}* open tenders saved to the sheet.`);
  } else {
    lines.push(`🆕 New: *${added.length}*    ❌ Revoked: *${revoked.length}*    📋 Active total: *${activeTotal}*`);
    if (added.length) {
      lines.push('', '*New tenders*', ...added.slice(0, MAX_LISTED).map(line));
      if (added.length > MAX_LISTED) lines.push(`…and ${added.length - MAX_LISTED} more`);
    }
  }
  if (sheetUrl) lines.push('', `<${sheetUrl}|Open Google Sheet>`);
  return lines.join('\n');
}

async function post(webhookUrl, text) {
  if (!webhookUrl) {
    console.log('SLACK_WEBHOOK_URL not set, message would be:\n' + text);
    return;
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, unfurl_links: false }),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
}

module.exports = { buildReport, post };
