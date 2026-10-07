// Apollo.io: find the likely hiring manager at a company that just won a contract.
// Docs: https://docs.apollo.io/reference
//
// Per company: organization search (1 credit) -> people search by title (free)
// -> people match/enrichment for the best N candidates (1 credit each, email + LinkedIn).

const { sleep } = require('./http');

const BASE = 'https://api.apollo.io/api/v1';

async function post(apiKey, path, body, attempt = 1) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
    console.log(`Apollo busy (${res.status}), retrying in ${20 * attempt}s...`);
    await sleep(20000 * attempt);
    return post(apiKey, path, body, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Apollo ${path} ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// "Formula Schools LTD T/A Kayant" -> "Kayant"; "MRI SOFTWARE LIMITED" -> "MRI SOFTWARE"
function cleanCompanyName(name) {
  const tradingAs = name.split(/\s+t\/a\s+/i);
  const base = tradingAs.length > 1 ? tradingAs[1] : name;
  const suffix = /[\s,]+(limited|ltd|plc|llp|llc|inc|gmbh|s\.?r\.?o|s\.?p\.?a|spa|s\.?a|a\/s|k\/s|ab|bv|b\.v|nv|oy|sas|sarl|sp\. z o\.o|pte|uk|group)\.?$/i;
  let cleaned = base.trim();
  // Strip stacked suffixes, e.g. "Xledger UK ltd" -> "Xledger".
  while (suffix.test(cleaned)) cleaned = cleaned.replace(suffix, '').trim();
  return cleaned || base.trim();
}

// Lower index = better hiring-manager match.
function titleRank(title, titles) {
  const t = (title || '').toLowerCase();
  const i = titles.findIndex((wanted) => t.includes(wanted.toLowerCase()));
  return i === -1 ? titles.length : i;
}

async function findCompany(apiKey, supplierName, country) {
  const data = await post(apiKey, '/mixed_companies/search', {
    q_organization_name: cleanCompanyName(supplierName),
    ...(country === 'GBR' ? { organization_locations: ['United Kingdom'] } : {}),
    page: 1,
    per_page: 1,
  });
  return (data.organizations || data.accounts || [])[0] || null;
}

async function findHiringManagers(apiKey, supplierName, { country, titles, perCompany }) {
  const org = await findCompany(apiKey, supplierName, country);
  if (!org) return { org: null, people: [] };

  const search = await post(apiKey, '/mixed_people/api_search', {
    organization_ids: [org.id],
    person_titles: titles,
    page: 1,
    per_page: 25,
  });
  const candidates = (search.people || [])
    .sort((a, b) => titleRank(a.title, titles) - titleRank(b.title, titles))
    .slice(0, perCompany);

  const people = [];
  for (const c of candidates) {
    const match = await post(apiKey, '/people/match', { id: c.id, reveal_personal_emails: false });
    const p = match.person || {};
    people.push({
      id: p.id || c.id,
      name: p.name || [p.first_name || c.first_name, p.last_name].filter(Boolean).join(' '),
      title: p.title || c.title || '',
      email: p.email || '',
      emailStatus: p.email_status || '',
      linkedin: p.linkedin_url || '',
      location: [p.city, p.country].filter(Boolean).join(', '),
    });
  }
  return { org, people };
}

module.exports = { findHiringManagers, cleanCompanyName };
