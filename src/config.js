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
  sheetTab: process.env.SHEET_TAB || 'Tenders',
  // Either the raw JSON key or a path to the key file.
  googleCredentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,

  // KEYWORDS=* and CPV_PREFIXES=* together mean "track every open tender".
  keywords: list(process.env.KEYWORDS, DEFAULT_KEYWORDS),
  cpvPrefixes: list(process.env.CPV_PREFIXES, '72,48'),
  lookbackDays: Number(process.env.LOOKBACK_DAYS || 120),
};
