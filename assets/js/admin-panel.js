/* admin-panel.js — binds to existing HTML admin gate + admin panel
   - No DOM injection (uses markup in index.html)
   - Uses storage.js for local + remote sync (Cloudflare Workers/KV)
   - Auto-inits on DOMContentLoaded
*/
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  const U = E.utils || {};
  const S = E.storage;

  // If storage.js is not available, the admin UI cannot function.
  if (!S) {
    console.warn("[admin] storage.js not loaded; admin panel disabled.");
    return;
  }

  const qs = U.qs || ((sel, root = document) => root.querySelector(sel));
  const safeText = U.safeText || ((s, n = 2000) => String(s ?? "").trim().slice(0, n));
  const isDigits = U.isDigits || ((s, len) => {
    const t = String(s ?? "");
    return (len ? t.length === len : true) && /^[0-9]+$/.test(t);
  });
  const normalizeUrl = U.normalizeUrl || ((u) => String(u ?? "").trim());
  const randomId = U.randomId || (() => `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const downloadJson = U.downloadJson || ((filename, obj) => {
    const safeName = (filename || "export.json").replace(/[^\w.\-()]+/g, "_");
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  const readJsonFile = U.readJsonFile || ((file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(JSON.parse(String(r.result || ""))); }
      catch (e) { reject(e); }
    };
    r.onerror = () => reject(r.error || new Error("File read error"));
    r.readAsText(file);
  }));

  let inited = false;
  let pinInMemory = "";
  let staffList = [];

  const SS_UNLOCK = "eirlylu.admin.unlocked.v1";
  const SS_PIN = "eirlylu.admin.pin.v1";

  function setGateError(msg) {
    const el = qs("#adminGateError");
    if (el) el.textContent = msg || "";
  }

  function setStaffStatus(msg, isError = false) {
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

  function openDialog(dlg) {
    if (!dlg) return;
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
  }

  function closeDialog(dlg) {
    if (!dlg) return;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
  }

  function showGate() {
    const dlg = qs("#adminGateModal");
    const input = qs("#adminCodeInput");
    setGateError("");
    if (input) input.value = "";
    openDialog(dlg);
    if (input) setTimeout(() => input.focus(), 50);
  }

  function hideGate() {
    closeDialog(qs("#adminGateModal"));
  }

  function showPanel() {
    const panel = qs("#adminPanel");
    if (!panel) return;
    panel.classList.add("is-visible");
    panel.setAttribute("aria-hidden", "false");
  }

  function hidePanel() {
    const panel = qs("#adminPanel");
    if (!panel) return;
    panel.classList.remove("is-visible");
    panel.setAttribute("aria-hidden", "true");
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
    setStaffStatus("");
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
    setStaffStatus("");
  }

  function normalizeOrder() {
    staffList.forEach((x, i) => {
      x.order = i;
      x.updatedAt = new Date().toISOString();
    });
  }

  function renderAdminList() {
    const listEl = qs("#adminStaffList");
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

    staffList.forEach((s, idx) => {
      const row = document.createElement("div");
      row.className = "admin-row";
      row.dataset.id = s.id;

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

      img.src = s.avatarUrl || "assets/img/ui/placeholder-avatar.png";
      img.onerror = () => {
        img.onerror = null;
        img.src = "assets/img/ui/placeholder-avatar.png";
      };

      nameEl.textContent = s.nickname || "（未命名）";
      bioEl.textContent = s.intro || "";

      const btnUp = qs('[data-act="up"]', row);
      const btnDown = qs('[data-act="down"]', row);
      const btnEdit = qs('[data-act="edit"]', row);
      const btnDel = qs('[data-act="del"]', row);

      btnUp.disabled = idx === 0;
      btnDown.disabled = idx === staffList.length - 1;

      btnUp.addEventListener("click", async () => {
        const [x] = staffList.splice(idx, 1);
        staffList.splice(idx - 1, 0, x);
        renderAdminList();
        await persist(true);
      });

      btnDown.addEventListener("click", async () => {
        const [x] = staffList.splice(idx, 1);
        staffList.splice(idx + 1, 0, x);
        renderAdminList();
        await persist(true);
      });

      btnEdit.addEventListener("click", () => {
        fillStaffForm(s);
        qs("#staffName")?.focus();
      });

      btnDel.addEventListener("click", async () => {
        staffList.splice(idx, 1);
        clearStaffForm();
        renderAdminList();
        await persist(true);
      });

      listEl.appendChild(row);
    });
  }

  async function persist(preferRemote = true) {
    normalizeOrder();
    const endpoint = S.getStaffEndpoint?.() || "";

    try {
      if (preferRemote && endpoint) {
        await S.saveStaff(staffList, { pin: pinInMemory });
        setStaffStatus("已同步更新（所有端刷新後一致）。");
      } else {
        await S.saveStaff(staffList, { endpoint: "" });
        setStaffStatus("已更新本機資料（未同步到雲端）。");
      }
    } catch (e) {
      const m = String(e?.message || e);
      if (m.includes("UNAUTHORIZED")) setStaffStatus("PIN 不正確，無法寫入雲端；已先保存本機資料。", true);
      else setStaffStatus("寫入雲端失敗；已先保存本機資料。", true);
      try { await S.saveStaff(staffList, { endpoint: "" }); } catch {}
    }

    window.dispatchEvent(new Event("eirlylu:staff-updated"));
  }

  async function reloadStaff(preferRemote = true) {
    staffList = await S.loadStaff({ preferRemote });
    normalizeOrder();
    renderAdminList();
    window.dispatchEvent(new Event("eirlylu:staff-updated"));
  }

  async function unlock() {
    const code = safeText(qs("#adminCodeInput")?.value || "", 16);

    if (!isDigits(code, 8)) {
      setGateError("請輸入 8 位數字。");
      return;
    }

    pinInMemory = code;
    sessionStorage.setItem(SS_UNLOCK, "1");
    sessionStorage.setItem(SS_PIN, pinInMemory);

    hideGate();
    showPanel();

    try {
      await reloadStaff(true);
      setStaffStatus("已載入管理人員資料。");
    } catch {
      await reloadStaff(false);
      setStaffStatus("雲端載入失敗，已使用本機資料。", true);
    }
  }

  function lock() {
    pinInMemory = "";
    sessionStorage.removeItem(SS_UNLOCK);
    sessionStorage.removeItem(SS_PIN);
    hidePanel();
    clearStaffForm();
    setStaffStatus("已鎖定。");
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

  function wireButtons() {
    // Open gate buttons
    qs("#openAdminGate")?.addEventListener("click", showGate);
    qs("#openAdminGateInline")?.addEventListener("click", showGate);

    // Unlock
    qs("#unlockAdmin")?.addEventListener("click", unlock);

    // Form submit (Enter key) should not close dialog
    const gateForm = qs("#adminGateForm");
    if (gateForm) {
      gateForm.addEventListener("submit", (e) => {
        // Allow native cancel/close buttons to close dialog
        const submitter = e.submitter;
        const val = String(submitter?.value || "");
        if (val === "cancel" || val === "close") return;
        e.preventDefault();
      });
    }

    // Enter to unlock
    qs("#adminCodeInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        unlock();
      }
    });

    // Lock
    qs("#lockAdminBtn")?.addEventListener("click", lock);

    // Export
    qs("#exportDataBtn")?.addEventListener("click", () => {
      downloadJson("staff.export.json", staffList);
      setStaffStatus("已匯出 staff.export.json。", false);
    });

    // Staff form
    qs("#staffForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const id = safeText(qs("#staffId")?.value || "", 80);
      const nickname = safeText(qs("#staffName")?.value || "", 80);
      const intro = safeText(qs("#staffBio")?.value || "", 2000);
      const avatarUrl = normalizeUrl(qs("#staffAvatarUrl")?.value || "");

      if (!nickname) {
        setStaffStatus("暱稱不可為空。", true);
        return;
      }

      const item = {
        id: id || `staff_${randomId()}`,
        nickname,
        intro,
        avatarUrl,
      };

      const idx = staffList.findIndex((x) => x.id === item.id);
      if (idx >= 0) staffList[idx] = { ...staffList[idx], ...item };
      else staffList.push(item);

      clearStaffForm();
      renderAdminList();
      await persist(true);
    });

    qs("#resetStaffFormBtn")?.addEventListener("click", clearStaffForm);

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
        setImportStatus("匯入完成。", false);
      } catch {
        setImportStatus("匯入失敗：JSON 格式不正確或非陣列。", true);
      }
    });

    // Reset local
    qs("#resetLocalDataBtn")?.addEventListener("click", async () => {
      try {
        localStorage.removeItem("eirlylu.staff.cache.v1");
        localStorage.removeItem("eirlylu.staff.cacheAt.v1");
        setImportStatus("已重置本機資料。", false);
        await reloadStaff(true);
      } catch {
        setImportStatus("重置失敗。", true);
      }
    });
  }

  async function init() {
    if (inited) return;
    inited = true;

    wireButtons();
    restoreUnlockState();

    // Preload staff (does not require unlock)
    try { await reloadStaff(true); }
    catch { try { await reloadStaff(false); } catch {} }
  }

  E.admin = { init };

  document.addEventListener("DOMContentLoaded", init);
})();
