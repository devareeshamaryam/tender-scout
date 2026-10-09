# TenderScout

Every day, TenderScout finds out **who just won IT contracts** in UK and EU public procurement, saves the winners to a Google Sheet, and posts a summary in Slack. A company that has just won a big contract is about to hire.

```
TenderScout – who won IT contracts – 07 Oct 2026

🏆 New winning contracts: 41
• KPMG LLP; ERNST & YOUNG LLP won Centralised Civil Service Learning… – Cabinet Office (Find a Tender) – ≈£380m
• Neit Consulting s.r.o. won Czechia – IT services: consulting… – MPSV (TED, CZE) – ≈£139m
…

👤 Hiring managers (Apollo, for the biggest new winners)
• Jane Doe – Head of Talent Acquisition @ MRI Software – jane@… (won: Homeswapper software)
```

## Sources (all public APIs, no key needed)

| Source | What | How |
|---|---|---|
| [Contracts Finder](https://www.contractsfinder.service.gov.uk/) | UK award notices (mostly below threshold) | OCDS search, `stages=award` |
| [Find a Tender](https://www.find-tender.service.gov.uk/) | UK award notices (above threshold) | OCDS release feed; award notices picked out of all releases |
| [TED](https://ted.europa.eu/) | EU contract award notices | Search API v3; IT category codes filtered on the server |

Each run re-reads the last `AWARD_LOOKBACK_DAYS` (default 7) days and appends only the awards that aren't already in the sheet. A missed day catches up automatically. A run takes about 4 minutes, mostly because the Find a Tender API allows about 12 requests every 2 minutes.

**An award is kept if** it matches the IT keyword or IT CPV filter **and** is worth at least `AWARD_MIN_GBP` (default £250k). Other currencies are converted with the approximate rates in `src/fx.js`. Awards with no published value are kept.

## Google Sheet tabs

- **Award Signals**: Source, Notice ID, Award Date, Supplier(s), Buyer, Title, Value, Currency, Value (GBP approx), Buyer Country, CPV, Link, First Seen.
- **Hiring Managers** (only when `APOLLO_API_KEY` is set): the contacts found for each winner.

Both tabs are created automatically on the first run.

## Hiring managers (Apollo, optional, needs a paid plan)

For the biggest new winners, up to `APOLLO_MAX_COMPANIES_PER_RUN` (default 10) per day:

1. **Find the company:** organization search by the supplier's name, with suffixes like Ltd/plc stripped and "X T/A Y" turned into "Y". UK awards are limited to UK companies. Costs 1 credit.
2. **Find people:** people search there for `APOLLO_TITLES`, ranked in the order listed (talent acquisition and resourcing first, then delivery and engineering leads). Free.
3. **Reveal contacts:** people match for the top `APOLLO_CONTACTS_PER_COMPANY` (default 2), which returns full name, work email, email status and LinkedIn. Costs 1 credit each.

Each supplier is looked up **once ever**. "No match" results are recorded too, so credits aren't wasted. The people search and people match APIs are **not available on Apollo's Free plan**. If the key can't use them, the bot posts a single ⚠️ line and carries on.

> These are personal data (UK GDPR / PECR). Keep the sheet access-restricted, and review contacts before anyone sends outreach.

## Hiring velocity (Workable + Lever)

A second daily job (`npm run hiring`) watches **which companies are ramping up engineering hiring**. Every day it reads the public, keyless job feed of each company it tracks, one request per second:

| ATS | Job feed (one request per company) |
|---|---|
| Workable | `https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true` |
| Lever | `https://api.lever.co/v0/postings/<slug>?mode=json` |

**There is no list to maintain.** Companies are found automatically, saved in the **Hiring Companies** tab, and stay tracked once found:
- **Workable:** each run searches the public Workable job board (jobs.workable.com) for `WORKABLE_QUERIES` (software engineer, developer, devops, data engineer, engineering manager) in `WORKABLE_LOCATIONS` (default United Kingdom). It works out each newly seen company's slug and checks it against the live feed. At most `WORKABLE_MAX_NEW_PER_RUN` (60) new companies are looked up per run, and the rest follow later.
- **Lever** has no cross-company job search. Instead, every tender award winner in the Award Signals tab is checked for a Lever page (`LEVER_MAX_NEW_PER_RUN`, 100 per run). The `LEVER_COMPANIES` starter slugs are also tracked: Palantir, Spotify, Zopa, Scott Logic, Veeva, SonarSource, Shield AI, Outreach and DNB.

If a job site rate-limits the search, the run still polls the companies it already tracks.

```
TenderScout – hiring velocity – 07 Oct 2026

📈 Companies ramping up engineering hiring: 2
• Zopa (Lever) – engineering roles 10 → 16 · 6 new eng jobs in 7 days · stacks: kotlin ×4, aws ×3
    ↳ Senior Backend Engineer, Android Engineer, Platform Engineer
```

A company is reported when something relevant was posted **today** and at least one of these is true:

| Rule | Default |
|---|---|
| **Spike:** open engineering jobs ≥ `SPIKE_RATIO` × baseline **and** up by ≥ `SPIKE_MIN_INCREASE`. The baseline is the median of the last `BASELINE_DAYS` daily snapshots and needs at least 3 days of history. | 1.5×, +3, 14 days |
| **Burst:** ≥ `BURST_MIN_NEW_ENG` new engineering jobs in the last 7 days | 5 |
| **Stack:** ≥ `STACK_SPIKE_MIN` new jobs naming the same tech stack (title or description) in the last 7 days | 3 |

A job counts as engineering if one of `ENGINEERING_KEYWORDS` (engineer, developer, devops, SRE, architect, QA, frontend/backend, mobile…) is in its title, department or function. A company's **first** poll only sets its baseline, so a newly found company doesn't cause a false alert.

**Sheet tabs**: the hiring data lives in its own spreadsheet (`HIRING_SHEET_ID`) and has two tabs. Every row has an ATS column (Workable or Lever).
- **Hiring Companies**: one row per company found. Status is `tracked`, `no Workable page found`, `no Lever page found` or `same as <slug>`, with First Found and Found Via (search query, starter list or tender award winner). Every run updates each tracked company's Open Jobs, Open Engineering, New Engineering Jobs (7 days), **Hiring Trend**, Top Stacks, Last Spike and Last Checked. Hiring Trend is filled on days the company is ramping up, e.g. "📈 Engineering jobs 10 → 16; 6 new engineering jobs in 7 days". **Engineering History** holds the daily open-engineering counts (last 60 days) that the spike rule compares against.
- **Hiring Jobs**: every job ever seen, with Engineering Y/N, matched Stacks, First Seen, and New (N = existed on the company's first poll).

Tracked companies whose careers page later disappears are listed in Slack as "Careers page no longer found".

```bash
npm run hiring:dry-run        # search + up to 10 new companies, writes nothing: prints top companies by open engineering jobs
npm run hiring                # real run: sheet + Slack
```

## Proposal drafts (Claude, optional)

When a signal fires, TenderScout drafts one tailored outreach email for the likely hiring manager and posts it to Slack. **Nothing is emailed automatically.** A person reviews each draft and decides whether to send it. Human approval is deliberate: PECR (UK), PDPA (Singapore) and PDPO (Hong Kong) allow targeted, relevant B2B outreach with an easy opt-out, while automated bulk sending gets domains blacklisted.

| Signal | Contact | Where |
|---|---|---|
| New contract award (one draft per new winner, biggest first) | The hiring manager Apollo found for that winner, if any | `npm start` |
| Company ramping up hiring (spike / burst / stack) | Apollo lookup of the best-ranked `APOLLO_TITLES` person (1 credit for the company + 1 for the contact) | `npm run hiring` |

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`) via the official `@anthropic-ai/sdk`, returning `{subject, body}` as structured JSON. Server-side refusal fallback is on.
- **Drafts reference only facts from the signal** (contract title, buyer, value; or engineering roles before → now, new jobs, stacks). Claude is told never to invent clients or results, and only claims what `PROPOSAL_SENDER_PROFILE` says you offer. **Set that profile to your real offering.**
- **Every draft ends with an opt-out line**, is 90–150 words, and has one low-pressure call to action.
- **Limits:** at most `PROPOSALS_PER_RUN` (20) drafts per job run. A ramping-up company gets at most one draft every `PROPOSAL_COOLDOWN_DAYS` (30), recorded in the **Last Proposal** column of Hiring Companies. The first tender run (initial load) drafts nothing.
- **Skipped entirely when `ANTHROPIC_API_KEY` is not set.** Without Apollo, drafts are still written and the Slack message says "No contact found".

## Code

```
src/
  index.js                    fetch awards → filter → sheet → Apollo → Slack
  hiring.js                   tracked companies → job feeds → jobs/snapshots in sheet → spike alerts → Slack
  velocity.js                 spike / burst / stack rules
  companies.js                finds companies to track (Hiring Companies tab)
  sources/workable.js         Workable job feeds + job search
  sources/lever.js            Lever job feeds
  text.js                     HTML → plain text for job descriptions
  config.js                   settings from environment / .env
  sources/contractsFinder.js  Contracts Finder award notices
  sources/findTender.js       Find a Tender award notices
  sources/ted.js              TED award notices
  filter.js                   keyword / CPV matching
  fx.js                       approximate currency → GBP rates
  apollo.js                   Apollo company/people search + enrichment
  proposals.js                Claude drafts one tailored proposal (subject + body) per signal
  outreach.js                 signal → Apollo contact → Claude draft → Slack (capped per run)
  sheets.js                   Google Sheets helpers
  slack.js                    Slack message
  http.js                     request helper (retries rate limits and network errors)
.github/workflows/daily.yml   runs both jobs every day at 07:00 UTC
```

## Setup

### 1. Google Sheet + service account
1. In [Google Cloud Console](https://console.cloud.google.com/), enable the **Google Sheets API**, create a **service account**, and download a **JSON key**.
2. Create a Google Sheet and **share** it with the service account's email as **Editor**.
3. Copy the Sheet ID from the URL: `docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.

### 2. Slack webhook
At [api.slack.com/apps](https://api.slack.com/apps), choose **Create App → Incoming Webhooks → On → Add New Webhook**. Pick the channel and copy the URL.

### 3. Run locally
```bash
npm install
cp .env.example .env          # fill in SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON, SLACK_WEBHOOK_URL (+ APOLLO_API_KEY)
npm run dry-run               # fetch + filter only: prints the top awards, writes nothing
npm start                     # real run
```

### 4. Run daily on GitHub Actions
1. In the repo, go to **Settings → Secrets and variables → Actions** and add these **Secrets**:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the whole JSON key file contents
   - `SHEET_ID`
   - `SLACK_WEBHOOK_URL`
   - `APOLLO_API_KEY`: optional
2. Optionally, add any setting below as a **Variable**.
3. Go to **Actions → TenderScout daily → Run workflow** to test it. After that it runs every day at 07:00 UTC.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `KEYWORDS` | software, digital, developer, cloud, cyber, data, systems integration, technology, IT services, ICT, ERP, CRM, SaaS, DevOps, recruitment, staffing, software engineering… | Whole-word match on title + description |
| `CPV_PREFIXES` | `72,48` | CPV codes for IT services and software |
| `AWARD_LOOKBACK_DAYS` | `7` | Days of awards re-read every run |
| `AWARD_MIN_GBP` | `250000` | Minimum award value (approx. GBP) |
| `TED_COUNTRIES` | `*` (all) | TED buyer countries, ISO3 codes, e.g. `IRL,NLD,DEU` |
| `APOLLO_MAX_COMPANIES_PER_RUN` | `10` | Apollo: companies looked up per run |
| `APOLLO_CONTACTS_PER_COMPANY` | `2` | Apollo: contacts revealed per company |
| `APOLLO_TITLES` | talent acquisition, recruitment, resourcing, people/HR, delivery, engineering, CTO | Apollo: job titles in priority order |

An award is kept if it matches **any** keyword **or** any CPV prefix. Set both `KEYWORDS=*` and `CPV_PREFIXES=*` to keep every award (subject to `AWARD_MIN_GBP`).

## Adding sources
Add a file under `src/sources/` whose `fetchAwards()` returns objects with `source, id, title, description, buyer, suppliers, value, currency, awardDate, country, cpv, url`, then list it in `fetchAwards()` in `src/index.js`. Candidates: GeBIZ (Singapore, data.gov.sg), Hong Kong Digital Policy Office IT contract awards, and an MEA aggregator.
