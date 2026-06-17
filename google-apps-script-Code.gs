const SHEETS = {
  Visitors: [
    "visitorId", "passNo", "createdAt", "fullName", "documentType", "nationalIdMasked",
    "address", "company", "phone", "vehicle", "visitorType", "faceImageUrl", "status"
  ],
  Passes: [
    "passNo", "token", "visitorId", "allowedZones", "host", "approver",
    "expiresAt", "status", "createdBy", "createdAt", "note"
  ],
  ZoneLogs: [
    "logId", "passNo", "visitorId", "zoneId", "zoneName", "action",
    "result", "reason", "operator", "createdAt"
  ],
  Blacklist: [
    "banId", "nationalIdMasked", "fullName", "company", "vehicle", "category",
    "severity", "incidentDate", "officer", "action", "expiresAt", "offense",
    "evidence", "status", "createdAt", "closedAt"
  ],
  Zones: ["id", "name", "level", "approval"],
  Users: ["userId", "name", "role", "checkpoint", "status"],
  Settings: ["key", "value"]
};

function doGet() {
  return jsonResponse({ ok: true, app: "CJ Visitor Security API" });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const action = body.action;
    const payload = body.payload || {};

    if (action === "setup") return jsonResponse(setupSheets());
    if (action === "getAll") return jsonResponse(getAllData());
    if (action === "createPass") return jsonResponse(createPass(payload));
    if (action === "addZoneLog") return jsonResponse(addRow("ZoneLogs", payload));
    if (action === "createBan") return jsonResponse(addRow("Blacklist", payload));
    if (action === "updateBanStatus") return jsonResponse(updateById("Blacklist", "banId", payload.banId, payload));
    if (action === "saveZones") return jsonResponse(replaceSheetRows("Zones", payload.zones || []));
    if (action === "saveSettings") return jsonResponse(replaceSheetRows("Settings", payload.settings || []));

    throw new Error("Unknown action: " + action);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) });
  }
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(name => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = SHEETS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });

  const zones = getRows("Zones");
  if (!zones.length) {
    replaceSheetRows("Zones", [
      { id: "WH-A", name: "Warehouse A", level: "Standard", approval: "false" },
      { id: "WH-B", name: "Warehouse B", level: "Standard", approval: "false" },
      { id: "COLD", name: "Cold Chain", level: "Controlled", approval: "true" },
      { id: "YARD", name: "Truck Yard", level: "Standard", approval: "false" },
      { id: "OFFICE", name: "Office", level: "Standard", approval: "false" },
      { id: "SERVER", name: "Server Room", level: "Restricted", approval: "true" }
    ]);
  }

  return { ok: true };
}

function getAllData() {
  return {
    ok: true,
    visitors: getRows("Visitors"),
    passes: getRows("Passes"),
    logs: getRows("ZoneLogs"),
    bans: getRows("Blacklist"),
    zones: getRows("Zones"),
    users: getRows("Users"),
    settings: getRows("Settings")
  };
}

function createPass(payload) {
  const visitor = payload.visitor || {};
  if (visitor.faceImageUrl && String(visitor.faceImageUrl).indexOf("data:image/") === 0) {
    visitor.faceImageUrl = saveFaceImageToDrive(visitor.faceImageUrl, visitor.passNo || visitor.visitorId);
  }
  addRow("Visitors", visitor);
  addRow("Passes", payload.pass || {});
  return { ok: true };
}

function addRow(sheetName, rowObject) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);
  const row = headers.map(key => rowObject[key] == null ? "" : rowObject[key]);
  sheet.appendRow(row);
  return { ok: true };
}

function getRows(sheetName) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.filter(row => row.some(cell => cell !== "")).map(row => {
    const obj = {};
    headers.forEach((key, i) => obj[key] = row[i]);
    return obj;
  });
}

function updateById(sheetName, idColumn, idValue, patch) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);
  const idIndex = headers.indexOf(idColumn);
  if (idIndex < 0) throw new Error("Missing id column: " + idColumn);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("No rows");

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let r = 0; r < values.length; r++) {
    if (String(values[r][idIndex]) === String(idValue)) {
      headers.forEach((key, c) => {
        if (Object.prototype.hasOwnProperty.call(patch, key)) values[r][c] = patch[key];
      });
      sheet.getRange(r + 2, 1, 1, headers.length).setValues([values[r]]);
      return { ok: true };
    }
  }
  throw new Error("Row not found: " + idValue);
}

function replaceSheetRows(sheetName, rows) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(
      rows.map(row => headers.map(key => row[key] == null ? "" : row[key]))
    );
  }
  return { ok: true };
}

function getSheet(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("Missing sheet: " + sheetName);
  return sheet;
}

function getHeaders(sheetName) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.filter(Boolean);
}

function saveFaceImageToDrive(dataUrl, nameSeed) {
  const folder = getOrCreateFaceFolder();
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return dataUrl;

  const mime = match[1];
  const ext = mime.indexOf("png") >= 0 ? "png" : "jpg";
  const bytes = Utilities.base64Decode(match[2]);
  const safeName = String(nameSeed || "visitor").replace(/[^\w-]+/g, "_");
  const file = folder.createFile(Utilities.newBlob(bytes, mime, safeName + "_" + Date.now() + "." + ext));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://drive.google.com/uc?export=view&id=" + file.getId();
}

function getOrCreateFaceFolder() {
  const name = "CJ Visitor Faces";
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
