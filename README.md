# TenderScout

Once a day, TenderScout pulls the open tenders from [Contracts Finder](https://www.contractsfinder.service.gov.uk/), saves them to a Google Sheet and posts a summary in Slack:

```
TenderScout daily report – 06 Oct 2026
🆕 New: 3    ❌ Revoked: 1    📋 Active total: 13
New tenders
• Provision of HR & Payroll System – Hopwood Hall College – £420,000 – closes 2026-10-23
```

- **New**: an open tender that wasn't in the sheet before. It's added as `Active`.
- **Revoked**: a tender that was `Active` in the sheet but isn't open on Contracts Finder any more (closed, withdrawn or awarded). The row stays, with `Status = Revoked` and a `Revoked Date`.

## How it works

```
src/
  index.js                     fetch → compare with sheet → update sheet → Slack
  config.js                    settings from environment / .env
  sources/contractsFinder.js   Contracts Finder public OCDS API (no key needed)
  sheets.js                    Google Sheets read/append/update
  slack.js                     Slack Incoming Webhook message
.github/workflows/daily.yml    runs every day at 07:00 UTC
```

The bot reads tenders published in the last `LOOKBACK_DAYS` days and keeps only those that are still open (status active, deadline in the future). It then filters them by keyword or CPV code.

If Contracts Finder returns nothing at all, the run fails and posts a ⚠️ message to Slack. Nothing is marked as revoked, so a site outage can't wipe the sheet.

## Setup

### 1. Google Sheet + service account
1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or pick one) and enable the **Google Sheets API**.
2. Go to **IAM & Admin → Service Accounts → Create**. Open the new account, then **Keys → Add key → JSON** and download the file.
3. Create a Google Sheet. **Share** it with the service account's email (`...@...iam.gserviceaccount.com`) as **Editor**.
4. Copy the Sheet ID from the URL: `docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.

The bot creates the `Tenders` tab and its header row on the first run.

### 2. Slack webhook
At [api.slack.com/apps](https://api.slack.com/apps), choose **Create App → From scratch → Incoming Webhooks → On → Add New Webhook**. Pick the channel and copy the URL.

### 3. Run locally
```bash
npm install
cp .env.example .env          # fill in SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON, SLACK_WEBHOOK_URL
npm run dry-run               # fetch only: prints counts, writes nothing
npm start                     # real run
```

### 4. Run daily on GitHub Actions
1. Push this folder to a GitHub repository.
2. Go to **Settings → Secrets and variables → Actions** and add these secrets:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: paste the whole contents of the JSON key file
   - `SHEET_ID`
   - `SLACK_WEBHOOK_URL`
3. Optionally, under the **Variables** tab, add `KEYWORDS`, `CPV_PREFIXES` or `LOOKBACK_DAYS`.
4. Go to **Actions → TenderScout daily → Run workflow** to test it. After that it runs every day at 07:00 UTC.

## Filtering

| Setting | Default | Meaning |
|---|---|---|
| `KEYWORDS` | software, digital, developer, cloud, cyber, data, systems integration, technology, IT services, ICT, ERP, CRM, SaaS, DevOps, recruitment, staffing… | Whole-word match on title + description |
| `CPV_PREFIXES` | `72,48` | CPV codes for IT services and software |
| `LOOKBACK_DAYS` | `120` | How far back to read published tenders |

A tender is kept if it matches **any** keyword **or** any CPV prefix. Set both `KEYWORDS=*` and `CPV_PREFIXES=*` to track every open tender.

## Notes
- The Contracts Finder API allows about 12 requests every 2 minutes. The bot waits and retries automatically when it hits that limit.
- To add more sources later (award notices, Find a Tender, TED…), add a file under `src/sources/` that returns the same tender shape.
