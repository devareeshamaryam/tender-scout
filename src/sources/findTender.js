// Find a Tender (UK above-threshold) award notices via its public OCDS API (no key needed).
// Docs: https://www.find-tender.service.gov.uk/Developer/Documentation
//
// The API's `stages` filter misses most Procurement Act notices, so we read
// every release updated since `since` and keep the award notices.

const { getJson, sleep } = require('../http');

const BASE = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';

function cpvCodes(t) {
  const fromItems = (t.items || []).flatMap((i) => [i.classification, ...(i.additionalClassifications || [])]);
  return [...new Set(
    [t.classification, ...(t.additionalClassifications || []), ...fromItems]
      .filter((c) => c && c.scheme === 'CPV' && c.id)
      .map((c) => c.id),
  )];
}

// One row per procurement, suppliers and values combined across lots.
function normalise(r) {
  const awards = (r.awards || []).filter((a) => a.status === 'active' || a.status === 'pending');
  const suppliers = [...new Set(awards.flatMap((a) => (a.suppliers || []).map((x) => x.name)).filter(Boolean))];
  if (!suppliers.length) return null;
  const contractValues = (r.contracts || []).map((c) => c.value?.amount).filter((v) => typeof v === 'number');
  const awardValues = awards.map((a) => a.value?.amount).filter((v) => typeof v === 'number');
  const values = contractValues.length ? contractValues : awardValues;
  const t = r.tender || {};
  const signed = (r.contracts || []).map((c) => c.dateSigned).find(Boolean);
  return {
    source: 'Find a Tender',
    id: r.ocid,
    title: t.title || '',
    description: t.description || '',
    buyer: r.buyer?.name || '',
    suppliers: suppliers.join('; '),
    value: values.length ? values.reduce((a, b) => a + b, 0) : (t.value?.amount ?? ''),
    currency: (r.contracts || []).find((c) => c.value?.currency)?.value.currency || t.value?.currency || 'GBP',
    awardDate: (signed || awards.find((a) => a.date)?.date || r.date || '').slice(0, 10),
    country: 'GBR',
    cpv: cpvCodes(t).join(', '),
    url: `https://www.find-tender.service.gov.uk/Notice/${r.id}`,
  };
}

async function fetchAwards(since) {
  let url = `${BASE}?limit=100&updatedFrom=${since.toISOString().slice(0, 19)}`;
  const byId = new Map();
  let pages = 0;
  while (url) {
    const data = await getJson(url, 'Find a Tender');
    for (const r of data.releases || []) {
      if (!(r.tag || []).includes('award')) continue;
      const a = normalise(r);
      if (a) byId.set(a.id, a);
    }
    pages += 1;
    if (pages % 10 === 0) console.log(`Find a Tender: ${pages} pages read...`);
    url = data.releases?.length ? data.links?.next : null;
    if (url) await sleep(300);
  }
  console.log(`Find a Tender: ${pages} pages, ${byId.size} awards`);
  return [...byId.values()];
}

module.exports = { fetchAwards };
