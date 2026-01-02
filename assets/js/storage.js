/* storage.js — staff sync via Cloudflare Workers + KV (with local fallback)
   Backward-compatible with app.js:
     - getStaff(): sync getter (cached/local)
     - setStaff(list): sync setter (cache/local)
   Modern API:
     - loadStaff({preferRemote})
     - saveStaff(list, {pin})
*/
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  const U = E.utils || {};

  const safeText = U.safeText || ((s, n = 2000) => String(s ?? "").trim().slice(0, n));
  const isValidHttpUrl = U.isValidHttpUrl || ((u) => {
    try { const x = new URL(String(u)); return x.protocol === "http:" || x.protocol === "https:"; }
    catch { return false; }
  });

  const LS_KEYS = {
    staffCache: "eirlylu.staff.cache.v1",
    staffCacheAt: "eirlylu.staff.cacheAt.v1",
    staffEndpoint: "eirlylu.staff.endpoint.v1"
  };

  let staffMem = null; // in-memory cache

  function nowIso() { return new Date().toISOString(); }

  function readJsonLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJsonLS(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  function getEndpointFromSiteDefaults() {
    const sd = E.siteDefaults || null; // app.js 應該在載入 defaults 後寫入這裡
    const url = sd?.api?.staffEndpoint;
    return (typeof url === "string" && url.trim()) ? url.trim() : "";
  }
   
function isDiscordActivityHost() {
  return /discordsays\.com$/i.test(location.hostname);
}

  function getStaffEndpoint() {
  // Discord Activity: force relative path so URL Mapping can proxy it
  if (isDiscordActivityHost()) return "/staff";

  const override = readJsonLS(LS_KEYS.staffEndpoint, "");
  if (typeof override === "string" && override.trim()) return override.trim();
  return getEndpointFromSiteDefaults();
}

  function setStaffEndpoint(url) {
    const u = String(url ?? "").trim();
    if (u && !isValidHttpUrl(u)) throw new Error("Invalid staffEndpoint URL");
    writeJsonLS(LS_KEYS.staffEndpoint, u);
  }

  function sanitizeStaffItem(item, index = 0) {
    const obj = (item && typeof item === "object") ? item : {};
    const id = safeText(obj.id || "").slice(0, 80) || `staff_${index}_${Date.now()}`;
    const nickname = safeText(obj.nickname || obj.name || "").slice(0, 80);
    const intro = safeText(obj.intro || obj.bio || obj.description || "").slice(0, 2000);
    const avatarUrl = safeText(obj.avatarUrl || obj.avatar || "").slice(0, 2000);

    return {
      id,
      nickname,
      intro,
      avatarUrl,
      order: Number.isFinite(Number(obj.order)) ? Number(obj.order) : index,
      updatedAt: safeText(obj.updatedAt || "") || nowIso()
    };
  }

  function sanitizeStaffList(list) {
    const arr = Array.isArray(list) ? list : [];
    const cleaned = arr.map((x, i) => sanitizeStaffItem(x, i));
    cleaned.forEach((x, i) => { x.order = i; });
    return cleaned;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
  }

  async function remoteLoadStaff(endpoint) {
    const res = await fetchWithTimeout(endpoint, { cache: "no-store" }, 9000);
    if (!res.ok) throw new Error(`remoteLoadStaff ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("remoteLoadStaff EXPECTED_ARRAY");
    return sanitizeStaffList(data);
  }

  async function remoteSaveStaff(endpoint, staffList, pin) {
    const res = await fetchWithTimeout(endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": String(pin ?? "")
      },
      body: JSON.stringify(sanitizeStaffList(staffList))
    }, 12000);

    if (res.status === 401) throw new Error("UNAUTHORIZED");
    if (!res.ok) throw new Error(`remoteSaveStaff ${res.status}`);
    return true;
  }

  function loadStaffFromLocal() {
    const list = readJsonLS(LS_KEYS.staffCache, []);
    return sanitizeStaffList(list);
  }

  function saveStaffToLocal(list) {
    const cleaned = sanitizeStaffList(list);
    writeJsonLS(LS_KEYS.staffCache, cleaned);
    localStorage.setItem(LS_KEYS.staffCacheAt, nowIso());
  }

  // --- Public API ---
  async function loadStaff(opts = {}) {
    const preferRemote = opts.preferRemote !== false;
    const endpoint = String(opts.endpoint || getStaffEndpoint()).trim();

    if (preferRemote && endpoint) {
      try {
        const list = await remoteLoadStaff(endpoint);
        staffMem = list;
        saveStaffToLocal(list);
        return list;
      } catch {
        const local = loadStaffFromLocal();
        staffMem = local;
        return local;
      }
    }

    const local = loadStaffFromLocal();
    staffMem = local;
    return local;
  }

  async function saveStaff(staffList, opts = {}) {
    const endpoint = String(opts.endpoint || getStaffEndpoint()).trim();
    const pin = opts.pin;

    const cleaned = sanitizeStaffList(staffList);

    if (endpoint) await remoteSaveStaff(endpoint, cleaned, pin);

    staffMem = cleaned;
    saveStaffToLocal(cleaned);
    return true;
  }

  // Backward compatibility for app.js
  function getStaff() {
    if (Array.isArray(staffMem)) return staffMem;
    staffMem = loadStaffFromLocal();
    return staffMem;
  }

  function setStaff(list) {
    staffMem = sanitizeStaffList(list);
    saveStaffToLocal(staffMem);
  }

  E.storage = {
    loadStaff,
    saveStaff,
    getStaffEndpoint,
    setStaffEndpoint,

    // compat
    getStaff,
    setStaff
  };
})();
