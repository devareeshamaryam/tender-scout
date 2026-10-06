// Contracts Finder open tenders via the public OCDS search API (no key needed).
// Docs: https://www.contractsfinder.service.gov.uk/apidocumentation

const BASE = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search';
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, attempt = 1) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.text();

  // The API allows ~12 requests per window and replies
  // "Rate limit of 12 exceeded. Please retry after 120 seconds."
  const rateLimit = body.match(/Rate limit.*?retry after (\d+) seconds/i);
  if ((rateLimit || res.status === 429 || res.status >= 500) && attempt <= 5) {
    const waitSec = rateLimit ? Number(rateLimit[1]) + 5 : 10 * attempt;
    console.log(`Contracts Finder busy (${res.status}), retrying in ${waitSec}s...`);
    await sleep(waitSec * 1000);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Contracts Finder ${res.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

function noticeUrl(release) {
  const doc = (release.tender.documents || []).find(
    (d) => d.documentType === 'tenderNotice' && d.url,
  );
  if (doc) return doc.url;
  // Release ids look like "<notice-guid>-<sequence>".
  return `https://www.contractsfinder.service.gov.uk/Notice/${release.id.replace(/-\d+$/, '')}`;
}

function normalise(release) {
  const t = release.tender;
  const address = t.items?.[0]?.deliveryAddresses?.[0] || {};
  const cpvs = [t.classification, ...(t.additionalClassifications || [])]
    .filter((c) => c && c.scheme === 'CPV')
    .map((c) => c.id);
  return {
    id: release.ocid,
    title: t.title || '',
    description: t.description || '',
    buyer: release.buyer?.name || '',
    value: t.value?.amount ?? '',
    currency: t.value?.currency || '',
    deadline: t.tenderPeriod?.endDate || '',
    published: t.datePublished || release.date || '',
    region: address.region || address.postalCode || '',
    cpv: cpvs.join(', '),
    url: noticeUrl(release),
    status: t.status,
    releaseDate: release.date,
  };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildMatcher({ keywords, cpvPrefixes }) {
  if (!keywords.length && !cpvPrefixes.length) return () => true;
  const kw = keywords.length
    ? new RegExp(`\\b(${keywords.map(escapeRegex).join('|')})\\b`, 'i')
    : null;
  return (n) =>
    (kw && kw.test(`${n.title} ${n.description}`)) ||
    n.cpv.split(', ').some((c) => cpvPrefixes.some((p) => c.startsWith(p)));
}

async function fetchOpenTenders(config) {
  const from = new Date(Date.now() - config.lookbackDays * 864e5).toISOString().slice(0, 19);
  let url = `${BASE}?stages=tender&limit=${PAGE_SIZE}&publishedFrom=${from}`;

  const byId = new Map();
  let pages = 0;
  while (url) {
    const data = await getJson(url);
    for (const release of data.releases || []) {
      if (!release.tender) continue;
      const n = normalise(release);
      const existing = byId.get(n.id);
      // Keep the latest release per contract (amendments replace earlier versions).
      if (!existing || Date.parse(n.releaseDate) > Date.parse(existing.releaseDate)) byId.set(n.id, n);
    }
    pages += 1;
    url = data.releases?.length ? data.links?.next : null;
    if (url) await sleep(PAGE_DELAY_MS);
  }

  // An empty feed means the source is broken, not that every tender closed
  // overnight. Fail loudly instead of marking the whole sheet as revoked.
  if (!byId.size) throw new Error('Contracts Finder returned no tenders; skipping sheet update');

  const now = new Date();
  const matches = buildMatcher(config);
  const open = [...byId.values()].filter(
    (n) => n.status === 'active' && n.deadline && new Date(n.deadline) > now && matches(n),
  );
  console.log(`Contracts Finder: ${pages} pages, ${byId.size} tenders, ${open.length} open & matching`);
  return open;
}

module.exports = { fetchOpenTenders };
