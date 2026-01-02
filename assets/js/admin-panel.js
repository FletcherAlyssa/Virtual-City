/* admin-panel.js — robust admin launcher + remote staff sync
   Requires: utils.js, storage.js
   Exposes: window.Eirlylu.admin.init()
*/
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  const U = E.utils || {};
  const S = E.storage;

  const qs = U.qs || ((sel, root = document) => root.querySelector(sel));
  const safeText = U.safeText || ((s, n = 2000) => String(s ?? "").trim().slice(0, n));
  const isDigits = U.isDigits || ((s, len) => {
    const t = String(s ?? "");
    return (len ? t.length === len : true) && /^[0-9]+$/.test(t);
  });

  if (!U || !S) {
    console.warn("[admin-panel] missing utils or storage (check script order).");
  }

  let pinInMemory = "";
  let staffList = [];

  function setMsg(text, isError = false) {
    const el = qs("#admin_msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "rgba(255,150,170,0.95)" : "var(--muted)";
  }

  function normalizeOrder() {
    staffList.forEach((x, i) => { x.order = i; x.updatedAt = new Date().toISOString(); });
  }

  function renderList() {
    const box = qs("#admin_staffList");
    if (!box) return;
    box.innerHTML = "";

    if (!staffList.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.style.padding = "12px";
      empty.style.color = "var(--muted)";
      empty.textContent = "尚未新增管理人員。";
      box.appendChild(empty);
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
      name.textContent = s.nickname || "（未命名）";
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

      const btnUp = document.createElement("button");
      btnUp.type = "button";
      btnUp.className = "btn";
      btnUp.textContent = "上移";
      btnUp.disabled = idx === 0;
      btnUp.onclick = async () => {
        const [x] = staffList.splice(idx, 1);
        staffList.splice(idx - 1, 0, x);
        normalizeOrder();
        renderList();
        await persist();
      };

      const btnDown = document.createElement("button");
      btnDown.type = "button";
      btnDown.className = "btn";
      btnDown.textContent = "下移";
      btnDown.disabled = idx === staffList.length - 1;
      btnDown.onclick = async () => {
        const [x] = staffList.splice(idx, 1);
        staffList.splice(idx + 1, 0, x);
        normalizeOrder();
        renderList();
        await persist();
      };

      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn";
      btnDel.textContent = "刪除";
      btnDel.onclick = async () => {
        staffList.splice(idx, 1);
        normalizeOrder();
        renderList();
        await persist();
      };

      actions.append(btnUp, btnDown, btnDel);
      row.appendChild(actions);

      box.appendChild(row);
    });
  }

  async function persist() {
    try {
      if (!pinInMemory || !isDigits(pinInMemory, 8)) {
        await S.saveStaff(staffList, { pin: "" });
        setMsg("已更新本機快取（未提供有效 PIN，未同步到雲端）。");
        window.dispatchEvent(new CustomEvent("eirlylu:staff-updated"));
        return;
      }
      await S.saveStaff(staffList, { pin: pinInMemory });
      setMsg("已同步更新（所有端刷新後一致）。");
      window.dispatchEvent(new CustomEvent("eirlylu:staff-updated"));
    } catch (e) {
      const m = String(e?.message || e);
      if (m.includes("UNAUTHORIZED")) setMsg("PIN 不正確，無法寫入雲端。", true);
      else setMsg("寫入雲端失敗，已保留本機快取。", true);
      try { await S.saveStaff(staffList, { pin: "" }); } catch {}
      window.dispatchEvent(new CustomEvent("eirlylu:staff-updated"));
    }
  }

  async function reloadStaff() {
    staffList = await S.loadStaff({ preferRemote: true });
    normalizeOrder();
    renderList();
  }

  function ensureDialog() {
    let dlg = qs("#adminDialog");
    if (dlg) return dlg;

    dlg = document.createElement("dialog");
    dlg.id = "adminDialog";
    dlg.innerHTML = `
      <form method="dialog" class="admin">
        <div class="card" style="padding:18px; max-width:760px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <div style="font-weight:700;">管理面板（雲端同步）</div>
            <button class="btn" value="close" aria-label="Close">關閉</button>
          </div>

          <div style="margin-top:14px;">
            <label style="display:block; font-size:0.95rem; color:var(--muted);">管理 PIN（8 位數字）</label>
            <input id="admin_pin" class="field__input" inputmode="numeric" autocomplete="one-time-code"
                   placeholder="例如：31728504" style="width:100%; margin-top:6px;">
            <div id="admin_msg" style="margin-top:8px; color:var(--muted); font-size:0.92rem;"></div>
          </div>

          <hr style="border:0; border-top:1px solid rgba(255,255,255,0.10); margin:16px 0;">

          <div>
            <div style="font-weight:600; margin-bottom:8px;">新增管理人員</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <div>
                <label style="display:block; font-size:0.9rem; color:var(--muted);">暱稱</label>
                <input id="admin_staffNickname" class="field__input" placeholder="暱稱" style="width:100%; margin-top:6px;">
              </div>
              <div>
                <label style="display:block; font-size:0.9rem; color:var(--muted);">頭像 URL（可選）</label>
                <input id="admin_staffAvatarUrl" class="field__input" placeholder="https://..." style="width:100%; margin-top:6px;">
              </div>
            </div>
            <div style="margin-top:10px;">
              <label style="display:block; font-size:0.9rem; color:var(--muted);">簡介</label>
              <textarea id="admin_staffIntro" class="field__input" rows="3" placeholder="簡介" style="width:100%; margin-top:6px;"></textarea>
            </div>

            <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
              <button type="button" class="btn btn--primary" id="admin_staffSaveBtn">加入</button>
              <button type="button" class="btn" id="admin_staffReloadBtn">重新載入</button>
            </div>
          </div>

          <div style="margin-top:16px;">
            <div style="font-weight:600;">管理人員清單</div>
            <div id="admin_staffList" style="margin-top:10px; display:flex; flex-direction:column; gap:10px;"></div>
          </div>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);
    return dlg;
  }

  function findOrCreateOpenButton() {
    // Try to bind existing buttons first
    let btn =
      qs('[data-action="open-admin"]') ||
      qs("#adminOpen") ||
      qs("#btnAdmin") ||
      qs("#adminMode");

    if (!btn) {
      btn = document.createElement("button");
      btn.id = "adminOpen";
      btn.className = "btn";
      btn.textContent = "管理";
      btn.style.position = "fixed";
      btn.style.right = "14px";
      btn.style.bottom = "14px";
      btn.style.zIndex = "20";
      document.body.appendChild(btn);
    }
    return btn;
  }

  async function openPanel(dlg) {
    try {
      await reloadStaff();
      setMsg("已從雲端載入（或使用本機快取）。");
    } catch {
      setMsg("載入失敗，已使用本機快取。", true);
      try {
        staffList = await S.loadStaff({ preferRemote: false });
        normalizeOrder();
        renderList();
      } catch {}
    }

    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");
  }

  function wireDialogEvents(dlg) {
    const pinEl = qs("#admin_pin", dlg);
    pinEl.addEventListener("input", () => {
      const v = safeText(pinEl.value, 16);
      pinInMemory = v;
      if (v && !isDigits(v, 8)) setMsg("PIN 必須為 8 位數字。", true);
      else setMsg("");
    });

    qs("#admin_staffSaveBtn", dlg).onclick = async () => {
      const nickname = safeText(qs("#admin_staffNickname", dlg).value, 80);
      const avatarUrl = safeText(qs("#admin_staffAvatarUrl", dlg).value, 2000);
      const intro = safeText(qs("#admin_staffIntro", dlg).value, 2000);

      if (!nickname) { setMsg("暱稱不可為空。", true); return; }

      staffList.push({ id: `staff_${Date.now()}`, nickname, avatarUrl, intro });
      normalizeOrder();
      renderList();
      await persist();

      qs("#admin_staffNickname", dlg).value = "";
      qs("#admin_staffAvatarUrl", dlg).value = "";
      qs("#admin_staffIntro", dlg).value = "";
    };

    qs("#admin_staffReloadBtn", dlg).onclick = async () => {
      await reloadStaff();
      setMsg("已重新載入。");
    };
  }

  function init() {
    const dlg = ensureDialog();
    const btn = findOrCreateOpenButton();

    // Avoid double-binding if init called twice
    if (!btn.dataset.adminBound) {
      btn.dataset.adminBound = "1";
      btn.addEventListener("click", () => openPanel(dlg));
    }

    wireDialogEvents(dlg);
  }

  // Expose for app.js (optional)
  E.admin = { init };

  // Auto-init
  document.addEventListener("DOMContentLoaded", init);
})();
