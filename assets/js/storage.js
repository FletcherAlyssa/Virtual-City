/* storage.js - local persistence + schema guard */
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  E.storage ||= {};

  const { safeText, normalizeUrl } = E.utils;

  const SCHEMA_VERSION = 1;

  const KEYS = {
    staff: "eirlylu_staff_v1",
    // Optional: store a snapshot of loaded site defaults (not required)
    siteCache: "eirlylu_site_cache_v1",
  };

  function loadJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveJson(key, obj) {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  function clearKey(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function validateStaffItem(item) {
    if (!item || typeof item !== "object") return null;

    const id = safeText(item.id, 120);
    const name = safeText(item.name, 40);
    const bio = safeText(item.bio, 200);
    const avatarUrl = normalizeUrl(item.avatarUrl);

    if (!id || !name || !bio) return null;

    return {
      id,
      name,
      bio,
      avatarUrl, // may be ""
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
  }

  function normalizeStaffList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const it of list) {
      const v = validateStaffItem(it);
      if (v) out.push(v);
    }
    return out;
  }

  function getStaff() {
    const obj = loadJson(KEYS.staff);
    if (!obj || obj.schemaVersion !== SCHEMA_VERSION) return [];
    return normalizeStaffList(obj.staff);
  }

  function setStaff(staffArray) {
    const staff = normalizeStaffList(staffArray);
    return saveJson(KEYS.staff, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: Date.now(),
      staff,
    });
  }

  function resetAll() {
    clearKey(KEYS.staff);
    clearKey(KEYS.siteCache);
  }

  function exportData() {
    // Export staff only (site defaults can remain in repo)
    const staff = getStaff();
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      staff,
    };
  }

  function importData(obj) {
    if (!obj || typeof obj !== "object") {
      return { ok: false, error: "匯入檔案格式無效（非 JSON 物件）。" };
    }
    if (obj.schemaVersion !== SCHEMA_VERSION) {
      return { ok: false, error: `不支援的 schemaVersion：${obj.schemaVersion}` };
    }
    const staff = normalizeStaffList(obj.staff);
    const ok = setStaff(staff);
    if (!ok) return { ok: false, error: "寫入本機儲存失敗（可能是瀏覽器阻擋或空間不足）。" };
    return { ok: true, count: staff.length };
  }

  E.storage = {
    SCHEMA_VERSION,
    KEYS,
    getStaff,
    setStaff,
    resetAll,
    exportData,
    importData,
  };
})();
