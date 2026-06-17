const SHEET_KEY = "cjVisitorSecuritySheetV1";
const DESIGN_KEY = "cjVisitorPassDesignV1";
const SETTINGS_KEY = "cjVisitorSecuritySettingsV1";
const SESSION_KEY = "cjVisitorSecuritySessionV1";
const API_URL = "https://script.google.com/macros/s/AKfycbw7YuUqHg3GEj0y72WJSG7MxPofwqu3XSmuwpBBz1Ft0ZkAYOiTDIcgXbnFzwHNFsbQ/exec";
const PUBLIC_APP_URL = "https://mintkittisak.github.io/cj-visitor-pass/";
const defaultDesign = {
  brand: "CJ LOGISTICS",
  accent: "#101820",
  logoSrc: "assets-cj-logo.svg",
  logoSize: 58,
  logoOffset: 0,
  brandSize: 18,
  brandColor: "#101820",
  brandOffsetX: 0,
  brandOffsetY: 0,
  qrSize: 160,
  fontSize: 16,
  background: "grid",
  showPhoto: true,
  showSign: true
};
const defaultSettings = {
  defaultPassHours: "8",
  passPrefix: "GP-{YYYY}-{MM}-",
  qrMode: "pass",
  checkoutGrace: "0",
  maskNationalId: true,
  requireConsent: true,
  blockExpired: true,
  auditView: false,
  retentionDays: "90",
  alertOverdue: true,
  alertDenied: true,
  alertRestricted: true,
  alertChannel: "Security Desk",
  sheetUrl: "",
  appsScriptUrl: API_URL,
  exportFormat: "csv",
  reportCycle: "daily"
};

const defaultZones = [
  { id: "CANTEEN", name: "Canteen", level: "Standard", approval: false },
  { id: "DAIFUKU", name: "Daifuku", level: "Standard", approval: false },
  { id: "KPI", name: "KPI", level: "Standard", approval: false },
  { id: "MAIN-OFFICE", name: "Main Office", level: "Standard", approval: false },
  { id: "DATA-DRY", name: "Data Dry", level: "Standard", approval: false },
  { id: "DATA-FRESH", name: "Data Fresh", level: "Standard", approval: false },
  { id: "TRANSPORT", name: "Transport", level: "Standard", approval: false },
  { id: "DISHPATCH", name: "Dishpatch", level: "Standard", approval: false },
  { id: "SIAMFOOD", name: "Siamfood", level: "Standard", approval: false },
  { id: "MOWI", name: "Mowi", level: "Standard", approval: false }
];
const legacyDefaultZoneIds = new Set(["WH-A", "WH-B", "COLD", "YARD", "OFFICE", "SERVER"]);

const defaultAdminUser = {
  userId: "U-ADMIN",
  username: "admin",
  displayName: "Admin",
  passcode: "admin1234",
  role: "Admin",
  status: "active",
  createdAt: "2026-05-28T00:00:00.000Z"
};

const rolePermissions = {
  Admin: {
    views: ["dashboard", "register", "passDesigner", "checkpoint", "inside", "blacklist", "reports", "users", "settings"],
    actions: ["create_pass", "check_in", "check_out", "deny", "manage_users", "settings"]
  },
  "Security-Guard": {
    views: ["dashboard", "checkpoint"],
    actions: ["check_in"]
  },
  "Security-Maingate": {
    views: ["dashboard", "register", "checkpoint", "inside"],
    actions: ["create_pass", "check_out"]
  }
};

const titles = {
  dashboard: ["Dashboard", "ภาพรวมผู้มาติดต่อและสถานะการเข้าออกพื้นที่"],
  register: ["ลงทะเบียน", "อ่านข้อมูลบัตร กรอกเอง ถ่ายรูป และออกใบผ่าน"],
  passDesigner: ["ปรับใบผ่าน", "แก้รูปแบบใบผ่านและบันทึกเป็นแม่แบบสำหรับการพิมพ์"],
  checkpoint: ["สแกนเข้าออก", "ตรวจสอบ QR และสิทธิ์การเข้าโซนแบบจุดตรวจ"],
  inside: ["อยู่ในพื้นที่", "รายชื่อผู้มาติดต่อที่ยังไม่เช็คเอาท์"],
  blacklist: ["Blacklist", "บันทึกและตรวจสอบผู้มาติดต่อที่ถูกแบนหรือเฝ้าระวัง"],
  reports: ["รายงาน", "Export ข้อมูลเพื่อนำไปใช้ทำรายงานจาก Google Sheet"],
  users: ["จัดการผู้ใช้", "อนุมัติคำขอสมัครและกำหนดสิทธิ์เจ้าหน้าที่"],
  settings: ["ตั้งค่า", "โซน สิทธิ์ และกฎความปลอดภัยของระบบ"]
};

let state = loadState();
let photoData = "";
let cameraStream = null;
let scannerStream = null;
let selectedPass = null;
let passDesign = loadDesign();
let appSettings = loadSettings();
let dashboardShowAll = false;
let pendingRegistration = null;
let completingAfterPrint = false;
let currentSession = loadSession();
let lastScannedQr = "";
const DASHBOARD_ROW_LIMIT = 10;
const USER_ROW_LIMIT = 10;

function loadState() {
  const fallback = { visitors: [], passes: [], logs: [], users: [defaultAdminUser], bans: [], zones: defaultZones };
  try {
    const loaded = JSON.parse(localStorage.getItem(SHEET_KEY)) || fallback;
    const users = loaded.users?.length ? loaded.users : [defaultAdminUser];
    const hasOnlyLegacyZones = loaded.zones?.length && loaded.zones.every(zone => legacyDefaultZoneIds.has(zone.id));
    const zones = hasOnlyLegacyZones ? defaultZones : (loaded.zones?.length ? loaded.zones : defaultZones);
    return { ...fallback, ...loaded, users, zones };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(SHEET_KEY, JSON.stringify(state));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession(user) {
  const loggedInAt = nowIso();
  currentSession = {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    loggedInAt
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
  markUserPresence("online", loggedInAt);
}

function clearSession() {
  markUserPresence("offline");
  currentSession = null;
  localStorage.removeItem(SESSION_KEY);
}

function syncUsers() {
  saveState();
  apiPost("saveUsers", {
    users: state.users.map(user => ({ ...user, passcode: user.passcode ? "SET" : "" }))
  });
}

function markUserPresence(status, loggedInAt = "") {
  if (!currentSession) return;
  const user = (state.users || []).find(item => item.userId === currentSession.userId);
  if (!user) return;
  const now = nowIso();
  user.onlineStatus = status;
  user.lastSeenAt = now;
  if (loggedInAt) user.lastLoginAt = loggedInAt;
  if (status === "online") user.onlineUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  if (status === "offline") user.onlineUntil = "";
  syncUsers();
}

function touchPresence() {
  if (!currentSession || currentSession.role === "Admin") {
    if (currentSession) markUserPresence("online", currentSession.loggedInAt);
    return;
  }
  if (sessionExpired()) {
    clearSession();
    renderLoginState();
    return;
  }
  markUserPresence("online", currentSession.loggedInAt);
}

function getZones() {
  return Array.isArray(state.zones) ? state.zones : defaultZones;
}

function normalizeZoneId(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
}

async function apiPost(action, payload = {}) {
  const apiUrl = (appSettings.appsScriptUrl || API_URL || "").trim();
  if (!apiUrl) return { ok: false, offline: true };
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "API error");
    return data;
  } catch (error) {
    console.warn("Google Sheet sync failed:", error);
    return { ok: false, error: error.message };
  }
}

function parseRemoteZones(rows) {
  return (rows || []).map(zone => ({
    id: zone.id,
    name: zone.name,
    level: zone.level || "Standard",
    approval: String(zone.approval).toLowerCase() === "true"
  })).filter(zone => zone.id && zone.name);
}

function parseRemotePass(pass) {
  const zoneIds = String(pass.allowedZones || "").split("|").filter(Boolean);
  const zoneNames = zoneIds.map(id => getZones().find(zone => zone.id === id)?.name || id);
  return { ...pass, allowedZones: zoneIds, allowedZoneNames: zoneNames };
}

async function loadRemoteData() {
  const data = await apiPost("getAll");
  if (!data.ok) return;
  state.zones = parseRemoteZones(data.zones).length ? parseRemoteZones(data.zones) : getZones();
  state.visitors = (data.visitors || []).map(visitor => ({
    ...visitor,
    faceImage: normalizeImageUrl(visitor.faceImageUrl || visitor.faceImage || ""),
    faceImageUrl: normalizeImageUrl(visitor.faceImageUrl || "")
  }));
  state.passes = (data.passes || []).map(parseRemotePass);
  state.logs = data.logs || [];
  state.bans = data.bans || [];
  state.users = data.users?.length ? data.users.map(user => {
    const username = user.username || user.name || "";
    const existing = (state.users || []).find(item => item.userId === user.userId || item.username === username);
    return {
      userId: user.userId || existing?.userId || `U-${Date.now()}`,
      username,
      displayName: user.displayName || user.name || user.username || existing?.displayName || "",
      passcode: user.passcode && user.passcode !== "SET" ? user.passcode : (existing?.passcode || ""),
      role: user.role || existing?.role || "Security-Guard",
      status: user.status || existing?.status || "active",
      createdAt: user.createdAt || existing?.createdAt || nowIso(),
      updatedAt: user.updatedAt || existing?.updatedAt || "",
      onlineStatus: user.onlineStatus || existing?.onlineStatus || "offline",
      lastLoginAt: user.lastLoginAt || existing?.lastLoginAt || "",
      lastSeenAt: user.lastSeenAt || existing?.lastSeenAt || "",
      onlineUntil: user.onlineUntil || existing?.onlineUntil || ""
    };
  }).filter(user => user.username) : (state.users?.length ? state.users : [defaultAdminUser]);
  saveState();
  fillZones();
  render();
  openPassFromUrl();
}

function loadDesign() {
  try {
    return { ...defaultDesign, ...(JSON.parse(localStorage.getItem(DESIGN_KEY)) || {}) };
  } catch {
    return { ...defaultDesign };
  }
}

function saveDesignState() {
  localStorage.setItem(DESIGN_KEY, JSON.stringify(passDesign));
}

function loadSettings() {
  try {
    const loaded = { ...defaultSettings, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
    if (loaded.passPrefix === "GP-{YYYY}-05-") loaded.passPrefix = defaultSettings.passPrefix;
    return loaded;
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettingsState() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings));
}

function nowIso() {
  return new Date().toISOString();
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function passNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const pattern = appSettings.passPrefix || defaultSettings.passPrefix;
  const prefix = pattern.replace("{YYYY}", year).replace("{MM}", month);
  const seq = state.passes.filter(p => p.passNo.startsWith(prefix)).length + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

function token() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function maskId(id) {
  const raw = String(id || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (raw.length < 6) return id || "-";
  return `${raw.slice(0, 3)}${"*".repeat(Math.max(3, raw.length - 5))}${raw.slice(-2)}`;
}

function normalizeId(id) {
  return String(id || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function isExpired(pass) {
  return false;
}

function activeLogFor(passNo) {
  const logs = state.logs.filter(log => log.passNo === passNo);
  let active = null;
  for (const log of logs) {
    if (log.action === "check_in") active = log;
    if (log.action === "check_out") active = null;
  }
  return active;
}

function latestLog(passNo) {
  return [...state.logs].reverse().find(log => log.passNo === passNo);
}

function activityForPass(pass) {
  const log = latestLog(pass.passNo);
  if (!log) {
    return {
      label: "ลงทะเบียนเข้าพื้นที่ (Maingate)",
      zoneName: "Maingate",
      badge: "registered"
    };
  }
  if (log.action === "check_in" && log.result === "allowed") {
    return {
      label: `เช็คอินเข้าพื้นที่สำเร็จ (${log.zoneName || "-"})`,
      zoneName: log.zoneName || "-",
      badge: "check_in"
    };
  }
  if (log.action === "check_out") {
    return {
      label: "เช็คเอาท์ออกจากพื้นที่ (Maingate)",
      zoneName: "Maingate",
      badge: "checked_out"
    };
  }
  if (log.action === "deny" || log.result === "blocked") {
    return {
      label: `ปฏิเสธเข้าโซน (${log.zoneName || "-"})`,
      zoneName: log.zoneName || "-",
      badge: "denied"
    };
  }
  return {
    label: pass.status || "-",
    zoneName: log.zoneName || "-",
    badge: pass.status || "registered"
  };
}

function visitorById(id) {
  return state.visitors.find(v => v.visitorId === id);
}

function visitorForPass(pass) {
  return state.visitors.find(v => v.visitorId === pass.visitorId)
    || state.visitors.find(v => v.passNo === pass.passNo)
    || {};
}

function activeBanFor({ nationalId = "", fullName = "", vehicle = "" } = {}) {
  const id = normalizeId(nationalId);
  const name = String(fullName || "").trim().toLowerCase();
  const car = String(vehicle || "").trim().toLowerCase();
  return (state.bans || []).find(ban => {
    if (ban.status !== "active") return false;
    if (ban.expiresAt && new Date(ban.expiresAt).getTime() < Date.now()) return false;
    const idMatch = id && ban.nationalIdKey && ban.nationalIdKey === id;
    const nameMatch = name && ban.fullName.toLowerCase() === name;
    const vehicleMatch = car && ban.vehicle && ban.vehicle.toLowerCase() === car;
    return idMatch || nameMatch || vehicleMatch;
  });
}

function passByCode(code) {
  let value = String(code || "").trim();
  try {
    const parsed = new URL(value);
    value = parsed.searchParams.get("pass") || parsed.searchParams.get("t") || value;
  } catch {}
  value = value.toUpperCase();
  return state.passes.find(p => p.passNo === value || p.token === value || `PASS:${p.passNo}` === value);
}

function normalizeImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/")) return raw;
  const idMatch = raw.match(/[?&]id=([^&]+)/) || raw.match(/\/file\/d\/([^/]+)/);
  if (raw.includes("drive.google.com") && idMatch?.[1]) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(idMatch[1])}&sz=w600`;
  }
  return raw;
}

function passCheckinUrl(passNo) {
  const base = window.location.protocol === "file:"
    ? PUBLIC_APP_URL
    : `${window.location.origin}${window.location.pathname}`;
  return `${base}?pass=${encodeURIComponent(passNo)}`;
}

function createQrImage(data) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(data)}`;
  return `<img src="${url}" alt="QR check-in" loading="lazy">`;
}

function openPassFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const passNo = params.get("pass") || params.get("t");
  if (!passNo) return;
  document.querySelector("#scanCode").value = passNo;
  switchView("checkpoint", { keepScan: true });
  const pass = lookupPass();
  if (!pass) alert("QR Code ไม่ถูกต้อง หรือไม่พบใบผ่านในระบบ");
}

function fillZones() {
  const selects = [document.querySelector("#targetZone"), document.querySelector("#scanZone")];
  const currentZones = getZones();
  for (const select of selects) {
    select.innerHTML = currentZones.length
      ? currentZones.map(z => `<option value="${z.id}">${z.name} (${z.id})</option>`).join("")
      : `<option value="">ยังไม่มีโซน</option>`;
    select.disabled = !currentZones.length;
  }
  const dashboardZone = document.querySelector("#dashboardFilterZone");
  if (dashboardZone) {
    const selected = dashboardZone.value;
    dashboardZone.innerHTML = `<option value="">ทุกโซน</option>` + currentZones.map(z => `<option value="${z.id}">${z.name}</option>`).join("");
    dashboardZone.value = selected;
  }
  document.querySelector("#zoneList").innerHTML = currentZones.map(z =>
    `<div class="zone-card">
      <strong>${z.name}</strong>
      <small>${z.id} · ${z.level}${z.approval ? " · ต้องอนุมัติ" : " · อนุญาตปกติ"}</small>
      <div class="zone-card-actions">
        <button class="edit-zone" type="button" data-zone="${z.id}">แก้ไข</button>
        <button class="delete-zone" type="button" data-zone="${z.id}">ลบ</button>
      </div>
    </div>`
  ).join("") || `<div class="zone-empty">ยังไม่มีโซนพื้นที่ กรอกรหัสและชื่อโซนเพื่อเพิ่มใหม่</div>`;
}

function switchView(id, options = {}) {
  if (currentSession && !allowedViews().includes(id)) id = allowedViews()[0] || "dashboard";
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.view === id));
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === id));
  document.querySelector("#viewTitle").textContent = titles[id][0];
  document.querySelector("#viewSubtitle").textContent = titles[id][1];
  if (id === "checkpoint") {
    selectedPass = null;
    if (!options.keepScan) document.querySelector("#scanCode").value = "";
    showVerdict(false);
  }
  render();
}

function render() {
  renderDashboard();
  renderInside();
  renderBans();
  renderUsers();
  renderSearchResults();
}

function renderDashboard() {
  const today = todayKey();
  const todayPasses = state.passes.filter(p => p.createdAt.startsWith(today));
  const inside = state.passes.filter(p => activeLogFor(p.passNo));
  const denied = state.logs.filter(l => l.action === "deny" && l.createdAt.startsWith(today));
  document.querySelector("#mToday").textContent = todayPasses.length;
  document.querySelector("#mInside").textContent = inside.length;
  document.querySelector("#mOverdue").textContent = "0";
  document.querySelector("#mDenied").textContent = denied.length;

  const q = document.querySelector("#dashboardFilterText")?.value.trim().toLowerCase() || "";
  const statusFilter = document.querySelector("#dashboardFilterStatus")?.value || "";
  const zoneFilter = document.querySelector("#dashboardFilterZone")?.value || "";
  const filtered = state.passes.filter(pass => {
    const visitor = visitorById(pass.visitorId) || {};
    const log = latestLog(pass.passNo);
    const activity = activityForPass(pass);
    const text = `${pass.passNo} ${visitor.fullName || ""} ${visitor.company || ""} ${visitor.vehicle || ""} ${pass.allowedZoneNames?.join(" ") || ""} ${log?.zoneName || ""}`.toLowerCase();
    const statusOk = !statusFilter || activity.badge === statusFilter;
    const zoneOk = !zoneFilter || pass.allowedZones?.includes(zoneFilter) || log?.zoneId === zoneFilter;
    return text.includes(q) && statusOk && zoneOk;
  });
  const latest = filtered.slice(-DASHBOARD_ROW_LIMIT).reverse();
  const dashboardLimit = document.querySelector("#toggleDashboardRows");
  dashboardLimit.textContent = `ล่าสุด ${latest.length}/${filtered.length}`;
  dashboardLimit.disabled = true;
  document.querySelector("#latestRows").innerHTML = latest.map(pass => {
    const visitor = visitorForPass(pass);
    const activity = activityForPass(pass);
    return `<tr>
      <td>${pass.passNo}</td>
      <td>${visitor.fullName || "-"}</td>
      <td>${activity.zoneName}</td>
      <td><span class="badge ${activity.badge}">${activity.label}</span></td>
      <td><button class="view-pass-btn" data-view-pass="${pass.passNo}" type="button">ดูใบผ่าน</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5">ยังไม่มีข้อมูล</td></tr>`;
}

function renderInside() {
  const q = document.querySelector("#insideSearch").value.trim().toLowerCase();
  const rows = state.passes.filter(p => activeLogFor(p.passNo)).filter(pass => {
    const visitor = visitorById(pass.visitorId) || {};
    const blob = `${pass.passNo} ${visitor.fullName || ""} ${visitor.company || ""} ${visitor.vehicle || ""}`.toLowerCase();
    return blob.includes(q);
  });
  document.querySelector("#insideRows").innerHTML = rows.map(pass => {
    const visitor = visitorById(pass.visitorId);
    const log = activeLogFor(pass.passNo);
    return `<tr>
      <td>${pass.passNo}</td>
      <td>${visitor?.fullName || "-"}</td>
      <td>${visitor?.company || "-"}</td>
      <td>${log?.zoneName || "-"}</td>
      <td>${formatDateTime(log?.createdAt)}</td>
      <td>ไม่หมดอายุ</td>
      <td><button class="ghost row-checkout" data-pass="${pass.passNo}">Checkout</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7">ไม่มีผู้มาติดต่อที่อยู่ในพื้นที่</td></tr>`;
}

function renderBans() {
  const body = document.querySelector("#banRows");
  if (!body) return;
  const q = document.querySelector("#banSearch")?.value.trim().toLowerCase() || "";
  const rows = (state.bans || []).filter(ban => {
    const text = `${ban.fullName} ${ban.company} ${ban.vehicle} ${ban.nationalIdMasked} ${ban.category} ${ban.offense}`.toLowerCase();
    return text.includes(q);
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const categoryText = {
    zone_violation: "ผิดโซน",
    behavior: "พฤติกรรม",
    safety: "ความปลอดภัย",
    asset: "ทรัพย์สิน/สินค้า",
    document: "เอกสาร",
    other: "อื่น ๆ"
  };
  const severityText = {
    watch: "เฝ้าระวัง",
    temporary: "แบนชั่วคราว",
    permanent: "แบนถาวร"
  };
  const actionText = {
    deny_entry: "ห้ามเข้า",
    require_approval: "ต้องอนุมัติ",
    escort_only: "ต้องประกบ",
    watch_only: "เฝ้าระวัง"
  };
  body.innerHTML = rows.map(ban => {
    const inactive = ban.status !== "active";
    return `<tr>
      <td><strong>${ban.fullName}</strong><br><small>${ban.nationalIdMasked || "-"}</small></td>
      <td>${ban.company || "-"}<br><small>${ban.vehicle || "-"}</small></td>
      <td>${categoryText[ban.category] || ban.category}<br><small>${ban.offense}</small></td>
      <td><span class="badge severity-${ban.severity}">${inactive ? "ยกเลิกแล้ว" : severityText[ban.severity]}</span></td>
      <td>${actionText[ban.action] || ban.action}</td>
      <td>${ban.status === "active" ? `<button class="ban-action-btn" data-unban="${ban.banId}">ยกเลิกแบน</button>` : ""}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6">ยังไม่มีรายการแบน</td></tr>`;
}

function activeUser() {
  if (currentSession) {
    const sessionUser = (state.users || []).find(user => user.userId === currentSession.userId && user.status === "active");
    if (sessionUser) return { ...sessionUser, displayName: currentSession.displayName || sessionUser.displayName };
    return { ...currentSession, status: "active" };
  }
  return (state.users || []).find(user => user.status === "active") || defaultAdminUser;
}

function hasPermission(action) {
  const role = activeUser().role || "Admin";
  return Boolean(rolePermissions[role]?.actions.includes(action));
}

function allowedViews() {
  const role = activeUser().role || "Admin";
  return rolePermissions[role]?.views || rolePermissions.Admin.views;
}

function sessionExpired() {
  if (!currentSession || currentSession.role === "Admin") return false;
  return Date.now() - new Date(currentSession.loggedInAt).getTime() > 60 * 60 * 1000;
}

function applyRoleAccess() {
  const loggedIn = Boolean(currentSession);
  const views = loggedIn ? allowedViews() : [];
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.hidden = loggedIn && !views.includes(btn.dataset.view);
  });
  document.querySelector("#checkInBtn").hidden = loggedIn && !hasPermission("check_in");
  document.querySelector("#checkOutBtn").hidden = loggedIn && !hasPermission("check_out");
  document.querySelector("#denyBtn").hidden = loggedIn && !hasPermission("deny");
  document.querySelector("#userForm").classList.toggle("locked", loggedIn && !hasPermission("manage_users"));
  const currentView = document.querySelector(".view.active")?.id;
  if (loggedIn && currentView && !views.includes(currentView)) switchView(views[0] || "dashboard");
}

function renderLoginState() {
  const screen = document.querySelector("#loginScreen");
  if (currentSession && (sessionExpired() || !(state.users || []).some(user => user.userId === currentSession.userId && user.status === "active"))) {
    clearSession();
  }
  const loggedIn = Boolean(currentSession);
  screen.classList.toggle("active", !loggedIn);
  document.body.classList.toggle("is-locked", !loggedIn);
  const user = activeUser();
  document.querySelector("#operatorName").textContent = loggedIn ? (user.displayName || user.username) : "ยังไม่ได้เข้าสู่ระบบ";
  document.querySelector("#operatorRole").textContent = loggedIn ? (user.role || "-") : "-";
  applyRoleAccess();
}

function loginUser(event) {
  event.preventDefault();
  const username = document.querySelector("#loginUsername").value.trim().toLowerCase();
  const passcode = document.querySelector("#loginPasscode").value.trim();
  const error = document.querySelector("#loginError");
  const user = (state.users || []).find(item => item.username.toLowerCase() === username && item.passcode === passcode);
  if (!user) {
    error.textContent = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    return;
  }
  if (user.status === "pending") {
    error.textContent = "บัญชีนี้ยังรอ Admin กำหนดสิทธิ์";
    return;
  }
  if (user.status !== "active") {
    error.textContent = "บัญชีนี้ถูกปิดใช้งาน";
    return;
  }
  error.textContent = "";
  saveSession(user);
  document.querySelector("#loginForm").reset();
  renderLoginState();
  renderUsers();
}

function signupUser(event) {
  event.preventDefault();
  const displayName = document.querySelector("#signupDisplayName").value.trim();
  const username = document.querySelector("#signupUsername").value.trim().toLowerCase();
  const passcode = document.querySelector("#signupPasscode").value.trim();
  const message = document.querySelector("#signupMessage");
  state.users = state.users?.length ? state.users : [defaultAdminUser];
  if (state.users.some(user => user.username.toLowerCase() === username)) {
    message.textContent = "ชื่อผู้ใช้นี้มีอยู่แล้ว";
    return;
  }
  state.users.push({
    userId: `U-${Date.now()}`,
    username,
    displayName,
    passcode,
    role: "Security-Guard",
    status: "pending",
    createdAt: nowIso()
  });
  syncUsers();
  document.querySelector("#signupForm").reset();
  message.textContent = "ส่งคำขอแล้ว กรุณารอ Admin กำหนดสิทธิ์";
  renderUsers();
}

function logoutUser() {
  clearSession();
  stopCamera();
  stopScanner();
  showAuthPanel("login");
  renderLoginState();
}

function userOnlineInfo(user) {
  if (currentSession?.userId === user.userId) {
    return { label: "ออนไลน์", badge: "online", detail: "กำลังใช้งานเครื่องนี้" };
  }
  if (user.onlineStatus === "online" && user.onlineUntil && new Date(user.onlineUntil).getTime() > Date.now()) {
    return { label: "ออนไลน์", badge: "online", detail: `เห็นล่าสุด ${formatDateTime(user.lastSeenAt)}` };
  }
  if (user.onlineStatus === "online" && user.onlineUntil) {
    return { label: "หมด session", badge: "session_expired", detail: `หมดอายุ ${formatDateTime(user.onlineUntil)}` };
  }
  return {
    label: "ออฟไลน์",
    badge: "offline",
    detail: user.lastSeenAt ? `เห็นล่าสุด ${formatDateTime(user.lastSeenAt)}` : "ยังไม่เคยเข้าใช้งาน"
  };
}

function showAuthPanel(panel) {
  document.querySelectorAll("[data-auth-panel]").forEach(el => {
    el.classList.toggle("active", el.dataset.authPanel === panel);
  });
  document.querySelector("#loginError").textContent = "";
  document.querySelector("#signupMessage").textContent = "";
}

function renderUsers() {
  const body = document.querySelector("#userRows");
  if (!body) return;
  state.users = state.users?.length ? state.users : [defaultAdminUser];
  renderLoginState();
  const rows = state.users.slice(0, USER_ROW_LIMIT);
  const counter = document.querySelector("#userRowsLimit");
  if (counter) counter.textContent = `แสดง ${rows.length}/${state.users.length}`;
  body.innerHTML = rows.map(user => {
    const online = userOnlineInfo(user);
    return `
    <tr>
      <td><strong>${user.displayName || "-"}</strong><br><small>${user.username || "-"}</small></td>
      <td><span class="badge role-${String(user.role || "").toLowerCase()}">${user.role || "-"}</span></td>
      <td><span class="badge ${user.status === "active" ? "active" : user.status === "pending" ? "registered" : "checked_out"}">${user.status === "active" ? "ใช้งาน" : user.status === "pending" ? "รออนุมัติ" : "ปิดใช้งาน"}</span></td>
      <td><span class="badge presence-${online.badge}">${online.label}</span><br><small>${online.detail}</small></td>
      <td>
        <button class="edit-user" type="button" data-user="${user.userId}">${user.status === "pending" ? "อนุมัติ" : "แก้ไข"}</button>
        ${user.userId === "U-ADMIN" ? "" : `<button class="delete-user" type="button" data-user="${user.userId}">ปิดใช้งาน</button>`}
      </td>
    </tr>
  `;}).join("");
}

function buildSearchRows(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return state.passes.map(pass => {
    const visitor = visitorById(pass.visitorId) || {};
    const log = latestLog(pass.passNo);
    const haystack = [
      pass.passNo,
      pass.token,
      pass.allowedZoneNames.join(" "),
      visitor.fullName,
      visitor.company,
      visitor.phone,
      visitor.vehicle,
      visitor.visitorType,
      pass.host,
      log?.zoneName
    ].join(" ").toLowerCase();
    return { pass, visitor, log, haystack };
  }).filter(row => row.haystack.includes(q)).slice(0, 8);
}

function renderSearchResults() {
  const input = document.querySelector("#globalSearch");
  const box = document.querySelector("#searchResults");
  if (!input || !box) return;
  const rows = buildSearchRows(input.value);
  if (!input.value.trim()) {
    box.classList.remove("open");
    box.innerHTML = "";
    return;
  }
  box.classList.add("open");
  box.innerHTML = rows.map(({ pass, visitor, log }) => `
    <button class="result-item" data-pass="${pass.passNo}">
      <strong>${pass.passNo} · ${visitor.fullName || "-"}</strong>
      <small>${visitor.company || "-"} · ${visitor.vehicle || "-"} · ${log?.zoneName || pass.allowedZoneNames.join(", ")} · ${pass.status}</small>
    </button>
  `).join("") || `<button class="result-item" type="button"><strong>ไม่พบข้อมูล</strong><small>ลองค้นจากเลขใบผ่าน ชื่อ บริษัท หรือทะเบียนรถ</small></button>`;
}

function openPassFromSearch(passNo) {
  const pass = passByCode(passNo);
  if (!pass) return;
  document.querySelector("#scanCode").value = pass.passNo;
  const input = document.querySelector("#globalSearch");
  const results = document.querySelector("#searchResults");
  if (input) input.value = "";
  if (results) results.classList.remove("open");
  switchView("checkpoint", { keepScan: true });
  lookupPass();
}

function updatePreview(form) {
  const data = new FormData(form);
  const zone = getZones().find(z => z.id === data.get("targetZone"));
  const date = new Date();
  document.querySelector("#pvZone").textContent = zone?.name || "-";
  document.querySelector("#pvName").textContent = data.get("fullName") || "-";
  document.querySelector("#pvDate").textContent = date.toLocaleDateString("th-TH");
  document.querySelector("#pvTime").textContent = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  document.querySelector("#pvVehicle").textContent = data.get("vehicle") || "-";
  document.querySelector("#pvType").textContent = data.get("visitorType") || "-";
  if (photoData) document.querySelector("#pvPhoto").src = photoData;
}

function updateDocumentTypeUi() {
  const type = document.querySelector("#documentType")?.value || "thai_id";
  const input = document.querySelector("[name=nationalId]");
  const label = document.querySelector("#documentNoLabel");
  if (!input || !label) return;
  const isPassport = type === "passport";
  label.textContent = isPassport ? "เลข Passport" : "เลขบัตรประชาชน";
  input.inputMode = isPassport ? "text" : "numeric";
  input.placeholder = isPassport ? "เช่น AA1234567" : "";
}

function setDefaultExpiry() {
  const input = document.querySelector("[name=expiresAt]");
  if (!input) return;
  const date = new Date(Date.now() + Number(appSettings.defaultPassHours || 8) * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  input.value = local;
}

async function startCamera() {
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  const video = document.querySelector("#camera");
  video.srcObject = cameraStream;
  document.querySelector("#photoPreview").style.display = "none";
  video.style.display = "block";
}

function capturePhoto() {
  const video = document.querySelector("#camera");
  if (!video.videoWidth) return;
  const canvas = document.querySelector("#photoCanvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  photoData = canvas.toDataURL("image/jpeg", 0.82);
  setPhoto(photoData);
  stopCamera();
  createPassFromPendingRegistration();
}

function setPhoto(data) {
  photoData = data;
  const preview = document.querySelector("#photoPreview");
  preview.src = data;
  preview.style.display = "block";
  document.querySelector("#camera").style.display = "none";
  document.querySelector("#photoState").textContent = "บันทึกรูปแล้ว";
  document.querySelector("#photoState").classList.remove("danger");
  document.querySelector("#photoState").classList.add("ok");
  document.querySelector("#pvPhoto").src = data;
}

function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
  document.querySelector("#camera").srcObject = null;
}

function stopScanner() {
  if (!scannerStream) return;
  scannerStream.getTracks().forEach(track => track.stop());
  scannerStream = null;
  const video = document.querySelector("#scanVideo");
  if (video) video.srcObject = null;
  document.querySelector("#scannerFallback").style.display = "block";
}

function showRegisterStep(step) {
  document.querySelectorAll("[data-register-step]").forEach(el => {
    el.classList.toggle("active", el.dataset.registerStep === step);
  });
  document.querySelectorAll("[data-step-dot]").forEach(el => {
    el.classList.toggle("active", el.dataset.stepDot === step);
  });
}

function resetPhotoUi() {
  photoData = "";
  const preview = document.querySelector("#photoPreview");
  preview.removeAttribute("src");
  preview.style.display = "none";
  const camera = document.querySelector("#camera");
  camera.style.display = "block";
  document.querySelector("#photoState").textContent = "ยังไม่มีรูป";
  document.querySelector("#photoState").classList.add("danger");
  document.querySelector("#photoState").classList.remove("ok");
  document.querySelector("#pvPhoto").removeAttribute("src");
  document.querySelector("#uploadPhoto").value = "";
}

function resetRegistrationFlow() {
  pendingRegistration = null;
  completingAfterPrint = false;
  stopCamera();
  document.querySelector("#visitorForm").reset();
  setDefaultExpiry();
  resetPhotoUi();
  document.querySelector("#pvPassNo").textContent = passNumber();
  document.querySelector("#pvZone").textContent = "-";
  document.querySelector("#pvName").textContent = "-";
  document.querySelector("#pvDate").textContent = "-";
  document.querySelector("#pvTime").textContent = "-";
  document.querySelector("#pvVehicle").textContent = "-";
  document.querySelector("#pvType").textContent = "-";
  document.querySelector("#qrBox").innerHTML = createQrImage(passCheckinUrl(passNumber()));
  showRegisterStep("form");
}

function savePass(event) {
  event.preventDefault();
  if (!hasPermission("create_pass")) {
    alert("บัญชีนี้ไม่มีสิทธิ์สร้างใบผ่าน");
    return;
  }
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const matchedBan = activeBanFor({
    nationalId: data.nationalId,
    fullName: data.fullName,
    vehicle: data.vehicle
  });
  if (matchedBan && matchedBan.action !== "watch_only") {
    alert(`ไม่สามารถออกใบผ่านได้: พบรายการแบน/เฝ้าระวัง\n${matchedBan.fullName}\nเหตุผล: ${matchedBan.offense}`);
    return;
  }
  pendingRegistration = data;
  resetPhotoUi();
  showRegisterStep("photo");
  startCamera().catch(() => {
    document.querySelector("#photoState").textContent = "เปิดกล้องไม่ได้ กรุณาอนุญาตกล้องหรืออัปโหลดรูป";
  });
}

function createPassFromPendingRegistration() {
  if (!pendingRegistration || !photoData) return;
  const data = pendingRegistration;
  const passNo = passNumber();
  const visitorId = `V-${Date.now()}`;
  const qrToken = token();
  const zone = getZones().find(z => z.id === data.targetZone) || { name: data.targetZone || "-" };
  const visitor = {
    visitorId,
    passNo,
    documentType: data.documentType || "thai_id",
    nationalIdKey: normalizeId(data.nationalId),
    nationalIdMasked: maskId(data.nationalId),
    fullName: data.fullName,
    address: data.address,
    company: data.company,
    phone: data.phone,
    vehicle: data.vehicle,
    visitorType: data.visitorType,
    faceImage: photoData,
    faceImageUrl: photoData,
    consent: true,
    status: "active",
    createdAt: nowIso()
  };
  const pass = {
    passNo,
    token: qrToken,
    visitorId,
    allowedZones: [data.targetZone],
    allowedZoneNames: [zone.name],
    host: "",
    approver: "",
    note: data.note,
    expiresAt: "never",
    status: "active",
    createdBy: activeUser().displayName || "Security Desk",
    createdAt: nowIso()
  };
  state.visitors.push(visitor);
  state.passes.push(pass);
  saveState();
  apiPost("createPass", {
    visitor: {
      visitorId: visitor.visitorId,
      passNo: visitor.passNo,
      createdAt: visitor.createdAt,
      fullName: visitor.fullName,
      documentType: visitor.documentType,
      nationalIdMasked: visitor.nationalIdMasked,
      address: visitor.address,
      company: visitor.company,
      phone: visitor.phone,
      vehicle: visitor.vehicle,
      visitorType: visitor.visitorType,
      faceImageUrl: visitor.faceImageUrl,
      status: visitor.status
    },
    pass: {
      passNo: pass.passNo,
      token: pass.token,
      visitorId: pass.visitorId,
      allowedZones: pass.allowedZones.join("|"),
      host: pass.host,
      approver: pass.approver,
      expiresAt: pass.expiresAt,
      status: pass.status,
      createdBy: pass.createdBy,
      createdAt: pass.createdAt,
      note: pass.note
    }
  });
  renderPass(pass, visitor);
  render();
  pendingRegistration = null;
  showRegisterStep("pass");
}

function completeRegistrationFlow() {
  if (!completingAfterPrint) return;
  completingAfterPrint = false;
  showRegisterStep("done");
  setTimeout(resetRegistrationFlow, 1800);
}

function renderPass(pass, visitor) {
  document.querySelector("#pvPassNo").textContent = pass.passNo;
  document.querySelector("#pvZone").textContent = pass.allowedZoneNames.join(", ");
  document.querySelector("#pvName").textContent = visitor.fullName || "-";
  document.querySelector("#pvDate").textContent = new Date(pass.createdAt).toLocaleDateString("th-TH");
  document.querySelector("#pvTime").textContent = new Date(pass.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  document.querySelector("#pvVehicle").textContent = visitor.vehicle || "-";
  document.querySelector("#pvType").textContent = visitor.visitorType || "-";
  document.querySelector("#pvPhoto").src = normalizeImageUrl(visitor.faceImage || visitor.faceImageUrl);
  document.querySelector("#qrBox").innerHTML = createQrImage(passCheckinUrl(pass.passNo));
}

function renderHistoryPass(passNo) {
  const pass = passByCode(passNo);
  if (!pass) return;
  const visitor = visitorForPass(pass);
  const createdAt = pass.createdAt ? new Date(pass.createdAt) : new Date();
  document.querySelector("#historyPassNo").textContent = pass.passNo;
  document.querySelector("#historyZone").textContent = pass.allowedZoneNames?.join(", ") || pass.allowedZones?.join(", ") || "-";
  document.querySelector("#historyName").textContent = visitor.fullName || "-";
  document.querySelector("#historyDate").textContent = createdAt.toLocaleDateString("th-TH");
  document.querySelector("#historyTime").textContent = createdAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  document.querySelector("#historyVehicle").textContent = visitor.vehicle || "-";
  document.querySelector("#historyType").textContent = visitor.visitorType || "-";
  const photo = normalizeImageUrl(visitor.faceImage || visitor.faceImageUrl || "");
  const photoEl = document.querySelector("#historyPhoto");
  photoEl.onerror = () => {
    const original = visitor.faceImageUrl || visitor.faceImage || "";
    if (original && photoEl.src !== original) photoEl.src = original;
  };
  if (photo) photoEl.src = photo;
  else {
    photoEl.onerror = null;
    photoEl.removeAttribute("src");
  }
  document.querySelector("#historyQr").innerHTML = createQrImage(passCheckinUrl(pass.passNo));
  document.querySelectorAll(".historyBrandText").forEach(el => {
    el.textContent = passDesign.brand || "CJ LOGISTICS";
  });
  applyPassDesign();
  const modal = document.querySelector("#passHistoryModal");
  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

function applyPassDesign() {
  const papers = document.querySelectorAll(".pass-paper");
  for (const paper of papers) {
    paper.style.setProperty("--pass-accent", passDesign.accent);
    paper.style.setProperty("--pass-logo-size", `${passDesign.logoSize}px`);
    paper.style.setProperty("--pass-logo-offset", `${passDesign.logoOffset}px`);
    paper.style.setProperty("--pass-brand-size", `${passDesign.brandSize}px`);
    paper.style.setProperty("--pass-brand-color", passDesign.brandColor);
    paper.style.setProperty("--pass-brand-offset-x", `${passDesign.brandOffsetX}px`);
    paper.style.setProperty("--pass-brand-offset-y", `${passDesign.brandOffsetY}px`);
    paper.style.setProperty("--pass-qr-size", `${passDesign.qrSize}px`);
    paper.style.setProperty("--pass-font-size", `${passDesign.fontSize}px`);
    paper.classList.toggle("bg-plain", passDesign.background === "plain");
    paper.classList.toggle("bg-soft", passDesign.background === "soft");
    paper.classList.toggle("hide-pass-photo", !passDesign.showPhoto);
    paper.classList.toggle("hide-pass-sign", !passDesign.showSign);
  }
  document.querySelectorAll("#passBrandText, .designerBrandText").forEach(el => {
    el.textContent = passDesign.brand || "CJ LOGISTICS";
  });
  document.querySelectorAll(".pass-logo").forEach(img => {
    img.src = passDesign.logoSrc || defaultDesign.logoSrc;
  });
  syncDesignControls();
}

function syncDesignControls() {
  const controls = {
    designBrand: passDesign.brand,
    designAccent: passDesign.accent,
    designLogoSize: passDesign.logoSize,
    designLogoOffset: passDesign.logoOffset,
    designBrandSize: passDesign.brandSize,
    designBrandColor: passDesign.brandColor,
    designBrandOffsetX: passDesign.brandOffsetX,
    designBrandOffsetY: passDesign.brandOffsetY,
    designQrSize: passDesign.qrSize,
    designFontSize: passDesign.fontSize,
    designBackground: passDesign.background,
    designShowPhoto: passDesign.showPhoto,
    designShowSign: passDesign.showSign
  };
  for (const [id, value] of Object.entries(controls)) {
    const el = document.querySelector(`#${id}`);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(value);
    else el.value = value;
  }
}

function updateDesignFromControls(save = false) {
  passDesign = {
    brand: document.querySelector("#designBrand").value || "CJ LOGISTICS",
    accent: document.querySelector("#designAccent").value,
    logoSrc: passDesign.logoSrc || defaultDesign.logoSrc,
    logoSize: Number(document.querySelector("#designLogoSize").value),
    logoOffset: Number(document.querySelector("#designLogoOffset").value),
    brandSize: Number(document.querySelector("#designBrandSize").value),
    brandColor: document.querySelector("#designBrandColor").value,
    brandOffsetX: Number(document.querySelector("#designBrandOffsetX").value),
    brandOffsetY: Number(document.querySelector("#designBrandOffsetY").value),
    qrSize: Number(document.querySelector("#designQrSize").value),
    fontSize: Number(document.querySelector("#designFontSize").value),
    background: document.querySelector("#designBackground").value,
    showPhoto: document.querySelector("#designShowPhoto").checked,
    showSign: document.querySelector("#designShowSign").checked
  };
  applyPassDesign();
  if (save) saveDesignState();
}

function showVerdict(visible) {
  const dialog = document.querySelector("#verdict");
  if (!dialog) return;
  dialog.classList.toggle("is-hidden", !visible);
  if (visible) {
    if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return;
  }
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function lookupPass() {
  const pass = passByCode(document.querySelector("#scanCode").value);
  selectedPass = pass || null;
  const status = document.querySelector(".verdict-status");
  const photo = document.querySelector("#scanPhoto");
  const name = document.querySelector("#scanName");
  const meta = document.querySelector("#scanMeta");
  const chips = document.querySelector("#scanChips");
  status.className = "verdict-status pending";
  if (!pass) {
    status.textContent = "ไม่พบใบผ่าน";
    status.classList.add("reject");
    name.textContent = "-";
    meta.textContent = "ตรวจสอบเลขใบผ่านหรือ QR token อีกครั้ง";
    photo.removeAttribute("src");
    chips.innerHTML = "";
    showVerdict(false);
    return null;
  }
  showVerdict(true);
  const visitor = visitorById(pass.visitorId);
  const zone = document.querySelector("#scanZone").value;
  const zoneInfo = getZones().find(z => z.id === zone);
  const allowed = pass.allowedZones.includes(zone);
  const expired = isExpired(pass);
  const matchedBan = activeBanFor({
    nationalId: visitor.nationalIdKey,
    fullName: visitor.fullName,
    vehicle: visitor.vehicle
  });
  name.textContent = visitor.fullName;
  photo.src = normalizeImageUrl(visitor.faceImage || visitor.faceImageUrl);
  meta.textContent = `${pass.passNo} · ${visitor.company || "-"} · เอกสาร ${visitor.nationalIdMasked}`;
  chips.innerHTML = [
    `อนุญาต: ${pass.allowedZoneNames.join(", ")}`,
    `อายุใบผ่าน: ไม่หมดอายุ`,
    `ทะเบียน: ${visitor.vehicle || "-"}`,
    `จุดตรวจ: ${zoneInfo.name}`
  ].map(t => `<span class="chip">${t}</span>`).join("");
  status.className = "verdict-status";
  if (matchedBan && matchedBan.action !== "watch_only") {
    status.textContent = `ไม่อนุญาต: อยู่ในรายการแบน`;
    status.classList.add("reject");
    chips.innerHTML += `<span class="chip">ความผิด: ${matchedBan.offense}</span>`;
  } else if (matchedBan) {
    status.textContent = "ต้องตรวจสอบ: อยู่ในรายการเฝ้าระวัง";
    status.classList.add("warn");
    chips.innerHTML += `<span class="chip">เฝ้าระวัง: ${matchedBan.offense}</span>`;
  } else if (expired) {
    status.textContent = "ไม่อนุญาต: ใบผ่านหมดอายุ";
    status.classList.add("reject");
  } else if (!allowed) {
    status.textContent = "ไม่อนุญาต: ไม่มีสิทธิ์เข้าโซนนี้";
    status.classList.add("reject");
  } else {
    status.textContent = "อนุญาตเข้าโซน";
    status.classList.add("allow");
  }
  document.querySelector("#scanCode").value = pass.passNo;
  return pass;
}

function addLog(action) {
  if (!selectedPass) return;
  if (action === "check_in" && !hasPermission("check_in")) {
    alert("บัญชีนี้ไม่มีสิทธิ์เช็คอินเข้าพื้นที่");
    return;
  }
  if (action === "check_out" && !hasPermission("check_out")) {
    alert("บัญชีนี้ไม่มีสิทธิ์เช็คเอาท์ออกพื้นที่");
    return;
  }
  if (action === "deny" && !hasPermission("deny")) {
    alert("บัญชีนี้ไม่มีสิทธิ์ปฏิเสธรายการ");
    return;
  }
  const scannedZone = getZones().find(z => z.id === document.querySelector("#scanZone").value);
  const zone = action === "check_out" ? { id: "MAINGATE", name: "Maingate" } : scannedZone;
  const visitor = visitorById(selectedPass.visitorId);
  const matchedBan = activeBanFor({
    nationalId: visitor?.nationalIdKey,
    fullName: visitor?.fullName,
    vehicle: visitor?.vehicle
  });
  const allowed = action === "check_out"
    || (selectedPass.allowedZones.includes(zone.id) && !isExpired(selectedPass) && !(matchedBan && matchedBan.action !== "watch_only"));
  const log = {
    logId: `L-${Date.now()}`,
    passNo: selectedPass.passNo,
    visitorId: selectedPass.visitorId,
    zoneId: zone.id,
    zoneName: zone.name,
    action,
    result: action === "deny" || !allowed ? "blocked" : "allowed",
    reason: matchedBan ? "visitor_blacklisted" : (!allowed ? "zone_not_allowed_or_expired" : ""),
    operator: activeUser().displayName || "Security Desk",
    createdAt: nowIso()
  };
  state.logs.push(log);
  apiPost("addZoneLog", log);
  if (action === "check_out") selectedPass.status = "checked_out";
  if (action === "check_in") selectedPass.status = "active";
  saveState();
  render();
  lookupPass();
}

function exportCsv(type) {
  const rows = {
    visitors: state.visitors,
    passes: state.passes.map(p => ({ ...p, allowedZones: p.allowedZones.join("|"), allowedZoneNames: p.allowedZoneNames.join("|") })),
    logs: state.logs,
    bans: state.bans || []
  }[type];
  const headers = Object.keys(rows[0] || { empty: "" });
  const csv = [headers.join(",")].concat(rows.map(row =>
    headers.map(h => `"${String(row[h] ?? "").replaceAll('"', '""')}"`).join(",")
  )).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${type}-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function syncSettingsControls() {
  const mapping = {
    setPassPrefix: appSettings.passPrefix,
    setQrMode: appSettings.qrMode,
    setCheckoutGrace: appSettings.checkoutGrace,
    setMaskNationalId: appSettings.maskNationalId,
    setRequireConsent: appSettings.requireConsent,
    setBlockExpired: appSettings.blockExpired,
    setAuditView: appSettings.auditView,
    setRetentionDays: appSettings.retentionDays,
    setAlertOverdue: appSettings.alertOverdue,
    setAlertDenied: appSettings.alertDenied,
    setAlertRestricted: appSettings.alertRestricted,
    setAlertChannel: appSettings.alertChannel,
    setSheetUrl: appSettings.sheetUrl,
    setAppsScriptUrl: appSettings.appsScriptUrl,
    setExportFormat: appSettings.exportFormat,
    setReportCycle: appSettings.reportCycle
  };
  for (const [id, value] of Object.entries(mapping)) {
    const el = document.querySelector(`#${id}`);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(value);
    else el.value = value;
  }
}

function updateSettingsFromControls(save = false) {
  appSettings = {
    defaultPassHours: appSettings.defaultPassHours || defaultSettings.defaultPassHours,
    passPrefix: document.querySelector("#setPassPrefix").value || defaultSettings.passPrefix,
    qrMode: document.querySelector("#setQrMode").value,
    checkoutGrace: document.querySelector("#setCheckoutGrace").value,
    maskNationalId: document.querySelector("#setMaskNationalId").checked,
    requireConsent: document.querySelector("#setRequireConsent").checked,
    blockExpired: document.querySelector("#setBlockExpired").checked,
    auditView: document.querySelector("#setAuditView").checked,
    retentionDays: document.querySelector("#setRetentionDays").value,
    alertOverdue: document.querySelector("#setAlertOverdue").checked,
    alertDenied: document.querySelector("#setAlertDenied").checked,
    alertRestricted: document.querySelector("#setAlertRestricted").checked,
    alertChannel: document.querySelector("#setAlertChannel").value,
    sheetUrl: document.querySelector("#setSheetUrl").value,
    appsScriptUrl: document.querySelector("#setAppsScriptUrl").value,
    exportFormat: document.querySelector("#setExportFormat").value,
    reportCycle: document.querySelector("#setReportCycle").value
  };
  document.querySelector("#pvPassNo").textContent = passNumber();
  document.querySelector("#qrBox").innerHTML = createQrImage(passCheckinUrl(passNumber()));
  if (save) saveSettingsState();
}

function resetZoneForm() {
  document.querySelector("#zoneEditId").value = "";
  document.querySelector("#zoneId").value = "";
  document.querySelector("#zoneName").value = "";
  document.querySelector("#zoneLevel").value = "Standard";
  document.querySelector("#zoneApproval").checked = false;
}

function resetUserForm() {
  document.querySelector("#userEditId").value = "";
  document.querySelector("#userName").value = "";
  document.querySelector("#userDisplayName").value = "";
  document.querySelector("#userPasscode").value = "";
  document.querySelector("#userPasscode").placeholder = "ตั้งรหัสสำหรับเข้าใช้งาน";
  document.querySelector("#userRole").value = "Security-Guard";
  document.querySelector("#userStatus").value = "pending";
  document.querySelector("#userName").disabled = false;
}

function openUserDialog(title = "จัดการผู้ใช้") {
  const dialog = document.querySelector("#userEditorDialog");
  const titleEl = document.querySelector("#userDialogTitle");
  if (titleEl) titleEl.textContent = title;
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeUserDialog() {
  const dialog = document.querySelector("#userEditorDialog");
  if (!dialog) return;
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function clearBanForm() {
  document.querySelector("#banForm").reset();
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.querySelector("#banIncidentDate").value = local;
}

function saveBan(event) {
  event.preventDefault();
  const nationalId = document.querySelector("#banNationalId").value;
  const fullName = document.querySelector("#banFullName").value.trim();
  const ban = {
    banId: `B-${Date.now()}`,
    nationalIdKey: normalizeId(nationalId),
    nationalIdMasked: maskId(nationalId),
    fullName,
    company: document.querySelector("#banCompany").value.trim(),
    vehicle: document.querySelector("#banVehicle").value.trim(),
    category: document.querySelector("#banCategory").value,
    severity: document.querySelector("#banSeverity").value,
    incidentDate: new Date(document.querySelector("#banIncidentDate").value).toISOString(),
    officer: document.querySelector("#banOfficer").value.trim(),
    action: document.querySelector("#banAction").value,
    expiresAt: document.querySelector("#banExpiresAt").value || "",
    offense: document.querySelector("#banOffense").value.trim(),
    evidence: document.querySelector("#banEvidence").value.trim(),
    status: "active",
    createdAt: nowIso()
  };
  const existing = activeBanFor({ nationalId, fullName, vehicle: ban.vehicle });
  if (existing && !confirm("พบรายการแบนที่ active อยู่แล้ว ต้องการบันทึกเพิ่มอีกหรือไม่")) return;
  state.bans = state.bans || [];
  state.bans.push(ban);
  saveState();
  apiPost("createBan", ban);
  clearBanForm();
  renderBans();
  alert("บันทึกรายการแบนแล้ว");
}

function unbanVisitor(banId) {
  const ban = (state.bans || []).find(item => item.banId === banId);
  if (!ban) return;
  if (!confirm(`ยกเลิกแบน ${ban.fullName} หรือไม่`)) return;
  ban.status = "inactive";
  ban.closedAt = nowIso();
  saveState();
  apiPost("updateBanStatus", { banId: ban.banId, status: ban.status, closedAt: ban.closedAt });
  renderBans();
}

function saveUser(event) {
  event.preventDefault();
  if (!hasPermission("manage_users")) {
    alert("เฉพาะ Admin เท่านั้นที่จัดการผู้ใช้งานได้");
    return;
  }
  const editId = document.querySelector("#userEditId").value;
  const username = document.querySelector("#userName").value.trim().toLowerCase();
  const displayName = document.querySelector("#userDisplayName").value.trim();
  const passcode = document.querySelector("#userPasscode").value.trim();
  const role = document.querySelector("#userRole").value;
  const status = document.querySelector("#userStatus").value;
  if (!username || !displayName) return;
  state.users = state.users?.length ? state.users : [defaultAdminUser];
  if (state.users.some(user => user.username.toLowerCase() === username && user.userId !== editId)) {
    alert("ชื่อผู้ใช้นี้มีอยู่แล้ว");
    return;
  }
  if (editId) {
    const user = state.users.find(item => item.userId === editId);
    if (!user) return;
    user.username = username;
    user.displayName = displayName;
    if (passcode) user.passcode = passcode;
    user.role = role;
    user.status = user.userId === "U-ADMIN" ? "active" : status;
    user.updatedAt = nowIso();
  } else {
    state.users.push({
      userId: `U-${Date.now()}`,
      username,
      displayName,
      passcode: passcode || "1234",
      role,
      status,
      createdAt: nowIso()
    });
  }
  saveState();
  apiPost("saveUsers", {
    users: state.users.map(user => ({ ...user, passcode: user.passcode ? "SET" : "" }))
  });
  resetUserForm();
  renderUsers();
  closeUserDialog();
}

function editUser(userId) {
  if (!hasPermission("manage_users")) return;
  const user = (state.users || []).find(item => item.userId === userId);
  if (!user) return;
  document.querySelector("#userEditId").value = user.userId;
  document.querySelector("#userName").value = user.username;
  document.querySelector("#userDisplayName").value = user.displayName;
  document.querySelector("#userPasscode").value = "";
  document.querySelector("#userPasscode").placeholder = "เว้นว่างไว้ถ้าไม่เปลี่ยนรหัส";
  document.querySelector("#userRole").value = user.role;
  document.querySelector("#userStatus").value = user.status;
  document.querySelector("#userName").disabled = user.userId === "U-ADMIN";
  openUserDialog(user.status === "pending" ? "อนุมัติผู้ใช้" : "แก้ไขผู้ใช้");
}

function deactivateUser(userId) {
  if (!hasPermission("manage_users")) return;
  const user = (state.users || []).find(item => item.userId === userId);
  if (!user || user.userId === "U-ADMIN") return;
  if (!confirm(`ปิดใช้งาน ${user.displayName} หรือไม่`)) return;
  user.status = "inactive";
  user.updatedAt = nowIso();
  syncUsers();
  renderUsers();
}

function saveZone(event) {
  event.preventDefault();
  const editId = document.querySelector("#zoneEditId").value;
  const id = normalizeZoneId(document.querySelector("#zoneId").value);
  const name = document.querySelector("#zoneName").value.trim();
  const level = document.querySelector("#zoneLevel").value.trim() || "Standard";
  const approval = document.querySelector("#zoneApproval").checked;
  if (!id || !name) return;
  const zonesList = getZones().map(z => ({ ...z }));
  if (zonesList.some(z => z.id === id && z.id !== editId)) {
    alert("รหัสโซนนี้มีอยู่แล้ว");
    return;
  }
  if (editId) {
    const index = zonesList.findIndex(z => z.id === editId);
    if (index >= 0) {
      zonesList[index] = { id, name, level, approval };
      syncZoneReferences(editId, { id, name });
    }
  } else {
    zonesList.push({ id, name, level, approval });
  }
  state.zones = zonesList;
  saveState();
  apiPost("saveZones", {
    zones: state.zones.map(zone => ({ ...zone, approval: String(Boolean(zone.approval)) }))
  });
  fillZones();
  resetZoneForm();
}

function syncZoneReferences(oldId, nextZone) {
  state.passes = state.passes.map(pass => {
    const allowedZones = (pass.allowedZones || []).map(zoneId => zoneId === oldId ? nextZone.id : zoneId);
    const allowedZoneNames = allowedZones.map(zoneId => {
      if (zoneId === nextZone.id) return nextZone.name;
      return getZones().find(zone => zone.id === zoneId)?.name || zoneId;
    });
    return { ...pass, allowedZones, allowedZoneNames };
  });
  state.logs = state.logs.map(log => (
    log.zoneId === oldId ? { ...log, zoneId: nextZone.id, zoneName: nextZone.name } : log
  ));
}

function editZone(id) {
  const zone = getZones().find(z => z.id === id);
  if (!zone) return;
  document.querySelector("#zoneEditId").value = zone.id;
  document.querySelector("#zoneId").value = zone.id;
  document.querySelector("#zoneName").value = zone.name;
  document.querySelector("#zoneLevel").value = zone.level;
  document.querySelector("#zoneApproval").checked = zone.approval;
}

function deleteZone(id) {
  const used = state.passes.some(pass => pass.allowedZones?.includes(id)) || state.logs.some(log => log.zoneId === id);
  const message = used
    ? "โซนนี้มีประวัติการใช้งานอยู่ ต้องการลบออกจากรายการใช้งานต่อไปหรือไม่"
    : "ต้องการลบโซนนี้หรือไม่";
  if (!confirm(message)) return;
  state.zones = getZones().filter(z => z.id !== id);
  saveState();
  apiPost("saveZones", {
    zones: state.zones.map(zone => ({ ...zone, approval: String(Boolean(zone.approval)) }))
  });
  fillZones();
  resetZoneForm();
}

function handleScannedQr(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || value === lastScannedQr) return;
  lastScannedQr = value;
  document.querySelector("#scanCode").value = value;
  const pass = lookupPass();
  if (!pass) {
    alert("QR Code ไม่ถูกต้อง หรือไม่พบใบผ่านในระบบ");
    setTimeout(() => {
      if (lastScannedQr === value) lastScannedQr = "";
    }, 1600);
    return;
  }
  stopScanner();
  const actionBtn = hasPermission("check_in")
    ? document.querySelector("#checkInBtn")
    : document.querySelector("#checkOutBtn");
  actionBtn?.focus();
}

async function startScanner() {
  lastScannedQr = "";
  scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  const video = document.querySelector("#scanVideo");
  video.srcObject = scannerStream;
  video.style.display = "block";
  document.querySelector("#scannerFallback").style.display = "none";
  if (!("BarcodeDetector" in window)) {
    document.querySelector("#scannerFallback").style.display = "block";
    document.querySelector("#scannerFallback").textContent = "เบราว์เซอร์นี้สแกน QR ในเว็บไม่ได้ ให้ใช้กล้องมือถือสแกน QR หรือกรอกเลขใบผ่านแทน";
    return;
  }
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const tick = async () => {
    if (!scannerStream) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        handleScannedQr(codes[0].rawValue);
      }
    } catch {}
    requestAnimationFrame(tick);
  };
  tick();
}

function createQrSvg(text) {
  const size = 21;
  const modules = Array.from({ length: size }, () => Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (r, c, v, res = true) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = !!v;
    if (res) reserved[r][c] = true;
  };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const in7 = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      set(rr, cc, in7 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
    }
  };
  finder(0, 0); finder(0, 14); finder(14, 0);
  for (let i = 8; i <= 12; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (let i = 0; i < 9; i++) { set(8, i, false); set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, 20 - i, false); set(20 - i, 8, false); }
  set(13, 8, true);
  const alpha = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(2, 4); push(text.length, 9);
  for (let i = 0; i < text.length; i += 2) {
    if (i + 1 < text.length) push(alpha.indexOf(text[i]) * 45 + alpha.indexOf(text[i + 1]), 11);
    else push(alpha.indexOf(text[i]), 6);
  }
  push(0, Math.min(4, 152 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < 19; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);
  const mul = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 255;
  };
  const gen = [87, 229, 146, 149, 238, 102, 21];
  const ecc = Array(7).fill(0);
  for (const b of data) {
    const factor = b ^ ecc.shift();
    ecc.push(0);
    for (let i = 0; i < gen.length; i++) ecc[i] ^= mul(gen[i], factor);
  }
  const db = [];
  for (const b of data.concat(ecc)) push.call(null, b, 8);
  db.push(...bits.splice(0, 0));
  const allBits = [];
  for (const b of data.concat(ecc)) for (let i = 7; i >= 0; i--) allBits.push((b >> i) & 1);
  const mask = (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
  let idx = 0, up = true;
  for (let c = 20; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let j = 0; j < size; j++) {
      const r = up ? 20 - j : j;
      for (let dc = 0; dc < 2; dc++) {
        const cc = c - dc;
        if (!reserved[r][cc]) {
          let bit = idx < allBits.length ? allBits[idx++] === 1 : false;
          if (mask(r, cc)) bit = !bit;
          modules[r][cc] = bit;
        }
      }
    }
    up = !up;
  }
  const fmt = 0b110011000101111;
  for (let i = 0; i <= 5; i++) modules[8][i] = ((fmt >> i) & 1) === 1;
  modules[8][7] = ((fmt >> 6) & 1) === 1;
  modules[8][8] = ((fmt >> 7) & 1) === 1;
  modules[7][8] = ((fmt >> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) modules[14 - i][8] = ((fmt >> i) & 1) === 1;
  for (let i = 0; i < 8; i++) modules[20 - i][8] = ((fmt >> i) & 1) === 1;
  for (let i = 8; i < 15; i++) modules[8][6 + i] = ((fmt >> i) & 1) === 1;
  modules[13][8] = true;
  const q = 4, scale = 5, total = (size + q * 2) * scale;
  let rects = "";
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (modules[r][c]) rects += `<rect x="${(c + q) * scale}" y="${(r + q) * scale}" width="${scale}" height="${scale}"/>`;
  }
  return `<svg viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

function bindEvents() {
  document.querySelector("#loginForm").addEventListener("submit", loginUser);
  document.querySelector("#signupForm").addEventListener("submit", signupUser);
  document.querySelector("#showSignup").addEventListener("click", () => showAuthPanel("signup"));
  document.querySelector("#showLogin").addEventListener("click", () => showAuthPanel("login"));
  document.querySelector("#logoutBtn").addEventListener("click", logoutUser);
  document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  document.querySelectorAll("[data-jump]").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.jump)));
  document.querySelector("#toggleDashboardRows").addEventListener("click", () => {
    dashboardShowAll = !dashboardShowAll;
    renderDashboard();
  });
  ["dashboardFilterText", "dashboardFilterStatus", "dashboardFilterZone"].forEach(id => {
    document.querySelector(`#${id}`).addEventListener("input", renderDashboard);
    document.querySelector(`#${id}`).addEventListener("change", renderDashboard);
  });
  document.querySelector("#latestRows").addEventListener("click", event => {
    const btn = event.target.closest("[data-view-pass]");
    if (btn) renderHistoryPass(btn.dataset.viewPass);
  });
  document.querySelector("#closePassHistory").addEventListener("click", () => {
    document.querySelector("#passHistoryModal").close();
  });
  document.querySelector("#visitorForm").addEventListener("input", e => updatePreview(e.currentTarget));
  document.querySelector("#visitorForm").addEventListener("submit", savePass);
  const globalSearch = document.querySelector("#globalSearch");
  const searchResults = document.querySelector("#searchResults");
  if (globalSearch && searchResults) {
    globalSearch.addEventListener("input", renderSearchResults);
    globalSearch.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      const first = buildSearchRows(event.currentTarget.value)[0];
      if (first) openPassFromSearch(first.pass.passNo);
    });
    searchResults.addEventListener("click", event => {
      const item = event.target.closest("[data-pass]");
      if (item) openPassFromSearch(item.dataset.pass);
    });
  }
  document.addEventListener("click", event => {
    if (!event.target.closest(".global-search")) document.querySelector("#searchResults")?.classList.remove("open");
  });
  document.querySelector("#startCamera").addEventListener("click", () => startCamera().catch(err => alert(err.message)));
  document.querySelector("#capturePhoto").addEventListener("click", capturePhoto);
  document.querySelector("#backToForm").addEventListener("click", () => {
    stopCamera();
    showRegisterStep("form");
  });
  document.querySelector("#uploadPhoto").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(reader.result);
      stopCamera();
      createPassFromPendingRegistration();
    };
    reader.readAsDataURL(file);
  });
  document.querySelector("#documentType").addEventListener("change", updateDocumentTypeUi);
  document.querySelector("#scanCode").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const pass = lookupPass();
    if (!pass) alert("ไม่พบใบผ่าน กรุณาตรวจสอบเลขใบผ่านหรือ QR อีกครั้ง");
  });
  document.querySelector("#checkInBtn").addEventListener("click", () => addLog("check_in"));
  document.querySelector("#checkOutBtn").addEventListener("click", () => addLog("check_out"));
  document.querySelector("#denyBtn").addEventListener("click", () => addLog("deny"));
  document.querySelector("#closeVerdict").addEventListener("click", () => showVerdict(false));
  document.querySelector("#startScanner").addEventListener("click", () => startScanner().catch(err => alert(err.message)));
  document.querySelector("#insideSearch").addEventListener("input", renderInside);
  document.querySelector("#banSearch").addEventListener("input", renderBans);
  document.querySelector("#banForm").addEventListener("submit", saveBan);
  document.querySelector("#clearBanForm").addEventListener("click", clearBanForm);
  document.querySelector("#banRows").addEventListener("click", event => {
    const btn = event.target.closest("[data-unban]");
    if (btn) unbanVisitor(btn.dataset.unban);
  });
  document.querySelector("#insideRows").addEventListener("click", event => {
    const btn = event.target.closest(".row-checkout");
    if (!btn) return;
    selectedPass = passByCode(btn.dataset.pass);
    addLog("check_out");
  });
  document.querySelectorAll("[data-export]").forEach(btn => btn.addEventListener("click", () => exportCsv(btn.dataset.export)));
  document.querySelector("#printPass").addEventListener("click", () => {
    completingAfterPrint = true;
    window.print();
    setTimeout(completeRegistrationFlow, 700);
  });
  window.addEventListener("afterprint", completeRegistrationFlow);
  document.querySelector("#newRegistration").addEventListener("click", resetRegistrationFlow);
  [
    "setPassPrefix", "setQrMode", "setCheckoutGrace", "setMaskNationalId",
    "setRequireConsent", "setBlockExpired", "setAuditView", "setRetentionDays", "setAlertOverdue",
    "setAlertDenied", "setAlertRestricted", "setAlertChannel", "setSheetUrl", "setAppsScriptUrl",
    "setExportFormat", "setReportCycle"
  ].forEach(id => {
    document.querySelector(`#${id}`).addEventListener("input", () => updateSettingsFromControls(false));
    document.querySelector(`#${id}`).addEventListener("change", () => updateSettingsFromControls(false));
  });
  document.querySelector("#saveSettings").addEventListener("click", () => {
    updateSettingsFromControls(true);
    apiPost("saveSettings", {
      settings: Object.entries(appSettings).map(([key, value]) => ({ key, value: String(value) }))
    });
    setDefaultExpiry();
    alert("บันทึกตั้งค่าระบบแล้ว");
  });
  document.querySelector("#resetSettings").addEventListener("click", () => {
    appSettings = { ...defaultSettings };
    saveSettingsState();
    syncSettingsControls();
    updateSettingsFromControls(false);
    setDefaultExpiry();
  });
  document.querySelector("#zoneForm").addEventListener("submit", saveZone);
  document.querySelector("#cancelZoneEdit").addEventListener("click", resetZoneForm);
  document.querySelector("#zoneList").addEventListener("click", event => {
    const edit = event.target.closest(".edit-zone");
    const del = event.target.closest(".delete-zone");
    if (edit) editZone(edit.dataset.zone);
    if (del) deleteZone(del.dataset.zone);
  });
  document.querySelector("#userForm").addEventListener("submit", saveUser);
  document.querySelector("#addUserBtn").addEventListener("click", () => {
    resetUserForm();
    openUserDialog("เพิ่มผู้ใช้");
  });
  document.querySelector("#cancelUserEdit").addEventListener("click", () => {
    closeUserDialog();
    resetUserForm();
  });
  document.querySelector("#closeUserDialog").addEventListener("click", () => {
    closeUserDialog();
    resetUserForm();
  });
  document.querySelector("#userRows").addEventListener("click", event => {
    const edit = event.target.closest(".edit-user");
    const del = event.target.closest(".delete-user");
    if (edit) editUser(edit.dataset.user);
    if (del) deactivateUser(del.dataset.user);
  });
  ["designBrand", "designAccent", "designLogoSize", "designLogoOffset", "designBrandSize", "designBrandColor", "designBrandOffsetX", "designBrandOffsetY", "designQrSize", "designFontSize", "designBackground", "designShowPhoto", "designShowSign"].forEach(id => {
    document.querySelector(`#${id}`).addEventListener("input", () => updateDesignFromControls(false));
    document.querySelector(`#${id}`).addEventListener("change", () => updateDesignFromControls(false));
  });
  document.querySelector("#designLogoUpload").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateDesignFromControls(false);
      passDesign.logoSrc = reader.result;
      applyPassDesign();
    };
    reader.readAsDataURL(file);
  });
  document.querySelector("#resetLogo").addEventListener("click", () => {
    updateDesignFromControls(false);
    passDesign.logoSrc = defaultDesign.logoSrc;
    document.querySelector("#designLogoUpload").value = "";
    applyPassDesign();
  });
  document.querySelector("#saveDesign").addEventListener("click", () => {
    updateDesignFromControls(true);
    alert("บันทึกดีไซน์ใบผ่านแล้ว");
  });
  document.querySelector("#resetDesign").addEventListener("click", () => {
    passDesign = { ...defaultDesign };
    saveDesignState();
    applyPassDesign();
  });
}

function init() {
  fillZones();
  updateDocumentTypeUi();
  setDefaultExpiry();
  clearBanForm();
  resetUserForm();
  bindEvents();
  syncSettingsControls();
  applyPassDesign();
  document.querySelector("#pvPassNo").textContent = passNumber();
  document.querySelector("#qrBox").innerHTML = createQrImage(passCheckinUrl(passNumber()));
  document.querySelector(".designerQr").innerHTML = createQrImage(passCheckinUrl("GP-2026-05-0001"));
  setInterval(() => {
    document.querySelector("#clock").textContent = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
    renderLoginState();
  }, 1000);
  setInterval(() => {
    touchPresence();
    renderUsers();
  }, 60000);
  render();
  openPassFromUrl();
  loadRemoteData();
}

init();
