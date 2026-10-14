/* Aqua owner UI design preview — preview-only behaviour.
 *
 * Everything here is local to the preview: no fetch to the app, no
 * database, no notifications, no credentials, no payments. Buttons that
 * would mutate real data show an explicit "preview only" note instead.
 */
(() => {
  "use strict";

  const body = document.body;
  const page = body.dataset.page || "home";
  const params = new URLSearchParams(location.search);
  const validStates = (body.dataset.states || "populated").split(",").map((s) => s.trim());
  let state = validStates.includes(params.get("state")) ? params.get("state") : "populated";

  const ICON = (name, size = 18, color = "#5B6F6B") =>
    `/icon.svg?name=${encodeURIComponent(name)}&size=${size}&color=${encodeURIComponent(color)}`;

  /* ---------------- sidebar / nav shell ---------------- */

  const SIDEBAR = [
    { label: "Main", items: [
      { href: "/home", label: "Home", icon: "layout-dashboard", pages: ["home"] },
      { href: "/members", label: "Members", icon: "users", pages: ["members", "member", "member-new", "member-edit"] },
    ]},
    { label: "Operations", items: [
      { href: "/fees", label: "Fees & payments", icon: "receipt", pages: ["fees"] },
      { label: "Enquiries", icon: "clipboard-list" },
      { label: "Announcements", icon: "megaphone" },
      { label: "Programs & sessions", icon: "calendar-days" },
      { label: "Sessions", icon: "user-cog" },
      { label: "Schedule", icon: "calendar-range" },
      { label: "Staff", icon: "briefcase" },
    ]},
    { label: "Insights", items: [{ label: "Reports", icon: "file-text" }] },
    { label: "Account", items: [{ label: "Settings", icon: "settings" }] },
  ];

  const BOTTOM = [
    { href: "/home", label: "Home", icon: "layout-dashboard", pages: ["home"] },
    { href: "/members", label: "Members", icon: "users", pages: ["members", "member", "member-new", "member-edit"] },
    { label: "Reports", icon: "file-text" },
    { label: "Settings", icon: "settings" },
  ];

  function isActive(item) {
    return (item.pages || []).includes(page);
  }

  function renderShell() {
    const sidebar = document.getElementById("shell-sidebar");
    if (sidebar) {
      sidebar.innerHTML = `
        <div class="side-head">
          <div class="side-mark" aria-hidden="true">AW</div>
          <div class="side-name">Aqua Worli Aquatic Club</div>
          <div class="side-role">Owner console</div>
        </div>
        <nav aria-label="Primary">
          ${SIDEBAR.map((group) => `
            <div class="side-group">
              <p>${group.label}</p>
              <ul>
                ${group.items.map((item) => {
                  const active = isActive(item);
                  const iconColor = active ? "#B84E00" : "#5B6F6B";
                  if (!item.href) {
                    return `<li><a href="#" data-toast="${item.label} is not part of this preview stage.">
                      <img src="${ICON(item.icon, 18, iconColor)}" alt="" aria-hidden="true">${item.label}</a></li>`;
                  }
                  return `<li><a href="${item.href}"${active ? ' aria-current="page"' : ""}>
                    <img src="${ICON(item.icon, 18, iconColor)}" alt="" aria-hidden="true">${item.label}</a></li>`;
                }).join("")}
              </ul>
            </div>`).join("")}
        </nav>`;
    }

    const topbar = document.getElementById("shell-topbar");
    if (topbar) {
      topbar.innerHTML = `
        <div class="search">
          <img src="${ICON("search", 16)}" alt="" aria-hidden="true">
          <input type="search" aria-label="Search members, enquiries and payments" placeholder="Search members, enquiries, payments…">
        </div>
        <div class="acct">
          <span class="bizdate">Tuesday 13 Oct 2026</span>
          <button type="button" class="btn btn-secondary btn-sm" data-toast="Preview only — no session was ended.">Sign out</button>
        </div>`;
    }

    const mobileHead = document.getElementById("shell-mobile-head");
    if (mobileHead) {
      mobileHead.innerHTML = `
        <div class="m-mark" aria-hidden="true">AW</div>
        <div>
          <div class="m-name">Aqua Worli</div>
          <div class="m-sub">Tuesday 13 Oct</div>
        </div>
        <button type="button" class="m-search" aria-label="Search" data-toast="Preview only — record search is not wired in this stage.">
          <img src="${ICON("search", 18)}" alt="" aria-hidden="true">
        </button>`;
    }

    const bottomNav = document.getElementById("shell-bottom-nav");
    if (bottomNav) {
      bottomNav.innerHTML = BOTTOM.map((item) => {
        const active = isActive(item);
        const iconColor = active ? "#B84E00" : "#5B6F6B";
        if (!item.href) {
          return `<a href="#" data-toast="${item.label} is not part of this preview stage.">
            <img src="${ICON(item.icon, 20, iconColor)}" alt="" aria-hidden="true">${item.label}</a>`;
        }
        return `<a href="${item.href}"${active ? ' aria-current="page"' : ""}>
          <img src="${ICON(item.icon, 20, iconColor)}" alt="" aria-hidden="true">${item.label}</a>`;
      }).join("");
    }
  }

  /* ---------------- preview bar + state ---------------- */

  const PAGE_LINKS = [
    { href: "/home", label: "Home", pages: ["home"] },
    { href: "/members", label: "Members", pages: ["members"] },
    { href: "/member", label: "Member overview", pages: ["member"] },
    { href: "/member-new", label: "Add swimmer", pages: ["member-new"] },
    { href: "/member-edit", label: "Edit member", pages: ["member-edit"] },
    { href: "/fees", label: "Fees", pages: ["fees"] },
  ];

  const STATE_LABELS = {
    populated: "Populated",
    empty: "Empty",
    loading: "Loading",
    failed: "Failed read",
    limited: "Permission-limited",
    validation: "Validation error",
    confirm: "Destructive confirmation",
  };

  function renderBar() {
    const bar = document.getElementById("preview-bar");
    if (!bar) return;
    bar.innerHTML = `
      <span class="pb-title">Aqua owner UI — design preview</span>
      <span class="pb-tag">not part of the product</span>
      <nav aria-label="Preview screens">
        ${PAGE_LINKS.map((link) => `
          <a href="${link.href}"${link.pages.includes(page) ? ' aria-current="page"' : ""}>${link.label}</a>`).join("")}
      </nav>
      ${validStates.length > 1 ? `
        <label>State
          <select id="state-select" aria-label="Preview state">
            ${validStates.map((s) => `<option value="${s}"${s === state ? " selected" : ""}>${STATE_LABELS[s] || s}</option>`).join("")}
          </select>
        </label>` : ""}
      <button type="button" class="pb-hide" id="pb-hide">Hide preview bar</button>`;

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "preview-restore";
    restore.id = "pb-restore";
    restore.textContent = "Show preview controls";
    body.appendChild(restore);

    const select = document.getElementById("state-select");
    if (select) {
      select.addEventListener("change", () => applyState(select.value, true));
    }
    document.getElementById("pb-hide").addEventListener("click", () => {
      body.classList.add("pb-collapsed");
      try { sessionStorage.setItem("owner-preview-bar", "hidden"); } catch {}
    });
    restore.addEventListener("click", () => {
      body.classList.remove("pb-collapsed");
      try { sessionStorage.setItem("owner-preview-bar", "shown"); } catch {}
    });
    try {
      if (sessionStorage.getItem("owner-preview-bar") === "hidden") body.classList.add("pb-collapsed");
    } catch {}
  }

  function applyState(next, fromControl) {
    state = next;
    document.documentElement.dataset.state = state;
    const url = new URL(location.href);
    if (state === "populated") url.searchParams.delete("state");
    else url.searchParams.set("state", state);
    history.replaceState({}, "", url);
    if (fromControl) {
      const select = document.getElementById("state-select");
      if (select) select.value = state;
    }
    if (state === "confirm") openConfirmVariant();
    if (state !== "confirm") closeConfirmVariant();
    if (state === "validation") prepareValidation();
  }

  /* ---------------- toast ---------------- */

  let toastTimer = null;
  function toast(message) {
    let el = document.getElementById("preview-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "preview-toast";
      el.className = "preview-toast";
      el.setAttribute("role", "status");
      body.appendChild(el);
    }
    el.textContent = message;
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = "none"; }, 3600);
  }

  /* ---------------- tabs ---------------- */

  function initTabs() {
    const tablists = document.querySelectorAll('[role="tablist"]');
    tablists.forEach((tablist) => {
      const tabs = tablist.querySelectorAll('[role="tab"]');
      const scope = tablist.closest("[data-tabs-scope]") || document;
      const activate = (name) => {
        tabs.forEach((tab) => {
          const selected = tab.dataset.tab === name;
          tab.setAttribute("aria-selected", selected ? "true" : "false");
          tab.tabIndex = selected ? 0 : -1;
          const panel = scope.querySelector(`[data-panel="${tab.dataset.tab}"]`);
          if (panel) panel.hidden = !selected;
        });
      };
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          activate(tab.dataset.tab);
          const url = new URL(location.href);
          if (tab.dataset.tab === body.dataset.defaultTab) url.searchParams.delete("tab");
          else url.searchParams.set("tab", tab.dataset.tab);
          history.replaceState({}, "", url);
        });
        tab.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          event.preventDefault();
          const list = Array.from(tabs);
          const index = list.indexOf(tab);
          const next = list[(index + (event.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
          next.focus();
          next.click();
        });
      });
      const wanted = params.get("tab") || body.dataset.defaultTab;
      const match = Array.from(tabs).find((tab) => tab.dataset.tab === wanted);
      activate(match ? wanted : tabs[0].dataset.tab);
    });
    document.querySelectorAll("[data-tab-link]").forEach((button) => {
      button.addEventListener("click", () => {
        const scope = button.closest("[data-tabs-scope]") || document;
        const tab = scope.querySelector(`[role="tab"][data-tab="${button.dataset.tabLink}"]`);
        if (tab) {
          tab.click();
          tab.focus();
        }
      });
    });
  }

  /* ---------------- invoices ---------------- */

  function selectInvoice(id) {
    document.querySelectorAll("[data-invoice-toggle]").forEach((button) => {
      const open = button.dataset.invoiceToggle === id;
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.textContent = open ? "Close" : "Open";
    });
    document.querySelectorAll("[data-invoice-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.invoicePanel !== id;
    });
  }

  function openConfirmVariant() {
    const issued = document.querySelector('[data-invoice-toggle="i-0004"]');
    if (issued) {
      selectInvoice("i-0004");
      const panel = document.querySelector(".confirm-panel[data-void-confirm]");
      if (panel) panel.hidden = false;
    }
  }

  function closeConfirmVariant() {
    const panel = document.querySelector(".confirm-panel[data-void-confirm]");
    if (panel) panel.hidden = true;
  }

  function initInvoices() {
    document.querySelectorAll("[data-invoice-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.invoiceToggle;
        const open = button.getAttribute("aria-expanded") === "true";
        selectInvoice(open ? null : id);
        if (open) closeConfirmVariant();
      });
    });
    document.querySelectorAll("[data-open-invoice]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.openInvoice;
        const scope = button.closest("[data-tabs-scope]") || document;
        const duesTab = scope.querySelector('[role="tab"][data-tab="dues"]');
        if (duesTab) duesTab.click();
        selectInvoice(id);
        const panel = document.querySelector(`[data-invoice-panel="${id}"]`);
        if (panel) {
          closeConfirmVariant();
          panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });
    });
    const voidOpen = document.querySelector("[data-void-open]");
    const voidPanel = document.querySelector(".confirm-panel[data-void-confirm]");
    if (voidOpen && voidPanel) {
      voidOpen.addEventListener("click", () => { voidPanel.hidden = false; });
    }
    const voidCancel = document.querySelector("[data-void-cancel]");
    if (voidCancel && voidPanel) {
      voidCancel.addEventListener("click", () => { voidPanel.hidden = true; });
    }
  }

  /* ---------------- member search + filters ---------------- */

  function initMemberFilters() {
    const search = document.getElementById("member-search");
    const status = document.getElementById("member-status");
    const chips = document.getElementById("filter-chips");
    if (!search || !status) return;
    const rows = Array.from(document.querySelectorAll("[data-member-row]"));
    const emptyFilter = document.getElementById("members-filter-empty");

    const apply = () => {
      const query = search.value.trim().toLowerCase();
      const statusValue = status.value;
      let shown = 0;
      rows.forEach((row) => {
        const matchesQuery =
          !query ||
          row.dataset.memberName.toLowerCase().includes(query) ||
          (row.dataset.memberPhone || "").includes(query.replace(/\s/g, ""));
        const matchesStatus = !statusValue || row.dataset.memberStatus === statusValue;
        const visible = matchesQuery && matchesStatus;
        row.hidden = !visible;
        if (visible) shown += 1;
      });
      if (emptyFilter) emptyFilter.hidden = shown !== 0;
      if (chips) {
        const parts = [];
        if (query) parts.push({ kind: "search", label: `Search: “${search.value.trim()}”` });
        if (statusValue) {
          const option = status.selectedOptions[0];
          parts.push({ kind: "status", label: `Status: ${option ? option.textContent : statusValue}` });
        }
        chips.innerHTML = parts.map((part) =>
          `<span class="chip">${part.label}<button type="button" data-clear="${part.kind}" aria-label="Remove filter">
            <img src="${ICON("x", 12, "#3C534F")}" alt="" aria-hidden="true"></button></span>`).join("");
        chips.hidden = parts.length === 0;
        chips.querySelectorAll("[data-clear]").forEach((button) => {
          button.addEventListener("click", () => {
            if (button.dataset.clear === "search") search.value = "";
            else status.value = "";
            apply();
            search.focus();
          });
        });
      }
    };
    search.addEventListener("input", apply);
    status.addEventListener("change", apply);
    const clearAll = document.getElementById("clear-filters");
    if (clearAll) {
      clearAll.addEventListener("click", () => {
        search.value = "";
        status.value = "";
        apply();
      });
    }
  }

  /* ---------------- bounded editor forms ---------------- */

  function initForms() {
    document.querySelectorAll("form[data-preview-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        let firstInvalid = null;
        form.querySelectorAll("[data-required], [data-required-check]").forEach((field) => {
          const invalid = field.type === "checkbox" ? !field.checked : !String(field.value || "").trim();
          field.setAttribute("aria-invalid", invalid ? "true" : "false");
          const error = form.querySelector(`[data-error-for="${field.id}"]`);
          if (error) error.style.display = invalid ? "block" : "none";
          if (invalid && !firstInvalid) firstInvalid = field;
        });
        if (firstInvalid) {
          firstInvalid.focus();
          return;
        }
        toast("Preview only — nothing was saved.");
      });
      const cancel = form.querySelector("button[data-preview-cancel]");
      if (cancel) {
        cancel.addEventListener("click", (event) => {
          event.preventDefault();
          form.reset();
          form.querySelectorAll("[data-required], [data-required-check]").forEach((field) => {
            field.removeAttribute("aria-invalid");
            const error = form.querySelector(`[data-error-for="${field.id}"]`);
            if (error) error.style.display = "none";
          });
          toast("Preview only — the draft was cleared and nothing was saved.");
        });
      }
    });
  }

  function markValidation() {
    document.querySelectorAll("form[data-preview-form]").forEach((form) => {
      form.querySelectorAll("[data-required], [data-required-check]").forEach((field) => {
        const invalid = field.type === "checkbox" ? !field.checked : !String(field.value || "").trim();
        field.setAttribute("aria-invalid", invalid ? "true" : "false");
        const error = form.querySelector(`[data-error-for="${field.id}"]`);
        if (error) error.style.display = invalid ? "block" : "none";
      });
    });
  }

  function prepareValidation() {
    // The correction form demonstrates a retained draft: a phone edit is
    // present while the emptied name fails validation.
    if (page === "member-edit") {
      const name = document.getElementById("edit-name");
      const phone = document.getElementById("edit-phone");
      if (name) name.value = "";
      if (phone) phone.value = "+91 98200 04567";
    }
    markValidation();
  }

  function initGuardianModes() {
    const radios = document.querySelectorAll('input[name="guardianMode"]');
    if (!radios.length) return;
    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        document.querySelectorAll("[data-guardian-panel]").forEach((panel) => {
          panel.hidden = panel.dataset.guardianPanel !== radio.value;
        });
      });
    });
  }

  /* ---------------- trends (inline SVG, no chart library) ---------------- */

  const ATTENDANCE = [
    [1, 82], [2, 88], [4, 76], [6, 84], [7, 90], [8, null], [9, 71], [11, 86],
    [12, 80], [13, 92], [14, 78], [15, 85], [16, 88], [18, 74], [19, 83],
    [20, 90], [21, null], [22, 79], [23, 87], [25, 81], [26, 89], [27, 84],
    [28, 92], [29, 86], [30, 80], [31, 77],
  ];
  const COLLECTIONS = [
    [1, 4200], [2, 0], [3, 18600], [4, 12000], [5, 8000], [6, 0],
    [7, 26400], [8, 9600], [9, 0], [10, 31200], [11, 14400],
    [12, 0], [13, 18200], [14, 6400], [15, 22800], [16, 9600],
    [17, 0], [18, 15600], [19, 12000], [20, 0], [21, 28400],
    [22, 7200], [23, 13200], [24, 0], [25, 19600], [26, 8400],
    [27, 22800], [28, 0], [29, 15600], [30, 10800], [31, 6400],
  ];
  const DAY_LABEL = (day) => `${day} Oct`;

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, String(value)));
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function renderAttendanceChart() {
    const host = document.getElementById("attendance-chart");
    if (!host) return;
    const W = 560, H = 150, L = 30, R = 8, T = 10, B = 22;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Attendance percentage by day, 1 to 31 October 2026" });
    const x = (day) => L + ((day - 1) / 30) * (W - L - R);
    const y = (pct) => T + (1 - pct / 100) * (H - T - B);
    [100, 75, 50].forEach((pct) => {
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(pct), y2: y(pct), class: "grid-line" }));
      svg.appendChild(svgEl("text", { x: L - 6, y: y(pct) + 3, "text-anchor": "end" }, String(pct)));
    });
    [1, 15, 31].forEach((day) => {
      svg.appendChild(svgEl("text", { x: x(day), y: H - 6, "text-anchor": day === 1 ? "start" : day === 31 ? "end" : "middle" }, DAY_LABEL(day)));
    });
    let segment = [];
    const flush = () => {
      if (segment.length > 1) {
        svg.appendChild(svgEl("polyline", { points: segment.map(([d, p]) => `${x(d)},${y(p)}`).join(" "), class: "series" }));
      }
      segment = [];
    };
    ATTENDANCE.forEach(([day, pct]) => {
      if (pct === null) { flush(); return; }
      segment.push([day, pct]);
    });
    flush();
    host.appendChild(svg);
  }

  function renderCollectionsChart() {
    const host = document.getElementById("collections-chart");
    if (!host) return;
    const W = 560, H = 150, L = 40, R = 8, T = 10, B = 22;
    const max = 50000;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Collections in rupees by day, 1 to 31 October 2026" });
    const usable = W - L - R;
    const slot = usable / 31;
    const barWidth = Math.max(3, slot - 4);
    const y = (value) => T + (1 - value / max) * (H - T - B);
    [[0, "₹0"], [25000, "₹25k"], [50000, "₹50k"]].forEach(([value, label]) => {
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(value), y2: y(value), class: "grid-line" }));
      svg.appendChild(svgEl("text", { x: L - 6, y: y(value) + 3, "text-anchor": "end" }, label));
    });
    [1, 15, 31].forEach((day) => {
      const cx = L + slot * (day - 1) + barWidth / 2;
      svg.appendChild(svgEl("text", { x: cx, y: H - 6, "text-anchor": day === 1 ? "start" : day === 31 ? "end" : "middle" }, DAY_LABEL(day)));
    });
    COLLECTIONS.forEach(([day, value]) => {
      if (value === 0) return;
      const bx = L + slot * (day - 1);
      svg.appendChild(svgEl("rect", { x: bx, y: y(value), width: barWidth, height: Math.max(2, H - B - y(value)), rx: 2, class: "bar" }));
    });
    host.appendChild(svg);
  }

  /* ---------------- boot ---------------- */

  renderBar();
  document.documentElement.dataset.state = state;
  renderShell();
  initTabs();
  initInvoices();
  initMemberFilters();
  initForms();
  initGuardianModes();
  renderAttendanceChart();
  renderCollectionsChart();

  document.addEventListener("click", (event) => {
    const toastTarget = event.target.closest("[data-toast]");
    if (toastTarget) {
      event.preventDefault();
      toast(toastTarget.dataset.toast);
      return;
    }
    const retry = event.target.closest("[data-retry]");
    if (retry) {
      event.preventDefault();
      applyState("populated", true);
      toast("Preview only — the read was retried and the populated fixture is shown.");
    }
  });

  if (state === "confirm") openConfirmVariant();
  if (state === "validation") prepareValidation();
})();
