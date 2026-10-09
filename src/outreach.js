// Hiring-manager leg: signal (award or hiring spike) -> likely hiring manager (Apollo)
// -> Claude-drafted proposal -> Slack, for a person to review and send. Nothing is emailed:
// human approval stays mandatory. Capped per run - a few targeted drafts beat volume.

const Anthropic = require('@anthropic-ai/sdk').default;
const config = require('./config');
const apollo = require('./apollo');
const proposals = require('./proposals');
const slack = require('./slack');

async function findContact(signal) {
  if (signal.contact || !signal.lookup || !config.apolloApiKey) return signal.contact || null;
  try {
    const { people } = await apollo.findHiringManagers(config.apolloApiKey, signal.company, {
      country: signal.country, titles: config.apolloTitles, perCompany: 1,
    });
    return people[0] || null;
  } catch (err) {
    console.error(`Apollo lookup failed for ${signal.company}:`, err.message.slice(0, 120));
    return null;
  }
}

// signals: [{ kind: 'award' | 'hiring', company, award | alert, contact?, lookup, country? }],
// strongest first. Returns { drafted: [{ signal, contact, proposal }], errors, skipped } or
// null when Claude isn't configured.
async function run(signals) {
  if (!config.anthropicApiKey) {
    console.log('ANTHROPIC_API_KEY not set - skipping proposal drafts');
    return null;
  }
  const picked = signals.slice(0, config.proposalsPerRun);
  const drafted = [];
  const errors = [];
  for (const signal of picked) {
    const contact = await findContact(signal);
    try {
      const proposal = await proposals.draft(signal, contact);
      await slack.post(config.slackWebhookUrl, slack.buildProposal({ signal, contact, proposal }));
      drafted.push({ signal, contact, proposal });
    } catch (err) {
      // A bad key or no credit affects every draft - stop and report once.
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        errors.push(`Claude API key rejected: ${err.message.slice(0, 120)}`);
        break;
      }
      console.error(`Proposal for ${signal.company} failed:`, err.message);
      errors.push(`${signal.company}: ${err.message.slice(0, 120)}`);
    }
  }
  console.log(`Proposals: ${drafted.length} drafted, ${errors.length} failed, ${signals.length - picked.length} over the per-run cap`);
  return { drafted, errors, skipped: signals.length - picked.length };
}

module.exports = { run };
