/* admin-panel.js - admin unlock + CRUD + ordering (drag & drop) */
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  E.admin ||= {};

  const {
    qs,
    qsa,
    isDigits,
    safeText,
    normalizeUrl,
    randomId,
    downloadJson,
    readJsonFile,
    supportsDialog,
  } = E.utils;

  const { getStaff, setStaff, exportData, importData, resetAll } = E.storage;

  const ADMIN_CODE = "31728504"; // fixed 8-digit code

  // Session-only admin unlock flag (avoid persistent unlock)
  const SESSION_KEY = "eirlylu_admin_unlocked_v1";

  function isUnlocked() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return false;
    }
  }
  function setUnlocked(flag) {
    try {
      sessionStorage.setItem(SESSION_KEY, flag ? "1" : "0");
    } catch {
      // ignore
    }
  }

  function dispatchStaffUpdated() {
    window.dispatchEvent(new CustomEvent("eirlylu:staff-updated"));
  }

  function dispatchAdminToggled(unlocked) {
    window.dispatchEvent(new CustomEvent("eirlylu:admin-toggled", { detail: { unlocked } }));
  }

  function getEls() {
    return {
      openAdminGate: qs("#openAdminGate"),
      openAdminGateInline: qs("#openAdminGateInline"),
      adminGateModal: qs("#adminGateModal"),
      adminCodeInput: qs("#adminCodeInput"),
      adminGateError: qs("#adminGateError"),
      unlockAdmin: qs("#unlockAdmin"),

      adminPanel: qs("#adminPanel"),
      lockAdminBtn: qs("#lockAdminBtn"),

      staffForm: qs("#staffForm"),
      staffId: qs("#staffId"),
      staffName: qs("#staffName"),
      staffBio: qs("#staffBio"),
      staffAvatarUrl: qs("#staffAvatarUrl"),
      staffFormStatus: qs("#staffFormStatus"),
      resetStaffFormBtn: qs("#resetStaffFormBtn"),

      adminStaffList: qs("#adminStaffList"),
      adminStaffEmptyState: qs("#adminStaffEmptyState"),

      exportDataBtn: qs("#exportDataBtn"),
      importFileInput: qs("#importFileInput"),
      importDataBtn: qs("#importDataBtn"),
      importStatus: qs("#importStatus"),
      resetLocalDataBtn: qs("#resetLocalDataBtn"),
    };
  }

  function showAdminPanel(els) {
    if (!els.adminPanel) return;
    els.adminPanel.classList.add("is-visible");
    els.adminPanel.setAttribute("aria-hidden", "false");
  }

  function hideAdminPanel(els) {
    if (!els.adminPanel) return;
    els.adminPanel.classList.remove("is-visible");
    els.adminPanel.setAttribute("aria-hidden", "true");
  }

  function openGate(els) {
    if (!els.adminGateModal) return;
    els.adminGateError.textContent = "";
    if (els.adminCodeInput) els.adminCodeInput.value = "";
    if (supportsDialog() && typeof els.adminGateModal.showModal === "function") {
      els.adminGateModal.showModal();
      setTimeout(() => els.adminCodeInput?.focus(), 0);
      return;
    }
    // Fallback: simple prompt
    const code = window.prompt("請輸入 8 位數字以解鎖管理模式：");
    if (code == null) return;
    attemptUnlock(els, code);
  }

  function closeGate(els) {
    if (!els.adminGateModal) return;
    try {
      if (supportsDialog() && els.adminGateModal.open) els.adminGateModal.close();
    } catch {
      // ignore
    }
  }

  function attemptUnlock(els, codeRaw) {
    const code = String(codeRaw ?? "").trim();
    if (!isDigits(code, 8)) {
      if (els.adminGateError) els.adminGateError.textContent = "格式錯誤：請輸入 8 位數字。";
      return false;
    }
    if (code !== ADMIN_CODE) {
      if (els.adminGateError) els.adminGateError.textContent = "解鎖失敗：數字不正確。";
      return false;
    }
    setUnlocked(true);
    closeGate(els);
    showAdminPanel(els);
    renderAdminList(els);
    dispatchAdminToggled(true);
    return true;
  }

  function lock(els) {
    setUnlocked(false);
    hideAdminPanel(els);
    dispatchAdminToggled(false);
  }

  function resetForm(els) {
    els.staffId.value = "";
    els.staffName.value = "";
    els.staffBio.value = "";
    els.staffAvatarUrl.value = "";
    els.staffFormStatus.textContent = "";
    els.staffName.focus();
  }

  function readForm(els) {
    const id = safeText(els.staffId.value, 120);
    const name = safeText(els.staffName.value, 40);
    const bio = safeText(els.staffBio.value, 200);
    const avatarUrl = normalizeUrl(els.staffAvatarUrl.value);

    if (!name) return { ok: false, error: "請填寫暱稱。" };
    if (!bio) return { ok: false, error: "請填寫簡介。" };

    return {
      ok: true,
      value: {
        id: id || randomId(),
        name,
        bio,
        avatarUrl, // may be ""
      },
    };
  }

  function upsertStaff(item) {
    const staff = getStaff();
    const idx = staff.findIndex((s) => s.id === item.id);

    if (idx >= 0) {
      staff[idx] = {
        ...staff[idx],
        ...item,
        updatedAt: Date.now(),
      };
    } else {
      staff.push({
        ...item,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    setStaff(staff);
    dispatchStaffUpdated();
    return staff;
  }

  function deleteStaff(id) {
    const staff = getStaff().filter((s) => s.id !== id);
    setStaff(staff);
    dispatchStaffUpdated();
    return staff;
  }

  function moveStaff(id, dir) {
    const staff = getStaff();
    const idx = staff.findIndex((s) => s.id === id);
    if (idx < 0) return staff;

    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= staff.length) return staff;

    const [it] = staff.splice(idx, 1);
    staff.splice(newIdx, 0, it);

    setStaff(staff);
    dispatchStaffUpdated();
    return staff;
  }

  function reorderByDrag(dragId, targetId) {
    if (!dragId || !targetId || dragId === targetId) return;

    const staff = getStaff();
    const from = staff.findIndex((s) => s.id === dragId);
    const to = staff.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0) return;

    const [it] = staff.splice(from, 1);
    staff.splice(to, 0, it);

    setStaff(staff);
    dispatchStaffUpdated();
  }

  function renderAdminList(els) {
    if (!els.adminStaffList) return;
    const staff = getStaff();

    // clear list
    els.adminStaffList.innerHTML = "";

    if (!staff.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.id = "adminStaffEmptyState";
      empty.innerHTML = `<p class="muted">尚無管理人員。請先於左側表單新增。</p>`;
      els.adminStaffList.appendChild(empty);
      return;
    }

    let draggedId = null;

    for (const s of staff) {
      const row = document.createElement("div");
      row.className = "admin-row";
      row.dataset.id = s.id;
      row.draggable = true;

      row.innerHTML = `
        <div class="admin-row__top">
          <div class="admin-row__left">
            <img class="admin-row__avatar" alt="" />
            <div class="admin-row__meta">
              <p class="admin-row__name"></p>
              <p class="admin-row__bio"></p>
            </div>
          </div>
          <div class="admin-row__actions">
            <button class="mini-btn mini-btn--drag" type="button" title="拖曳排序" aria-label="拖曳排序">↕</button>
            <button class="mini-btn" type="button" data-act="up" title="上移" aria-label="上移">↑</button>
            <button class="mini-btn" type="button" data-act="down" title="下移" aria-label="下移">↓</button>
            <button class="mini-btn" type="button" data-act="edit" title="編輯" aria-label="編輯">編輯</button>
            <button class="mini-btn mini-btn--danger" type="button" data-act="del" title="刪除" aria-label="刪除">刪除</button>
          </div>
        </div>
      `;

      const avatar = qs(".admin-row__avatar", row);
      const nameEl = qs(".admin-row__name", row);
      const bioEl = qs(".admin-row__bio", row);

      nameEl.textContent = s.name;
      bioEl.textContent = s.bio;

      // Avatar preview (fallback handled by app render; here use placeholder if invalid/empty)
      avatar.src = s.avatarUrl || "assets/img/ui/placeholder-avatar.png";
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = "assets/img/ui/placeholder-avatar.png";
      };

      // Click actions
      row.addEventListener("click", (ev) => {
        const btn = ev.target?.closest("button[data-act]");
        if (!btn) return;

        const act = btn.getAttribute("data-act");
        if (act === "edit") {
          els.staffId.value = s.id;
          els.staffName.value = s.name;
          els.staffBio.value = s.bio;
          els.staffAvatarUrl.value = s.avatarUrl || "";
          els.staffFormStatus.textContent = "已載入待編輯資料。";
          els.staffName.focus();
          return;
        }
        if (act === "del") {
          const ok = window.confirm(`確定刪除「${s.name}」？`);
          if (!ok) return;
          deleteStaff(s.id);
          renderAdminList(els);
          els.staffFormStatus.textContent = "已刪除。";
          if (els.staffId.value === s.id) resetForm(els);
          return;
        }
        if (act === "up") {
          moveStaff(s.id, -1);
          renderAdminList(els);
          return;
        }
        if (act === "down") {
          moveStaff(s.id, +1);
          renderAdminList(els);
          return;
        }
      });

      // Drag behavior: allow drag only when starting on drag handle
      row.addEventListener("dragstart", (ev) => {
        const isHandle = ev.target?.closest(".mini-btn--drag");
        if (!isHandle) {
          ev.preventDefault();
          return;
        }
        draggedId = s.id;
        row.classList.add("is-dragging");
        try {
          ev.dataTransfer.setData("text/plain", draggedId);
          ev.dataTransfer.effectAllowed = "move";
        } catch {
          // ignore
        }
      });

      row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        qsa(".admin-row.is-drop-target", els.adminStaffList).forEach((n) =>
          n.classList.remove("is-drop-target")
        );
        draggedId = null;
      });

      row.addEventListener("dragover", (ev) => {
        if (!draggedId) return;
        ev.preventDefault();
        row.classList.add("is-drop-target");
        try {
          ev.dataTransfer.dropEffect = "move";
        } catch {
          // ignore
        }
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("is-drop-target");
      });

      row.addEventListener("drop", (ev) => {
        if (!draggedId) return;
        ev.preventDefault();
        row.classList.remove("is-drop-target");
        const targetId = row.dataset.id;
        reorderByDrag(draggedId, targetId);
        renderAdminList(els);
      });

      els.adminStaffList.appendChild(row);
    }
  }

  function init() {
    const els = getEls();

    // Gate open buttons
    els.openAdminGate?.addEventListener("click", () => openGate(els));
    els.openAdminGateInline?.addEventListener("click", () => openGate(els));

    // Unlock button
    els.unlockAdmin?.addEventListener("click", () => {
      attemptUnlock(els, els.adminCodeInput?.value);
    });

    // Enter-to-unlock from input
    els.adminCodeInput?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        attemptUnlock(els, els.adminCodeInput?.value);
      }
    });

    // Lock
    els.lockAdminBtn?.addEventListener("click", () => lock(els));

    // Staff form
    els.staffForm?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!isUnlocked()) {
        els.staffFormStatus.textContent = "未解鎖管理模式。";
        return;
      }
      const r = readForm(els);
      if (!r.ok) {
        els.staffFormStatus.textContent = r.error;
        return;
      }
      upsertStaff(r.value);
      els.staffFormStatus.textContent = "已儲存。";
      renderAdminList(els);
      resetForm(els);
    });

    els.resetStaffFormBtn?.addEventListener("click", () => resetForm(els));

    // Export
    els.exportDataBtn?.addEventListener("click", () => {
      if (!isUnlocked()) {
        window.alert("未解鎖管理模式。");
        return;
      }
      const payload = exportData();
      downloadJson("eirlylu_staff_export.json", payload);
    });

    // Import
    els.importDataBtn?.addEventListener("click", async () => {
      if (!isUnlocked()) {
        els.importStatus.textContent = "未解鎖管理模式。";
        return;
      }
      els.importStatus.textContent = "";
      const file = els.importFileInput?.files?.[0];
      if (!file) {
        els.importStatus.textContent = "請先選擇 JSON 檔案。";
        return;
      }
      try {
        const obj = await readJsonFile(file);
        const res = importData(obj);
        if (!res.ok) {
          els.importStatus.textContent = `匯入失敗：${res.error}`;
          return;
        }
        els.importStatus.textContent = `匯入完成：${res.count} 位管理人員。`;
        renderAdminList(els);
        dispatchStaffUpdated();
      } catch (e) {
        els.importStatus.textContent = `匯入失敗：${e?.message || "未知錯誤"}`;
      }
    });

    // Reset local data
    els.resetLocalDataBtn?.addEventListener("click", () => {
      if (!isUnlocked()) {
        window.alert("未解鎖管理模式。");
        return;
      }
      const ok = window.confirm("確定要重置本機資料？這會清除所有管理人員清單。");
      if (!ok) return;
      resetAll();
      els.importStatus.textContent = "已重置本機資料。";
      renderAdminList(els);
      dispatchStaffUpdated();
      resetForm(els);
    });

    // Keep admin panel state on refresh (session only)
    if (isUnlocked()) {
      showAdminPanel(els);
      renderAdminList(els);
      dispatchAdminToggled(true);
    } else {
      hideAdminPanel(els);
      dispatchAdminToggled(false);
    }

    // Update admin list when staff changes (e.g., imported elsewhere)
    window.addEventListener("eirlylu:staff-updated", () => {
      if (isUnlocked()) renderAdminList(els);
    });
  }

  E.admin = { init };
})();
