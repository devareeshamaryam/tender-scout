const fs = require('fs');
const { google } = require('googleapis');

const HEADERS = [
  'Notice ID', 'Title', 'Buyer', 'Value', 'Deadline', 'Published',
  'Region', 'CPV', 'Link', 'Status', 'First Seen', 'Revoked Date',
];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i]));
const LAST_COL = String.fromCharCode(65 + HEADERS.length - 1); // "L"

function loadCredentials(raw) {
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  return JSON.parse(raw.trim().startsWith('{') ? raw : fs.readFileSync(raw, 'utf8'));
}

async function connect({ googleCredentials, sheetId, sheetTab }) {
  if (!sheetId) throw new Error('SHEET_ID is not set');
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(googleCredentials),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const api = google.sheets({ version: 'v4', auth }).spreadsheets;

  // Create the tab and header row on first run.
  const meta = await api.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === sheetTab)) {
    await api.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetTab } } }] },
    });
  }
  const header = await api.values.get({ spreadsheetId: sheetId, range: `${sheetTab}!A1:${LAST_COL}1` });
  if (!header.data.values) {
    await api.values.update({
      spreadsheetId: sheetId,
      range: `${sheetTab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
  }

  return { api, sheetId, sheetTab };
}

// Returns [{ row (1-based sheet row), id, status }]
async function readRows({ api, sheetId, sheetTab }) {
  const res = await api.values.get({ spreadsheetId: sheetId, range: `${sheetTab}!A2:${LAST_COL}` });
  return (res.data.values || [])
    .map((r, i) => ({ row: i + 2, id: r[COL['Notice ID']], status: r[COL.Status] }))
    .filter((r) => r.id);
}

function toRow(n, today) {
  return [
    n.id, n.title, n.buyer, n.value, n.deadline.slice(0, 10), n.published.slice(0, 10),
    n.region, n.cpv, n.url, 'Active', today, '',
  ];
}

async function appendTenders({ api, sheetId, sheetTab }, tenders, today) {
  if (!tenders.length) return;
  await api.values.append({
    spreadsheetId: sheetId,
    range: `${sheetTab}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: tenders.map((n) => toRow(n, today)) },
  });
}

// updates: [{ row, status, revokedDate }]
async function setStatuses({ api, sheetId, sheetTab }, updates) {
  if (!updates.length) return;
  await api.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates.map((u) => ({
        range: `${sheetTab}!J${u.row}:L${u.row}`,
        // Leaving First Seen (K) untouched by writing null.
        values: [[u.status, null, u.revokedDate]],
      })),
    },
  });
}

module.exports = { connect, readRows, appendTenders, setStatuses };
