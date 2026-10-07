// Workable public job feeds (keyless).
// - Widget feed: every published job of one company, with descriptions. One request per company.
// - jobs.workable.com search: used by companies.js to find hiring companies.
// Both allow roughly one request per second; http.js backs off on 429.

const { getJson } = require('../http');
const { htmlToText } = require('../text');

const WIDGET_API = 'https://apply.workable.com/api/v1/widget/accounts';
const SEARCH_API = 'https://jobs.workable.com/api/v1/jobs';

const careersUrl = (slug) => `https://apply.workable.com/${slug}/`;

// All open jobs of one company. Unknown slugs throw "... 404: ...".
async function fetchJobs(slug) {
  const data = await getJson(`${WIDGET_API}/${encodeURIComponent(slug)}?details=true`, `Workable ${slug}`);
  return {
    slug,
    company: data.name || slug,
    jobs: (data.jobs || []).map((j) => ({
      id: j.shortcode,
      title: j.title || '',
      department: j.department || '',
      function: j.function || '',
      location: [j.city, j.country].filter(Boolean).join(', ') || (j.telecommuting ? 'Remote' : ''),
      publishedOn: j.published_on || '',
      url: j.url || j.shortlink || '',
      description: htmlToText(j.description),
    })),
  };
}

// Number of open jobs (no descriptions) or null if the slug doesn't exist.
async function probe(slug) {
  try {
    const data = await getJson(`${WIDGET_API}/${encodeURIComponent(slug)}`, `Workable ${slug}`);
    return { name: data.name || slug, jobCount: (data.jobs || []).length };
  } catch (err) {
    if (/ 404:/.test(err.message)) return null;
    throw err;
  }
}

// One page of jobs.workable.com search results.
async function searchJobs(query, location, pageToken) {
  const params = new URLSearchParams({ query, location });
  if (pageToken) params.set('pageToken', pageToken);
  const data = await getJson(`${SEARCH_API}?${params}`, 'Workable search');
  return { jobs: data.jobs || [], nextPageToken: data.nextPageToken || null };
}

module.exports = { name: 'Workable', fetchJobs, probe, searchJobs, careersUrl };
