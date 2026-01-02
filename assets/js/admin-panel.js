/* admin-panel.js — binds to existing HTML admin gate + panel
Requires: utils.js, storage.js
Exposes: window.Eirlylu.admin.init()
*/
(() => {
"use strict";

const E = (window.Eirlylu ||= {});
const U = E.utils || {};
const S = E.storage;

if (!S) return;

const qs = U.qs || ((sel, root = document) => root.querySelector(sel));
const safeText = U.safeText || ((s, n = 2000) => String(s ?? "").trim().slice(0, n));
const isDigits = U.isDigits || ((s, len) => {
const t = String(s ?? "");
return (len ? t.length === len : true) && /^[0-9]+$/.test(t);
});
const normalizeUrl = U.normalizeUrl || ((u) => String(u ?? "").trim());
const randomId = U.randomId || (() => `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);
const downloadJson = U.downloadJson || ((name, obj) => {
const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = name || "export.json";
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
});
const readJsonFile = U.readJsonFile || ((file) => new Promise((resolve, reject) => {
const r = new FileReader();
r.onload = () => { try { resolve(JSON.parse(String(r.result || ""))); } catch (e) { reject(e); } };
r.onerror = () => reject(r.error || new Error("File read error"));
r.readAsText(file);
}));

// State
let pinInMemory = "";
let staffList = [];

// Session keys (unlock only this tab session)
const SS_UNLOCK = "eirlylu.admin.unlocked.v1";
const SS_PIN = "eirlylu.admin.pin.v1";

function showGate() {
const dlg = qs("#adminGateModal");
const input = qs("#adminCodeInput");
const err = qs("#adminGateError");
if (!dlg) return;

if (err) err.textContent = "";
if (input) input.value = "";

if (typeof dlg.showModal === "function") dlg.showModal();
else dlg.setAttribute("open", "open");
if (input) setTimeout(() => input.focus(), 50);
}

function hideGate() {
const dlg = qs("#adminGateModal");
if (!dlg) return;
if (typeof dlg.close === "function") dlg.close();
else dlg.removeAttribute("open");
}

function showPanel() {
const panel = qs("#adminPanel");
if (!panel) return;
panel.classList.add("is-visible");
panel.setAttribute("aria-hidden", "false");
panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hidePanel() {
const panel = qs("#adminPanel");
if (!panel) return;
panel.classList.remove("is-visible");
panel.setAttribute("aria-hidden", "true");
}

function setGateError(msg) {
const err = qs("#adminGateError");
if (err) err.textContent = msg || "";
}

function setStaffFormStatus(msg, isError = false) {
const el = qs("#staffFormStatus");
if (!el) return;
el.textContent = msg || "";
el.style.color = isError ? "rgba(255,120,150,0.95)" : "";
}

function setImportStatus(msg, isError = false) {
const el = qs("#importStatus");
if (!el) return;
el.textContent = msg || "";
el.style.color = isError ? "rgba(255,120,150,0.95)" : "";
}

function normalizeOrder() {
staffList.forEach((x, i) => {
x.order = i;
x.updatedAt = new Date().toISOString();
});
}

function clearStaffForm() {
const idEl = qs("#staffId");
const nameEl = qs("#staffName");
const bioEl = qs("#staffBio");
const avEl = qs("#staffAvatarUrl");
if (idEl) idEl.value = "";
if (nameEl) nameEl.value = "";
if (bioEl) bioEl.value = "";
if (avEl) avEl.value = "";
setStaffFormStatus("");
}

function fillStaffForm(item) {
const idEl = qs("#staffId");
const nameEl = qs("#staffName");
const bioEl = qs("#staffBio");
const avEl = qs("#staffAvatarUrl");
if (idEl) idEl.value = item?.id || "";
if (nameEl) nameEl.value = item?.nickname || "";
if (bioEl) bioEl.value = item?.intro || "";
if (avEl) avEl.value = item?.avatarUrl || "";
setStaffFormStatus("");
}

function findIndexById(id) {
return staffList.findIndex((x) => x.id === id);
}

async function persist(preferRemote = true) {
normalizeOrder();

// If no PIN, we still allow local save (so user doesn't lose work)
const endpoint = S.getStaffEndpoint?.() || "";
const canRemote = preferRemote && endpoint;

try {
if (canRemote) {
await S.saveStaff(staffList, { pin: pinInMemory });
setStaffFormStatus("已同步更新（所有端刷新後一致）。");
} else {
await S.saveStaff(staffList, { endpoint: "" }); // force local
setStaffFormStatus("已更新本機資料（未同步到雲端）。");
}
} catch (e) {
const m = String(e?.message || e);
if (m.includes("UNAUTHORIZED")) {
setStaffFormStatus("PIN 不正確，無法寫入雲端；已先保存本機資料。", true);
} else {
setStaffFormStatus("寫入雲端失敗；已先保存本機資料。", true);
}
// local fallback
try { await S.saveStaff(staffList, { endpoint: "" }); } catch {}
}

// Let public page re-render
window.dispatchEvent(new Event("eirlylu:staff-updated"));
}

function renderAdminList() {
const listEl = qs("#adminStaffList");
const emptyEl = qs("#adminStaffEmptyState");
if (!listEl) return;

listEl.innerHTML = "";

if (!staffList.length) {
const st = document.createElement("div");
st.className = "empty-state";
st.id = "adminStaffEmptyState";
st.innerHTML = `<p class="muted">尚無管理人員。請先於左側表單新增。</p>`;
listEl.appendChild(st);
return;
}

for (let i = 0; i < staffList.length; i++) {
const s = staffList[i];
const row = document.createElement("div");
row.className = "admin-row";
row.dataset.id = s.id;

const avatarUrl = s.avatarUrl || "assets/img/ui/placeholder-avatar.png";

row.innerHTML = `
<div class="admin-row__top">
<div class="admin-row__left">
<img class="admin-row__avatar" alt="" />
<div class="admin-row__meta">
<div class="admin-row__name"></div>
<div class="admin-row__bio"></div>
</div>
</div>
<div class="admin-row__actions">
<button class="btn btn--ghost" type="button" data-act="up">上移</button>
<button class="btn btn--ghost" type="button" data-act="down">下移</button>
<button class="btn btn--secondary" type="button" data-act="edit">編輯</button>
<button class="btn btn--ghost" type="button" data-act="del">刪除</button>
</div>
</div>
`;

const img = qs(".admin-row__avatar", row);
const nameEl = qs(".admin-row__name", row);
const bioEl = qs(".admin-row__bio", row);

img.src = avatarUrl;
img.onerror = () => { img.onerror = null; img.src = "assets/img/ui/placeholder-avatar.png"; };
nameEl.textContent = s.nickname || "（未命名）";
bioEl.textContent = s.intro || "";

// Actions
const btnUp = qs('[data-act="up"]', row);
const btnDown = qs('[data-act="down"]', row);
const btnEdit = qs('[data-act="edit"]', row);
const btnDel = qs('[data-act="del"]', row);

btnUp.disabled = i === 0;
btnDown.disabled = i === staffList.length - 1;

btnUp.addEventListener("click", async () => {
const [x] = staffList.splice(i, 1);
staffList.splice(i - 1, 0, x);
renderAdminList();
await persist(true);
});

btnDown.addEventListener("click", async () => {
const [x] = staffList.splice(i, 1);
staffList.splice(i + 1, 0, x);
renderAdminList();
await persist(true);
});

btnEdit.addEventListener("click", () => {
fillStaffForm(s);
qs("#staffName")?.focus();
});

btnDel.addEventListener("click", async () => {
staffList.splice(i, 1);
clearStaffForm();
renderAdminList();
await persist(true);
});

listEl.appendChild(row);
}

if (emptyEl) emptyEl.remove();
}

async function reloadStaff(preferRemote = true) {
staffList = await S.loadStaff({ preferRemote });
normalizeOrder();
renderAdminList();
window.dispatchEvent(new Event("eirlylu:staff-updated"));
}

async function unlock() {
const input = qs("#adminCodeInput");
const code = safeText(input?.value || "", 16);

if (!isDigits(code, 8)) {
setGateError("請輸入 8 位數字。");
return;
}

pinInMemory = code;
sessionStorage.setItem(SS_UNLOCK, "1");
sessionStorage.setItem(SS_PIN, pinInMemory);

hideGate();
showPanel();

// After unlock, load remote first if endpoint exists
try {
await reloadStaff(true);
setStaffFormStatus("已載入管理人員資料。");
} catch {
await reloadStaff(false);
setStaffFormStatus("雲端載入失敗，已使用本機資料。", true);
}
}

function lock() {
pinInMemory = "";
sessionStorage.removeItem(SS_UNLOCK);
sessionStorage.removeItem(SS_PIN);
hidePanel();
clearStaffForm();
setStaffFormStatus("已鎖定。");
}

function wireButtons() {
// Open gate buttons
qs("#openAdminGate")?.addEventListener("click", showGate);
qs("#openAdminGateInline")?.addEventListener("click", showGate);

// Gate unlock
qs("#unlockAdmin")?.addEventListener("click", unlock);

// Allow Enter in input to unlock
qs("#adminCodeInput")?.addEventListener("keydown", (e) => {
if (e.key === "Enter") {
e.preventDefault();
unlock();
}
});

// Lock button
qs("#lockAdminBtn")?.addEventListener("click", lock);

// Export
qs("#exportDataBtn")?.addEventListener("click", () => {
downloadJson("staff.export.json", staffList);
setStaffFormStatus("已匯出 staff.export.json。");
});

// Staff form
qs("#staffForm")?.addEventListener("submit", async (e) => {
e.preventDefault();

const id = safeText(qs("#staffId")?.value || "", 80);
const nickname = safeText(qs("#staffName")?.value || "", 80);
const intro = safeText(qs("#staffBio")?.value || "", 2000);
const avatarUrl = normalizeUrl(qs("#staffAvatarUrl")?.value || "");

if (!nickname) {
setStaffFormStatus("暱稱不可為空。", true);
return;
}

const item = {
id: id || `staff_${randomId()}`,
nickname,
intro,
avatarUrl,
};

const idx = id ? findIndexById(id) : -1;
if (idx >= 0) staffList[idx] = { ...staffList[idx], ...item };
else staffList.push(item);

clearStaffForm();
renderAdminList();
await persist(true);
});

qs("#resetStaffFormBtn")?.addEventListener("click", () => {
clearStaffForm();
});

// Import
qs("#importDataBtn")?.addEventListener("click", async () => {
const file = qs("#importFileInput")?.files?.[0];
if (!file) {
setImportStatus("請先選擇 JSON 檔案。", true);
return;
}

try {
const obj = await readJsonFile(file);
if (!Array.isArray(obj)) throw new Error("EXPECTED_ARRAY");
staffList = obj;
normalizeOrder();
renderAdminList();
await persist(true);
setImportStatus("匯入完成。");
} catch (e) {
setImportStatus("匯入失敗：JSON 格式不正確或非陣列。", true);
}
});

// Reset local
qs("#resetLocalDataBtn")?.addEventListener("click", async () => {
try {
localStorage.removeItem("eirlylu.staff.cache.v1");
localStorage.removeItem("eirlylu.staff.cacheAt.v1");
setImportStatus("已重置本機資料。");
await reloadStaff(true);
} catch {
setImportStatus("重置失敗。", true);
}
});
}

function restoreUnlockState() {
const unlocked = sessionStorage.getItem(SS_UNLOCK) === "1";
const pin = sessionStorage.getItem(SS_PIN) || "";
if (unlocked && isDigits(pin, 8)) {
pinInMemory = pin;
showPanel();
} else {
hidePanel();
}
}

async function init() {
wireButtons();
restoreUnlockState();

// Preload staff (doesn't require unlock); remote if endpoint exists
try { await reloadStaff(true); } catch { await reloadStaff(false); }
}

E.admin = { init };
})();
