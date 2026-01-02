/* admin-panel.js — Admin UI glue + remote staff sync (Worker KV)
   - Requires: utils.js, storage.js
   - Emits: window event "eirlylu:staff-updated" with detail = staffList
*/
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  const U = E.utils || {};
  const S = E.storage;

  const qs = U.qs || ((sel, root = document) => root.querySelector(sel));
  const qsa = U.qsa || ((sel, root = document) => Array.from(root.querySelectorAll(sel)));
  const safeText = U.safeText || ((s, n = 2000) => String(s ?? "").trim().slice(0, n));
  const isDigits = U.isDigits || ((s, len) => {
    const t = String(s ?? "");
    return (len ? t.length === len : true) && /^[0-9]+$/.test(t);
  });

  if (!S) {
    console.warn("[admin-panel] E.storage is missing");
    return;
  }

  // --- Minimal, resilient admin UI binding ---
  // Works with existing markup if present; otherwise injects a small dialog.
  let pinInMemory = ""; // do NOT persist
  let staffList = [];

  function emitUpdated(list) {
    const detail = Array.isArray(list) ? list : [];
    window.dispatchEvent(new CustomEvent("eirlylu:staff-updated", { detail }));
    // If app has a hook, call it too (optional)
    if (typeof E.setStaff === "function") E.setStaff(detail);
    if (E.app && typeof E.app.setStaff === "function") E.app.setStaff(detail);
  }

  function ensureAdminUI() {
    // Try existing
    let openBtn = qs('[data-action="open-admin"]') || qs("#adminOpen") || qs("#btnAdmin");
    let dlg = qs("#adminDialog") || qs("#adminModal") || qs('dialog[data-admin="1"]');

    if (!dlg) {
      // Inject a minimal dialog if missing (safe default)
      dlg = document.createElement("dialog");
      dlg.id = "adminDialog";
      dlg.setAttribute("data-admin", "1");
      dlg.innerHTML = `
        <form method="dialog" class="admin">
          <div class="card" style="padding:18px; max-width:720px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
              <div style="font-weight:700;">管理面板</div>
              <button class="btn" value="close" aria-label="Close">關閉</button>
            </div>

            <div style="margin-top:14px;">
              <label style="display:block; font-size:0.95rem; color:var(--muted);">管理 PIN（8 位數字）</label>
              <input id="adminPin" class="field__input" inputmode="numeric" autocomplete="one-time-code"
                     placeholder="例如：31728504" style="width:100%; margin-top:6px;">
              <div id="adminMsg" style="margin-top:8px; color:var(--muted); font-size:0.92rem;"></div>
            </div>

            <hr style="border:0; border-top:1px solid rgba(255,255,255,0.10); margin:16px 0;">

            <div>
              <div style="font-weight:600; margin-bottom:8px;">新增 / 編輯管理人員</div>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div>
                  <label style="display:block; font-size:0.9rem; color:var(--muted);">暱稱</label>
                  <input id="staffNickname" class="field__input" placeholder="暱稱" style="width:100%; margin-top:6px;">
                </div>
                <div>
                  <label style="display:block; font-size:0.9rem; color:var(--muted);">頭像 URL（可選）</label>
                  <input id="staffAvatarUrl" class="field__input" placeholder="https://..." style="width:100%; margin-top:6px;">
                </div>
              </div>
              <div style="margin-top:10px;">
                <label style="display:block; font-size:0.9rem; color:var(--muted);">簡介</label>
                <textarea id="staffIntro" class="field__input" rows="3" placeholder="簡介" style="width:100%; margin-top:6px;"></textarea>
              </div>

              <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
                <button type="button" class="btn btn--primary" id="staffSaveBtn">加入/更新</button>
                <button type="button" class="btn" id="staffClearBtn">清空表單</button>
              </div>
            </div>

            <div style="margin-top:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div style="font-weight:600;">管理人員清單</div>
                <button type="button" class="btn" id="staffReloadBtn">重新載入</button>
              </div>
              <div id="adminStaffList" style="margin-top:10px; display:flex; flex-direction:column; gap:10px;"></div>
            </div>
          </div>
        </form>
      `;
      document.body.appendChild(dlg);
    }

    if (!openBtn) {
      // Inject a discreet corner button if missing
      openBtn = document.createElement("button");
      openBtn.id = "adminOpen";
      openBtn.className = "btn";
      openBtn.textContent = "管理";
      openBtn.style.position = "fixed";
      openBtn.style.right = "14px";
      openBtn.style.bottom = "14px";
      openBtn.style.zIndex = "20";
      document.body.appendChild(openBtn);
    }

    return { openBtn, dlg };
  }

  function renderList(container) {
    container.innerHTML = "";

    if (!staffList.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.style.padding = "12px";
      empty.style.color = "var(--muted)";
      empty.textContent = "尚未新增管理人員。";
      container.appendChild(empty);
      return;
    }

    staffList.forEach((s, idx) => {
      const row = document.createElement("div");
      row.className = "card";
      row.style.padding = "12px";
      row.style.display = "grid";
      row.style.gridTemplateColumns = "48px 1fr auto";
      row.style.gap = "12px";
      row.style.alignItems = "center";

      const avatar = document.createElement("div");
      avatar.style.width = "48px";
      avatar.style.height = "48px";
      avatar.style.borderRadius = "14px";
      avatar.style.overflow = "hidden";
      avatar.style.background = "rgba(255,255,255,0.06)";
      avatar.style.border = "1px solid rgba(255,255,255,0.10)";
      if (s.avatarUrl) {
        const img = document.createElement("img");
        img.src = s.avatarUrl;
        img.alt = "";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        avatar.appendChild(img);
      }
      row.appendChild(avatar);

      const info = document.createElement("div");
      const name = document.createElement("div");
      name.style.fontWeight = "700";
      name.textContent = s.nickname || "(未命名)";
      const intro = document.createElement("div");
      intro.style.marginTop = "4px";
      intro.style.color = "var(--muted)";
      intro.style.fontSize = "0.92rem";
      intro.textContent = s.intro || "";
      info.appendChild(name);
      info.appendChild(intro);
      row.appendChild(info);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.flexWrap = "wrap";
      actions.style.justifyContent = "flex-end";

      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "btn";
      btnEdit.textContent = "編輯";
      btnEdit.addEventListener("click", () => fillFormFrom(idx));

      const btnUp = document.createElement("button");
      btnUp.type = "button";
      btnUp.className = "btn";
      btnUp.textContent = "上移";
      btnUp.disabled = idx === 0;
      btnUp.addEventListener("click", async () => {
        move(idx, idx - 1);
        await persist();
      });

      const btnDown = document.createElement("button");
      btnDown.type = "button";
      btnDown.className = "btn";
      btnDown.textContent = "下移";
      btnDown.disabled = idx === staffList.length - 1;
      btnDown.addEventListener("click", async () => {
        move(idx, idx + 1);
        await persist();
      });

      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn";
      btnDel.textContent = "刪除";
      btnDel.addEventListener("click", async () => {
        staffList.splice(idx, 1);
        normalizeOrder();
        renderList(container);
        await persist();
      });

      actions.append(btnEdit, btnUp, btnDown, btnDel);
      row.appendChild(actions);

      container.appendChild(row);
    });
  }

  function normalizeOrder() {
    staffList.forEach((x, i) => { x.order = i; x.updatedAt = new Date().toISOString(); });
  }

  function move(from, to) {
    if (to < 0 || to >= staffList.length) return;
    const [x] = staffList.splice(from, 1);
    staffList.splice(to, 0, x);
    normalizeOrder();
  }

  function fillFormFrom(idx) {
    const s = staffList[idx];
    qs("#staffNickname").value = s.nickname || "";
    qs("#staffAvatarUrl").value = s.avatarUrl || "";
    qs("#staffIntro").value = s.intro || "";
    qs("#staffSaveBtn").setAttribute("data-edit-idx", String(idx));
    setMsg("已載入編輯項目。");
  }

  function clearForm() {
    qs("#staffNickname").value = "";
    qs("#staffAvatarUrl").value = "";
    qs("#staffIntro").value = "";
    qs("#staffSaveBtn").removeAttribute("data-edit-idx");
  }

  function setMsg(text, isError = false) {
    const el = qs("#adminMsg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "rgba(255,150,170,0.95)" : "var(--muted)";
  }

  async function persist() {
    try {
      if (!pinInMemory || !isDigits(pinInMemory, 8)) {
        // allow local cache only (still updates UI), but remote will fail
        await S.saveStaff(staffList, { pin: "" });
        emitUpdated(staffList);
        setMsg("已更新本機快取（未提供有效 PIN，未同步到雲端）。");
        return;
      }
      await S.saveStaff(staffList, { pin: pinInMemory });
      emitUpdated(staffList);
      setMsg("已同步更新（所有端刷新後一致）。");
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("UNAUTHORIZED") || msg.includes("401")) {
        setMsg("PIN 不正確，無法寫入雲端。", true);
      } else {
        setMsg("寫入雲端失敗，已保留本機快取。", true);
      }
      // keep local anyway
      try { await S.saveStaff(staffList, { pin: "" }); } catch {}
      emitUpdated(staffList);
    }
  }

  async function reloadStaff() {
    staffList = await S.loadStaff({ preferRemote: true });
    normalizeOrder();
    emitUpdated(staffList);
  }

  async function init() {
    const { openBtn, dlg } = ensureAdminUI();

    // Open dialog
    openBtn.addEventListener("click", async () => {
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "open");

      // Load freshest staff when opening
      try {
        await reloadStaff();
        setMsg("已從雲端載入（或使用本機快取）。");
      } catch {
        setMsg("載入失敗，已使用本機快取。", true);
      }

      // Render
      const listEl = qs("#adminStaffList", dlg) || qs("#adminStaffList");
      if (listEl) renderList(listEl);
    });

    // Close handling for non-dialog fallback
    dlg.addEventListener("close", () => { /* no-op */ });

    // PIN input
    const pinInput = qs("#adminPin", dlg) || qs("#adminPin");
    if (pinInput) {
      pinInput.addEventListener("input", () => {
        const v = safeText(pinInput.value, 16);
        pinInMemory = v;
        if (v && !isDigits(v, 8)) setMsg("PIN 必須為 8 位數字。", true);
        else setMsg("");
      });
    }

    // Buttons
    const saveBtn = qs("#staffSaveBtn", dlg) || qs("#staffSaveBtn");
    const clearBtn = qs("#staffClearBtn", dlg) || qs("#staffClearBtn");
    const reloadBtn = qs("#staffReloadBtn", dlg) || qs("#staffReloadBtn");
    const listEl = qs("#adminStaffList", dlg) || qs("#adminStaffList");

    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const nickname = safeText((qs("#staffNickname", dlg) || qs("#staffNickname"))?.value, 80);
        const avatarUrl = safeText((qs("#staffAvatarUrl", dlg) || qs("#staffAvatarUrl"))?.value, 2000);
        const intro = safeText((qs("#staffIntro", dlg) || qs("#staffIntro"))?.value, 2000);

        if (!nickname) {
          setMsg("暱稱不可為空。", true);
          return;
        }

        const editIdxAttr = saveBtn.getAttribute("data-edit-idx");
        const editIdx = editIdxAttr != null ? Number(editIdxAttr) : NaN;

        const item = {
          id: (Number.isFinite(editIdx) && staffList[editIdx]) ? staffList[editIdx].id : `staff_${Date.now()}`,
          nickname,
          intro,
          avatarUrl
        };

        if (Number.isFinite(editIdx) && staffList[editIdx]) {
          staffList[editIdx] = { ...staffList[editIdx], ...item };
        } else {
          staffList.push(item);
        }

        normalizeOrder();
        if (listEl) renderList(listEl);
        clearForm();
        await persist();
      });
    }

    if (clearBtn) clearBtn.addEventListener("click", clearForm);

    if (reloadBtn) {
      reloadBtn.addEventListener("click", async () => {
        await reloadStaff();
        if (listEl) renderList(listEl);
        setMsg("已重新載入。");
      });
    }

    // Initial background load (non-blocking)
    try {
      staffList = await S.loadStaff({ preferRemote: true });
      normalizeOrder();
      emitUpdated(staffList);
    } catch {
      staffList = await S.loadStaff({ preferRemote: false });
      normalizeOrder();
      emitUpdated(staffList);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
