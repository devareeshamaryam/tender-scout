// TED (EU Tenders Electronic Daily) contract award notices via the public
// search API v3 (no key needed). Filtering by date, notice type and CPV is
// done server-side. Docs: https://docs.ted.europa.eu/api/latest/search.html

const { sleep } = require('../http');

const URL = 'https://api.ted.europa.eu/v3/notices/search';
const FIELDS = [
  'publication-number', 'notice-title', 'buyer-name', 'organisation-country-buyer',
  'winner-name', 'total-value', 'total-value-cur', 'tender-value',
  'winner-decision-date', 'publication-date', 'classification-cpv',
];

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
// Multilingual fields look like { "pol": ["Name"] } - take the first language.
const firstLang = (obj) => (obj ? Object.values(obj)[0] : []);
const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

function buildQuery({ since, cpvPrefixes, countries }) {
  const parts = [
    `publication-date>=${ymd(since)}`,
    'notice-type IN (can-standard can-social can-desg can-tran)',
  ];
  if (cpvPrefixes.length) parts.push(`(${cpvPrefixes.map((p) => `classification-cpv=${p}*`).join(' OR ')})`);
  if (countries.length) parts.push(`organisation-country-buyer IN (${countries.map((c) => c.toUpperCase()).join(' ')})`);
  return parts.join(' AND ');
}

async function search(body, attempt = 1) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt <= 5) {
    console.log(`TED busy (${res.status}), retrying in ${15 * attempt}s...`);
    await sleep(15000 * attempt);
    return search(body, attempt + 1);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`TED ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

function normalise(n) {
  const pub = n['publication-number'];
  const title = n['notice-title'] || {};
  return {
    source: 'TED',
    id: pub,
    title: title.eng || Object.values(title)[0] || '',
    description: '',
    buyer: firstLang(n['buyer-name'])[0] || '',
    suppliers: [...new Set(firstLang(n['winner-name']))].join('; '),
    value: n['total-value'] ?? asArray(n['tender-value'])[0] ?? '',
    currency: asArray(n['total-value-cur'])[0] || 'EUR',
    awardDate: (asArray(n['winner-decision-date'])[0] || n['publication-date'] || '').slice(0, 10),
    country: asArray(n['organisation-country-buyer'])[0] || '',
    cpv: [...new Set(asArray(n['classification-cpv']))].join(', '),
    url: `https://ted.europa.eu/en/notice/-/detail/${pub}`,
  };
}

async function fetchAwards({ since, cpvPrefixes, countries }) {
  const query = buildQuery({ since, cpvPrefixes, countries });
  const awards = [];
  let token;
  let pages = 0;
  do {
    const data = await search({
      query, fields: FIELDS, limit: 250, paginationMode: 'ITERATION',
      ...(token ? { iterationNextToken: token } : {}),
    });
    awards.push(...(data.notices || []).map(normalise));
    token = data.notices?.length ? data.iterationNextToken : null;
    pages += 1;
  } while (token);
  const withWinner = awards.filter((a) => a.suppliers);
  console.log(`TED: ${pages} pages, ${awards.length} notices, ${withWinner.length} with a named winner`);
  return withWinner;
}

module.exports = { fetchAwards };
