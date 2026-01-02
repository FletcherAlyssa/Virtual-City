/* storage.js — staff sync via Cloudflare Workers + KV (with local fallback)
   Exposes:
     E.storage.loadStaff()
     E.storage.saveStaff(staffList, { pin })
     E.storage.getStaffEndpoint()
     E.storage.setStaffEndpoint(url)
*/
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  const U = E.utils || {};

  const safeText = U.safeText || ((s) => String(s ?? "").trim());
  const isValidHttpUrl = U.isValidHttpUrl || ((u) => {
    try {
      const x = new URL(String(u));
      return x.protocol === "http:" || x.protocol === "https:";
    } catch { return false; }
  });

  const LS_KEYS = {
    staffCache: "eirlylu.staff.cache.v1",
    staffCacheAt: "eirlylu.staff.cacheAt.v1",
    staffEndpoint: "eirlylu.staff.endpoint.v1" // optional override
  };

  function nowIso() {
    return new Date().toISOString();
  }

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
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function getEndpointFromSiteDefaults() {
    // app.js should set this after loading data/site.defaults.json
    const sd = E.siteDefaults || E.site || E.config || null;
    const url = sd?.api?.staffEndpoint;
    return (typeof url === "string" && url.trim()) ? url.trim() : "";
  }

  function getStaffEndpoint() {
    // Allow local override first, then defaults
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

    // Keep optional fields if present
    const out = {
      id,
      nickname,
      intro,
      avatarUrl,
      order: Number.isFinite(Number(obj.order)) ? Number(obj.order) : index,
      updatedAt: safeText(obj.updatedAt || "") || nowIso()
    };

    // Preserve any additional safe fields (non-function)
    for (const k of Object.keys(obj)) {
      if (k in out) continue;
      const v = obj[k];
      if (typeof v === "function") continue;
      if (typeof v === "string") out[k] = safeText(v, 5000);
      else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
      else if (Array.isArray(v)) out[k] = v;
      else if (v && typeof v === "object") out[k] = v; // tolerate nested (e.g., metadata)
    }

    return out;
  }

  function sanitizeStaffList(list) {
    const arr = Array.isArray(list) ? list : [];
    const cleaned = arr.map((x, i) => sanitizeStaffItem(x, i));

    // Normalize order based on current sequence, then sort
    cleaned.forEach((x, i) => { x.order = i; });
    return cleaned;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      return res;
    } finally {
      clearTimeout(t);
    }
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

    if (res.status === 401) {
      const msg = await res.text().catch(() => "");
      throw new Error(`UNAUTHORIZED${msg ? `: ${msg}` : ""}`);
    }
    if (!res.ok) throw new Error(`remoteSaveStaff ${res.status}`);
    // Worker returns { ok: true }
    return true;
  }

  function loadStaffFromLocal() {
    const list = readJsonLS(LS_KEYS.staffCache, []);
    return sanitizeStaffList(list);
  }

  function saveStaffToLocal(list) {
    writeJsonLS(LS_KEYS.staffCache, sanitizeStaffList(list));
    localStorage.setItem(LS_KEYS.staffCacheAt, nowIso());
  }

  async function loadStaff(opts = {}) {
    const preferRemote = opts.preferRemote !== false;
    const endpoint = (opts.endpoint || getStaffEndpoint()).trim();

    if (preferRemote && endpoint) {
      try {
        const list = await remoteLoadStaff(endpoint);
        saveStaffToLocal(list); // cache
        return list;
      } catch {
        // fall back to local cache
        return loadStaffFromLocal();
      }
    }
    return loadStaffFromLocal();
  }

  async function saveStaff(staffList, opts = {}) {
    const endpoint = (opts.endpoint || getStaffEndpoint()).trim();
    const pin = opts.pin;

    const cleaned = sanitizeStaffList(staffList);
    if (endpoint) {
      // remote is source of truth
      await remoteSaveStaff(endpoint, cleaned, pin);
    }
    // Always keep local cache for offline/fast render
    saveStaffToLocal(cleaned);
    return true;
  }

  E.storage = {
    loadStaff,
    saveStaff,
    loadStaffFromLocal,
    saveStaffToLocal,
    getStaffEndpoint,
    setStaffEndpoint
  };
})();
