/* utils.js - shared helpers (no external deps) */
(() => {
  "use strict";

  const E = (window.Eirlylu ||= {});
  E.utils ||= {};

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function isDigits(str, len) {
    const s = String(str ?? "");
    if (len != null && s.length !== len) return false;
    return /^\d+$/.test(s);
  }

  function clamp(n, min, max) {
    const x = Number(n);
    if (Number.isNaN(x)) return min;
    return Math.min(max, Math.max(min, x));
  }

  function isValidHttpUrl(url) {
    try {
      const u = new URL(String(url));
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function normalizeUrl(url) {
    const s = String(url ?? "").trim();
    if (!s) return "";
    if (!isValidHttpUrl(s)) return "";
    return s;
  }

  function safeText(str, maxLen = 2000) {
    const s = String(str ?? "").trim();
    if (!s) return "";
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  function randomId() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function formatCountStaff(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 0) return "0 位";
    return `${x} 位`;
  }

  async function copyToClipboard(text) {
    const t = String(text ?? "");
    if (!t) return false;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch {
      // fall through
    }

    // Fallback: temporary textarea
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function downloadJson(filename, obj) {
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
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("No file provided"));
      const r = new FileReader();
      r.onload = () => {
        try {
          const obj = JSON.parse(String(r.result || ""));
          resolve(obj);
        } catch (e) {
          reject(e);
        }
      };
      r.onerror = () => reject(r.error || new Error("File read error"));
      r.readAsText(file);
    });
  }

  /**
   * Very small, safe Markdown subset renderer.
   * Supports:
   * - Paragraphs
   * - Headings: ###, ####
   * - Lists: -, *, 1.
   * - Inline: **bold**, *italic*, `code`, [text](url)
   * Disallows raw HTML (escaped).
   */
  function markdownToHtml(md) {
    const src = String(md ?? "");
    if (!src.trim()) return "";

    // Escape first to prevent HTML injection, then add markup via replacements.
    const lines = src.replace(/\r\n/g, "\n").split("\n");

    const out = [];
    let inUl = false;
    let inOl = false;

    const closeLists = () => {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
    };

    const renderInline = (text) => {
      let s = escapeHtml(text);

      // Inline code: `code`
      s = s.replace(/`([^`]+)`/g, (_m, g1) => `<code>${escapeHtml(g1)}</code>`);

      // Bold: **text**
      s = s.replace(/\*\*([^*]+)\*\*/g, (_m, g1) => `<strong>${g1}</strong>`);

      // Italic: *text* (avoid matching within **)
      s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, p1, g2) => `${p1}<em>${g2}</em>`);

      // Links: [text](url) - only allow http/https
      s = s.replace(/$begin:math:display$\(\[\^$end:math:display$]+)\]$begin:math:text$\(\[\^\)\]\+\)$end:math:text$/g, (_m, txt, url) => {
        const u = String(url).trim();
        if (!isValidHttpUrl(u)) return `${txt} (${escapeHtml(u)})`;
        const safeU = escapeHtml(u);
        const safeT = txt; // already escaped in s, but we are in post-escape string; txt from regex is raw. Escape:
        return `<a href="${safeU}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeT)}</a>`;
      });

      return s;
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      if (!line.trim()) {
        closeLists();
        continue;
      }

      // Headings
      if (line.startsWith("#### ")) {
        closeLists();
        out.push(`<h4>${renderInline(line.slice(5))}</h4>`);
        continue;
      }
      if (line.startsWith("### ")) {
        closeLists();
        out.push(`<h3>${renderInline(line.slice(4))}</h3>`);
        continue;
      }

      // Unordered list
      if (/^[-*]\s+/.test(line)) {
        if (inOl) {
          out.push("</ol>");
          inOl = false;
        }
        if (!inUl) {
          out.push("<ul>");
          inUl = true;
        }
        out.push(`<li>${renderInline(line.replace(/^[-*]\s+/, ""))}</li>`);
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(line)) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        if (!inOl) {
          out.push("<ol>");
          inOl = true;
        }
        out.push(`<li>${renderInline(line.replace(/^\d+\.\s+/, ""))}</li>`);
        continue;
      }

      // Paragraph
      closeLists();
      out.push(`<p>${renderInline(line)}</p>`);
    }

    closeLists();
    return out.join("\n");
  }

  function supportsDialog() {
    return typeof HTMLDialogElement !== "undefined";
  }

  E.utils = {
    qs,
    qsa,
    escapeHtml,
    isDigits,
    clamp,
    isValidHttpUrl,
    normalizeUrl,
    safeText,
    randomId,
    formatCountStaff,
    copyToClipboard,
    downloadJson,
    readJsonFile,
    markdownToHtml,
    supportsDialog,
  };
})();
