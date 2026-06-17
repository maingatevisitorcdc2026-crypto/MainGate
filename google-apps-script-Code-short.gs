const SHEETS = {
  Visitors: ["visitorId","passNo","createdAt","fullName","documentType","nationalIdMasked","address","company","phone","vehicle","visitorType","faceImageUrl","status"],
  Passes: ["passNo","token","visitorId","allowedZones","host","approver","expiresAt","status","createdBy","createdAt","note"],
  ZoneLogs: ["logId","passNo","visitorId","zoneId","zoneName","action","result","reason","operator","createdAt"],
  Blacklist: ["banId","nationalIdMasked","fullName","company","vehicle","category","severity","incidentDate","officer","action","expiresAt","offense","evidence","status","createdAt","closedAt"],
  Zones: ["id","name","level","approval"],
  Users: ["userId","username","displayName","passcode","role","status","createdAt","updatedAt","onlineStatus","lastLoginAt","lastSeenAt","onlineUntil"],
  Settings: ["key","value"]
};

function doGet() {
  return out({ ok: true, app: "CJ Visitor Security API" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || "{}");
    const action = body.action;
    const payload = body.payload || {};
    if (action === "setup") return out(setupSheets());
    if (action === "getAll") return out(getAllData());
    if (action === "createPass") return out(createPass(payload));
    if (action === "addZoneLog") return out(addRow("ZoneLogs", payload));
    if (action === "createBan") return out(addRow("Blacklist", payload));
    if (action === "updateBanStatus") return out(updateById("Blacklist", "banId", payload.banId, payload));
    if (action === "saveZones") return out(replaceRows("Zones", payload.zones || []));
    if (action === "saveUsers") return out(replaceRows("Users", payload.users || []));
    if (action === "saveSettings") return out(replaceRows("Settings", payload.settings || []));
    throw new Error("Unknown action: " + action);
  } catch (err) {
    return out({ ok: false, error: String(err.message || err) });
  }
}

function setupSheets() {
  Object.keys(SHEETS).forEach(name => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
    sh.setFrozenRows(1);
  });
  if (!getRows("Zones").length) {
    replaceRows("Zones", [
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

function addRow(name, obj) {
  const sh = sheet(name);
  const headers = getHeaders(name);
  sh.appendRow(headers.map(k => obj[k] == null ? "" : obj[k]));
  return { ok: true };
}

function getRows(name) {
  const sh = sheet(name);
  const headers = getHeaders(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, headers.length).getValues()
    .filter(row => row.some(cell => cell !== ""))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
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

function updateById(name, idCol, idValue, patch) {
  const sh = sheet(name);
  const headers = getHeaders(name);
  const idIndex = headers.indexOf(idCol);
  const rows = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), headers.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][idIndex]) === String(idValue)) {
      headers.forEach((h, c) => { if (Object.prototype.hasOwnProperty.call(patch, h)) rows[i][c] = patch[h]; });
      sh.getRange(i + 2, 1, 1, headers.length).setValues([rows[i]]);
      return { ok: true };
    }
  }
  throw new Error("Row not found: " + idValue);
}

function replaceRows(name, rows) {
  const sh = sheet(name);
  const headers = getHeaders(name);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows.map(r => headers.map(h => r[h] == null ? "" : r[h])));
  return { ok: true };
}

function sheet(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error("Missing sheet: " + name);
  return sh;
}

function getHeaders(name) {
  return sheet(name).getRange(1, 1, 1, sheet(name).getLastColumn()).getValues()[0].filter(Boolean);
}

function out(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
