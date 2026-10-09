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

// "development" alone is left out: it matches "business development".
const DEFAULT_ENGINEERING_KEYWORDS = [
  'engineer', 'engineers', 'engineering', 'developer', 'developers', 'software', 'programmer',
  'devops', 'devsecops', 'sre', 'site reliability', 'architect', 'data scientist', 'machine learning',
  'qa', 'tester', 'test automation', 'sdet', 'frontend', 'front-end', 'front end', 'backend',
  'back-end', 'back end', 'full stack', 'full-stack', 'fullstack', 'mobile', 'ios', 'android',
  'tech lead', 'technical lead', 'cto', 'r&d',
].join(',');

const DEFAULT_STACKS = [
  'python', 'java', 'javascript', 'typescript', 'node.js', 'nodejs', 'react', 'angular', 'vue',
  'golang', 'rust', '.net', 'c#', 'c++', 'php', 'ruby', 'kotlin', 'swift', 'scala',
  'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'terraform',
  'spark', 'snowflake', 'databricks', 'machine learning', 'llm',
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

  // Proposal drafts: Claude writes a tailored email per signal and posts it to Slack for
  // review. Nothing is sent automatically. Skipped when ANTHROPIC_API_KEY is not set.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  proposalsPerRun: Number(process.env.PROPOSALS_PER_RUN || 20),
  // A hiring-spike company gets at most one draft in this many days.
  proposalCooldownDays: Number(process.env.PROPOSAL_COOLDOWN_DAYS || 30),
  // Who the emails are from and what they offer - Claude only claims what is written here.
  proposalSenderProfile: process.env.PROPOSAL_SENDER_PROFILE
    || 'Ateca (ateca.co.uk), a UK technology recruitment and resourcing partner. We help companies hire software engineers, data and cloud specialists on permanent and contract terms, and can stand up delivery teams quickly when a new contract starts.',

  // Hiring velocity: daily poll of public job feeds (Workable, Lever) of every company found.
  // Its tabs live in their own spreadsheet, optionally with their own service account;
  // both fall back to the tender sheet/key.
  hiringSheetId: process.env.HIRING_SHEET_ID || process.env.SHEET_ID,
  hiringGoogleCredentials: process.env.HIRING_GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  hiringCompaniesTab: process.env.HIRING_COMPANIES_TAB || 'Hiring Companies',
  hiringJobsTab: process.env.HIRING_JOBS_TAB || 'Hiring Jobs',
  // Pause between requests. Workable takes bursts at ~1/s but rate-limits that pace after
  // a few hundred requests, so the default stays well under it.
  hiringDelayMs: Number(process.env.HIRING_DELAY_MS || 2000),

  // Workable companies are found automatically: each run searches jobs.workable.com for these
  // queries in these locations and starts tracking any new hiring company.
  workableLocations: list(process.env.WORKABLE_LOCATIONS, 'United Kingdom'),
  workableQueries: list(process.env.WORKABLE_QUERIES, 'software engineer,developer,devops,data engineer,engineering manager'),
  workableSearchPages: Number(process.env.WORKABLE_SEARCH_PAGES || 10),
  // New companies looked up per run (each costs up to 4 requests); the rest wait for the next run.
  workableMaxNewPerRun: Number(process.env.WORKABLE_MAX_NEW_PER_RUN || 60),

  // Lever has no cross-company search. Companies come from tender award winners (checked
  // for a Lever page) plus these starter slugs (jobs.lever.co/<slug>).
  leverCompanies: list(process.env.LEVER_COMPANIES, 'palantir,spotify,zopa,scottlogic,veeva,sonarsource,shieldai,outreach,dnb'),
  // Award winners checked for a Lever page per run; the rest wait for the next run.
  leverMaxNewPerRun: Number(process.env.LEVER_MAX_NEW_PER_RUN || 100),
  // A job counts as engineering if one of these is in its title, department or function.
  engineeringKeywords: list(process.env.ENGINEERING_KEYWORDS, DEFAULT_ENGINEERING_KEYWORDS),
  // Tech stacks looked for in new job titles + descriptions.
  stacks: list(process.env.STACKS, DEFAULT_STACKS),
  // Spike: open engineering jobs >= SPIKE_RATIO x baseline AND up by >= SPIKE_MIN_INCREASE.
  // Baseline = median of the company's last BASELINE_DAYS daily snapshots (needs 3+).
  spikeRatio: Number(process.env.SPIKE_RATIO || 1.5),
  spikeMinIncrease: Number(process.env.SPIKE_MIN_INCREASE || 3),
  baselineDays: Number(process.env.BASELINE_DAYS || 14),
  // Burst: this many new engineering jobs in the last 7 days.
  burstMinNewEng: Number(process.env.BURST_MIN_NEW_ENG || 5),
  // Stack spike: this many new jobs mentioning the same stack in the last 7 days.
  stackSpikeMin: Number(process.env.STACK_SPIKE_MIN || 3),
};
