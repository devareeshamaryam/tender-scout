// Lever public postings API (keyless): every published job of one company, with descriptions,
// in a single request. Lever has no cross-company job search, so companies come from
// companies.js (tender winners + a starter list).

const { getJson } = require('../http');
const { htmlToText } = require('../text');

const API = 'https://api.lever.co/v0/postings';

const careersUrl = (slug) => `https://jobs.lever.co/${slug}`;

// All open jobs of one company. Unknown slugs throw "... 404: ...".
// The API doesn't return the company's name; companies.js keeps it.
async function fetchJobs(slug) {
  const data = await getJson(`${API}/${encodeURIComponent(slug)}?mode=json`, `Lever ${slug}`);
  return {
    slug,
    company: slug,
    jobs: (Array.isArray(data) ? data : []).map((p) => ({
      id: p.id,
      title: p.text || '',
      department: p.categories?.department || p.categories?.team || '',
      function: p.categories?.team || '',
      location: p.categories?.location || (p.workplaceType === 'remote' ? 'Remote' : ''),
      publishedOn: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : '',
      url: p.hostedUrl || '',
      description: [p.descriptionPlain, ...(p.lists || []).map((l) => `${l.text} ${htmlToText(l.content)}`), p.additionalPlain]
        .filter(Boolean).join(' '),
    })),
  };
}

// Number of open jobs, or null if the slug doesn't exist.
async function probe(slug) {
  try {
    const data = await getJson(`${API}/${encodeURIComponent(slug)}?mode=json&limit=100`, `Lever ${slug}`);
    return { name: slug, jobCount: Array.isArray(data) ? data.length : 0 };
  } catch (err) {
    if (/ 404:/.test(err.message)) return null;
    throw err;
  }
}

module.exports = { name: 'Lever', fetchJobs, probe, careersUrl };
