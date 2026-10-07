const fs = require('fs');
const { google } = require('googleapis');

function loadCredentials(raw) {
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  return JSON.parse(raw.trim().startsWith('{') ? raw : fs.readFileSync(raw, 'utf8'));
}

async function connect({ googleCredentials, sheetId }) {
  if (!sheetId) throw new Error('SHEET_ID is not set');
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(googleCredentials),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { api: google.sheets({ version: 'v4', auth }).spreadsheets, sheetId };
}

// Creates the tab + header row on first use. Returns a handle for the other functions.
async function openTab(conn, sheetTab, headers) {
  const { api, sheetId } = conn;
  const meta = await api.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === sheetTab)) {
    await api.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetTab } } }] },
    });
  }
  const existing = await api.values.get({ spreadsheetId: sheetId, range: `'${sheetTab}'!A1:A1` });
  if (!existing.data.values) {
    await api.values.update({
      spreadsheetId: sheetId,
      range: `'${sheetTab}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
  return { ...conn, sheetTab };
}

// Values of one column (below the header), e.g. existing IDs.
async function readColumn({ api, sheetId, sheetTab }, col) {
  const res = await api.values.get({ spreadsheetId: sheetId, range: `'${sheetTab}'!${col}2:${col}` });
  return (res.data.values || []).map((r) => r[0]).filter(Boolean);
}

async function appendRows({ api, sheetId, sheetTab }, rows) {
  if (!rows.length) return;
  await api.values.append({
    spreadsheetId: sheetId,
    range: `'${sheetTab}'!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

module.exports = { connect, openTab, readColumn, appendRows };
