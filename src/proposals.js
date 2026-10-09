// Claude drafts a short, tailored outreach proposal for one signal (a contract award or a
// hiring spike) and one likely hiring manager. Drafts are only posted to Slack for a person
// to review and send - nothing is emailed automatically. Targeted, relevant, opt-out B2B
// outreach is what PECR (UK), PDPA (SG) and PDPO (HK) direct-marketing rules allow.

const Anthropic = require('@anthropic-ai/sdk').default;
const config = require('./config');

const MODEL = 'claude-opus-5-5';

// Stable across calls, so it stays first in the prompt.
const SYSTEM = `You write first-touch B2B outreach emails for a business-development team. Each email goes to one named person at one company, triggered by one specific, verifiable signal (a public contract award or a jump in that company's engineering job postings). A human reviews every draft before anything is sent.

Rules:
- Open with the specific signal: name the contract (and buyer) or the hiring increase, with the concrete numbers given. Never invent facts, figures, clients, case studies or results that are not in the input.
- Connect the signal to one concrete way the sender can help, using only what the sender profile says they offer.
- 90-150 words in the body, plain text, no bullet lists, no exclamation marks, no buzzwords, British English.
- One low-pressure call to action (e.g. a 15-minute call), not a hard sell.
- If no contact name is given, address the email to the role (e.g. "Hello,") and keep it relevant to the team that would own the hiring.
- End the body with this exact line on its own: "If this isn't relevant, just reply 'no thanks' and I won't contact you again."
- Subject: under 60 characters, specific to the signal, no clickbait.`;

const SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
};

let client = null;
const getClient = () => (client ??= new Anthropic());

// Facts Claude may use, as plain text. signal: { kind: 'award' | 'hiring', company, ... }
function describeSignal(signal) {
  if (signal.kind === 'award') {
    const a = signal.award;
    return [
      `Signal: ${signal.company} has just won a public contract.`,
      `Contract: ${a.title}`,
      `Buyer: ${a.buyer}`,
      a.valueGbp ? `Approximate value: £${Math.round(a.valueGbp).toLocaleString('en-GB')}` : '',
      a.awardDate ? `Award date: ${a.awardDate}` : '',
      `Notice: ${a.url}`,
    ].filter(Boolean).join('\n');
  }
  const h = signal.alert;
  return [
    `Signal: ${signal.company} is increasing its engineering hiring (jobs on ${h.ats}).`,
    h.baseline != null ? `Open engineering roles: ${h.baseline} -> ${h.openEng} (recent normal level -> today)` : `Open engineering roles today: ${h.openEng}`,
    h.newEng ? `New engineering jobs in the last 7 days: ${h.newEng}` : '',
    h.hotStacks.length ? `Technologies in the new postings: ${h.hotStacks.map(([s, n]) => `${s} (${n} jobs)`).join(', ')}` : '',
    h.latest.length ? `Recent job titles: ${h.latest.map((j) => j.title).join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

// Returns { subject, body }. Throws on API errors or a refused/unparseable response.
async function draft(signal, contact) {
  const recipient = contact?.name
    ? `Recipient: ${contact.name}, ${contact.title || 'unknown title'} at ${signal.company}`
    : `Recipient: name unknown - the person responsible for hiring at ${signal.company}`;

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    // If a safety classifier declines, the API retries on a suitable fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Sender profile:\n${config.proposalSenderProfile}\n\n${recipient}\n\n${describeSignal(signal)}\n\nWrite the email.`,
    }],
  });

  if (response.stop_reason === 'refusal') throw new Error(`Claude declined (${response.stop_details?.category || 'no category'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of tokens');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text);
  return { subject: out.subject.trim(), body: out.body.trim() };
}

module.exports = { draft, describeSignal };
