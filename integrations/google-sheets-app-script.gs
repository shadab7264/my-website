const SPREADSHEET_ID = "1hj4HH6D7e5BCfuxwxmvqIvWtXQbLucGeFYadA1BDj4A";
const WEBHOOK_SECRET = "ad1ccd76036b929663f686e1794c0d90849e0f276ab86737c61cb3ada2bdbec2";
const SHEET_NAME = "Leads";
const HEADERS = [
  "Lead ID",
  "Received At",
  "Student Name",
  "Email",
  "Phone",
  "Destination",
  "Service",
  "Message",
  "Source",
  "Synced At"
];

function doPost(event) {
  try {
    const input = JSON.parse(event.postData.contents || "{}");
    if (input.secret !== WEBHOOK_SECRET || input.action !== "upsertLead" || !input.lead) {
      return jsonResponse({ ok: false, error: "Unauthorized request." });
    }

    const sheet = getLeadSheet();
    const lead = input.lead;
    const values = [
      safeCell(lead.id),
      safeCell(lead.createdAt),
      safeCell(lead.name),
      safeCell(lead.email),
      safeCell(lead.phone),
      safeCell(lead.destination),
      safeCell(lead.service),
      safeCell(lead.message),
      safeCell(lead.source),
      new Date().toISOString()
    ];
    const existingRow = findLeadRow(sheet, lead.id);
    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function getLeadSheet() {
  const workbook = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = workbook.getSheetByName(SHEET_NAME) || workbook.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#102c4e").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findLeadRow(sheet, leadId) {
  if (!leadId || sheet.getLastRow() < 2) return null;
  const match = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(leadId))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : null;
}

function safeCell(value) {
  const text = String(value || "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
