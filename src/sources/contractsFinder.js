// Contracts Finder award notices (who won) via the public OCDS search API (no key needed).
// Docs: https://www.contractsfinder.service.gov.uk/apidocumentation

const { getJson, sleep } = require('../http');

const BASE = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search';

function normalise(release) {
  const t = release.tender || {};
  const awards = (release.awards || []).filter((a) => a.status !== 'cancelled' && a.status !== 'unsuccessful');
  if (!awards.length) return null;
  const suppliers = [...new Set(awards.flatMap((a) => (a.suppliers || []).map((s) => s.name)).filter(Boolean))];
  const values = awards.map((a) => a.value?.amount).filter((v) => typeof v === 'number');
  const doc = awards.flatMap((a) => a.documents || []).find((d) => d.documentType === 'awardNotice' && d.url);
  const cpvs = [t.classification, ...(t.additionalClassifications || [])].filter((c) => c?.scheme === 'CPV').map((c) => c.id);
  return {
    source: 'Contracts Finder',
    id: release.ocid,
    title: t.title || '',
    description: t.description || '',
    buyer: release.buyer?.name || '',
    suppliers: suppliers.join('; '),
    value: values.length ? values.reduce((a, b) => a + b, 0) : '',
    currency: awards.find((a) => a.value?.currency)?.value.currency || 'GBP',
    awardDate: (awards[0].date || release.date || '').slice(0, 10),
    country: 'GBR',
    cpv: cpvs.join(', '),
    url: doc?.url || `https://www.contractsfinder.service.gov.uk/Notice/${release.id.replace(/-\d+$/, '')}`,
  };
}

async function fetchAwards(since) {
  let url = `${BASE}?stages=award&limit=100&publishedFrom=${since.toISOString().slice(0, 19)}`;
  const byId = new Map();
  let pages = 0;
  while (url) {
    const data = await getJson(url, 'Contracts Finder');
    for (const release of data.releases || []) {
      const a = normalise(release);
      if (a && a.suppliers) byId.set(a.id, a);
    }
    pages += 1;
    url = data.releases?.length ? data.links?.next : null;
    if (url) await sleep(300);
  }
  console.log(`Contracts Finder: ${pages} pages, ${byId.size} awards`);
  return [...byId.values()];
}

module.exports = { fetchAwards };
