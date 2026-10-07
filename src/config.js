require('dotenv').config();

// Unset/empty -> fallback list; "*" -> no filter (track everything).
function list(value, fallback) {
  const raw = value && value.trim() ? value.trim() : fallback;
  if (raw === '*') return [];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Matched as whole words/phrases against title + description.
const DEFAULT_KEYWORDS = [
  'software', 'digital', 'developer', 'cloud', 'cyber', 'data',
  'systems integration', 'system integrator', 'technology',
  'it services', 'it support', 'ict', 'erp', 'crm', 'saas', 'devops',
  'recruitment', 'staffing', 'resourcing',
  // Software / IT engineering
  'software engineering', 'software engineer', 'software engineers',
  'software development', 'application development', 'web development',
  'app development', 'data engineering', 'data engineer', 'cloud engineering',
  'platform engineering', 'systems engineering', 'systems engineer',
  'network engineering', 'network engineer', 'security engineering',
  'site reliability', 'devsecops', 'kubernetes', 'aws', 'azure', 'microservices',
  'api', 'apis', 'machine learning', 'artificial intelligence', 'ai',
  'automation', 'it infrastructure', 'digital transformation', 'software testing',
].join(',');

module.exports = {
  dryRun: process.argv.includes('--dry-run'),

  sheetId: process.env.SHEET_ID,
  // Either the raw JSON key or a path to the key file.
  googleCredentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,

  // IT relevance filter. KEYWORDS=* and CPV_PREFIXES=* together mean "keep every award".
  keywords: list(process.env.KEYWORDS, DEFAULT_KEYWORDS),
  cpvPrefixes: list(process.env.CPV_PREFIXES, '72,48'),

  // Winning contracts from Contracts Finder, Find a Tender and TED.
  awardsTab: process.env.AWARDS_TAB || 'Award Signals',
  // Each run re-reads this many days of awards; already-saved ones are skipped.
  awardLookbackDays: Number(process.env.AWARD_LOOKBACK_DAYS || 7),
  // Minimum award value in GBP (other currencies converted approximately).
  // Awards with no published value are kept.
  awardMinGbp: process.env.AWARD_MIN_GBP?.trim() ? Number(process.env.AWARD_MIN_GBP) : 250000,
  // TED buyer countries as ISO3 codes (e.g. IRL,NLD,DEU). Empty = all.
  tedCountries: list(process.env.TED_COUNTRIES, '*'),

  // Apollo enrichment of the likely hiring manager at each new award winner.
  // Skipped when APOLLO_API_KEY is not set.
  apolloApiKey: process.env.APOLLO_API_KEY,
  hiringManagersTab: process.env.HIRING_MANAGERS_TAB || 'Hiring Managers',
  // Credit control: ~1 credit per company + 1 per contact revealed.
  apolloMaxCompaniesPerRun: Number(process.env.APOLLO_MAX_COMPANIES_PER_RUN || 10),
  apolloContactsPerCompany: Number(process.env.APOLLO_CONTACTS_PER_COMPANY || 2),
  // In priority order: people who buy recruitment first, then delivery/engineering leads.
  apolloTitles: list(process.env.APOLLO_TITLES, [
    'head of talent acquisition', 'talent acquisition manager', 'head of recruitment',
    'recruitment manager', 'head of resourcing', 'resourcing manager',
    'head of people', 'hr director', 'delivery director', 'head of delivery',
    'head of engineering', 'engineering manager', 'cto',
  ].join(',')),
};
