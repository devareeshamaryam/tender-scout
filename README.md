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

## Code

```
src/
  index.js                    fetch awards → filter → sheet → Apollo → Slack
  config.js                   settings from environment / .env
  sources/contractsFinder.js  Contracts Finder award notices
  sources/findTender.js       Find a Tender award notices
  sources/ted.js              TED award notices
  filter.js                   keyword / CPV matching
  fx.js                       approximate currency → GBP rates
  apollo.js                   Apollo company/people search + enrichment
  sheets.js                   Google Sheets helpers
  slack.js                    Slack message
  http.js                     request helper (retries rate limits and network errors)
.github/workflows/daily.yml   runs every day at 07:00 UTC
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
