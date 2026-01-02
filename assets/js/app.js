
/* app.js - bootstrap: load defaults, render public page, wire basic UI */
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  const {
    qs,
    qsa,
    markdownToHtml,
    copyToClipboard,
    formatCountStaff,
    normalizeUrl,
  } = E.utils;

  const { getStaff } = E.storage;

  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  function setText(id, text) {
    const el = qs(id);
    if (el) el.textContent = String(text ?? "");
  }

  function setHtml(id, html) {
    const el = qs(id);
    if (el) el.innerHTML = html || "";
  }

  function setAttr(id, attr, value) {
    const el = qs(id);
    if (el) el.setAttribute(attr, String(value ?? ""));
  }

  function renderSite(siteDefaults) {
    // Titles/subtitles/notice
    setText("#siteTitle", siteDefaults?.site?.title || "艾爾莉露");
    setText("#siteSubtitle", siteDefaults?.site?.subtitle || "");
    setText("#footerTitle", siteDefaults?.site?.title || "艾爾莉露");

    setText("#heroHeadline", `${siteDefaults?.site?.title || "艾爾莉露"} 官方網站`);
    const lead = "本頁提供群組簡介、Discord 邀請連結、QR Code 與管理人員資訊。";
    setText("#heroLead", lead);

    setText("#publicNotice", siteDefaults?.site?.publicNotice || "");

    // Content sections (Markdown)
    setText("#groupIntroTitle", siteDefaults?.content?.groupIntroTitle || "群組簡介");
    const introMd = siteDefaults?.content?.groupIntroMarkdown || "";
    const introHtml = markdownToHtml(introMd) || `<p class="muted">（尚未設定內容）</p>`;
    setHtml("#groupIntroContent", introHtml);

    setText("#storyBackgroundTitle", siteDefaults?.content?.storyBackgroundTitle || "故事背景");
    const storyMd = siteDefaults?.content?.storyBackgroundMarkdown || "";
    const storyHtml = markdownToHtml(storyMd) || `<p class="muted">（尚未設定內容）</p>`;
    setHtml("#storyBackgroundContent", storyHtml);

    // Discord invite
    const inviteUrl = normalizeUrl(siteDefaults?.discord?.inviteUrl) || "https://discord.gg/H5sMYttJ38";
    setAttr("#discordInviteLink", "href", inviteUrl);
    setText("#discordInviteLink", inviteUrl);
    setAttr("#openInviteLink", "href", inviteUrl);

    // QR image (preplaced)
    const qrPath = siteDefaults?.qr?.imagePath || "assets/img/qr/discord-invite.png";
    const qrAlt = siteDefaults?.qr?.altText || "Discord 邀請連結 QR Code";
    setAttr("#qrImage", "src", qrPath);
    setAttr("#qrImage", "alt", qrAlt);

    // Optional: Update OG image if needed (meta tags)
    const og = qs('meta[property="og:image"]');
    if (og && siteDefaults?.seo?.ogImage) og.setAttribute("content", siteDefaults.seo.ogImage);
  }

  function renderStaffPublic() {
    const grid = qs("#staffGrid");
    const empty = qs("#staffEmptyState");
    const countEl = qs("#staffCount");
    if (!grid) return;

    const staff = getStaff();

    if (countEl) countEl.textContent = formatCountStaff(staff.length);

    // remove existing cards but keep empty state placeholder if present
    // We'll rebuild grid content each time to keep logic simple.
    grid.innerHTML = "";

    if (!staff.length) {
      const st = document.createElement("div");
      st.className = "empty-state";
      st.id = "staffEmptyState";
      st.innerHTML = `<p class="muted">目前尚未設定管理人員。</p>`;
      grid.appendChild(st);
      return;
    }

    for (const s of staff) {
      const card = document.createElement("article");
      card.className = "card staff-card";

      card.innerHTML = `
        <div class="staff-card__top">
          <img class="staff-card__avatar" alt="" />
          <div>
            <p class="staff-card__name"></p>
          </div>
        </div>
        <p class="staff-card__bio"></p>
      `;

      const avatar = qs(".staff-card__avatar", card);
      const nameEl = qs(".staff-card__name", card);
      const bioEl = qs(".staff-card__bio", card);

      nameEl.textContent = s.name;
      bioEl.textContent = s.bio;

      avatar.src = s.avatarUrl || "assets/img/ui/placeholder-avatar.png";
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = "assets/img/ui/placeholder-avatar.png";
      };

      grid.appendChild(card);
    }

    // Remove reference to old empty state if any
    if (empty) empty.remove();
  }

  function wireInviteCopy() {
    const btn = qs("#copyInviteLink");
    const link = qs("#discordInviteLink");
    const status = qs("#copyStatus");
    if (!btn || !link) return;

    btn.addEventListener("click", async () => {
      if (!status) return;
      status.textContent = "";
      const ok = await copyToClipboard(link.textContent || link.href);
      status.textContent = ok ? "已複製。" : "複製失敗：請手動複製連結。";
    });
  }

  function wireScrollTop() {
    const btn = qs("#scrollToTop");
    if (!btn) return;
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function initTheme(siteDefaults) {
    // Basic: if site.theme is "auto", do nothing. If "light"/"dark", set data-theme.
    const theme = String(siteDefaults?.site?.theme || "auto").toLowerCase();
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      // leave unset (auto by CSS via prefers-color-scheme)
      document.documentElement.removeAttribute("data-theme");
    }
  }

  async function init() {
    // Initialize admin module
    if (E.admin?.init) E.admin.init();

    // Load defaults JSON
    let siteDefaults = null;
    try {
      siteDefaults = await fetchJson("data/site.defaults.json");
    } catch (e) {
      // Minimal fallback if defaults missing
      siteDefaults = {
        site: { title: "艾爾莉露", subtitle: "", publicNotice: "" },
        discord: { inviteUrl: "https://discord.gg/H5sMYttJ38" },
        qr: { imagePath: "assets/img/qr/discord-invite.png", altText: "Discord 邀請連結 QR Code" },
        content: { groupIntroTitle: "群組簡介", groupIntroMarkdown: "", storyBackgroundTitle: "故事背景", storyBackgroundMarkdown: "" },
      };
      // Optional: surface error silently in console
      console.warn(e);
    }

    initTheme(siteDefaults);
    renderSite(siteDefaults);
    renderStaffPublic();

    // Re-render staff when updated by admin actions
    window.addEventListener("eirlylu:staff-updated", () => {
      renderStaffPublic();
    });

    wireInviteCopy();
    wireScrollTop();

    // (Optional) close admin panel on navigation, etc. Not required.
  }

  document.addEventListener("DOMContentLoaded", init);
})();
