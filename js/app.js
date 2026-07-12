const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ASSET_STATUSES = [
  "Operational",
  "Issue Reported",
  "Under Inspection",
  "Under Maintenance",
  "Out of Service",
  "Retired",
];
const ISSUE_STATUSES = [
  "Reported",
  "Assigned",
  "Inspection Started",
  "Maintenance In Progress",
  "Waiting for Parts",
  "Resolved",
  "Closed",
  "Reopened",
];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const CATEGORIES = [
  "Electrical",
  "HVAC",
  "Plumbing",
  "IT & AV",
  "Furniture",
  "Machinery",
  "Safety",
  "Cleaning",
  "Structural",
  "Other",
];
const CONDITIONS = ["Good", "Fair", "Poor"];

const ISSUE_FLOW = {
  Reported: ["Assigned"],
  Assigned: ["Inspection Started"],
  "Inspection Started": [
    "Maintenance In Progress",
    "Waiting for Parts",
    "Resolved",
  ],
  "Maintenance In Progress": ["Waiting for Parts", "Resolved"],
  "Waiting for Parts": ["Maintenance In Progress"],
  Resolved: ["Closed", "Reopened"],
  Closed: ["Reopened"],
  Reopened: ["Assigned"],
};

const ISSUE_TO_ASSET_STATUS = {
  Reported: "Issue Reported",
  Reopened: "Issue Reported",
  "Inspection Started": "Under Inspection",
  "Maintenance In Progress": "Under Maintenance",
  "Waiting for Parts": "Under Maintenance",
  Resolved: "Operational",
};

function chipClass(v) {
  return (v || "").toLowerCase().replace(/\s+/g, "-");
}
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function qs(k) {
  return new URLSearchParams(location.search).get(k);
}

function toast(msg, isErr = false) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function applyTheme() {
  const t = localStorage.getItem("miq_theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
}
function toggleTheme() {
  const cur =
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "light"
      : "dark";
  localStorage.setItem("miq_theme", cur);
  applyTheme();
}
applyTheme();

async function getSession() {
  const {
    data: { session },
  } = await db.auth.getSession();
  return session;
}

async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data } = await db
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();
  const p = data
    ? { ...data, email: session.user.email }
    : {
        id: session.user.id,
        full_name: session.user.email,
        role: "technician",
        email: session.user.email,
      };
  sessionStorage.setItem("miq_profile", JSON.stringify(p));
  return p;
}

function refreshProfileInBackground() {
  getProfile()
    .then((p) => {
      if (p && p.active === false) {
        sessionStorage.removeItem("miq_profile");
        db.auth
          .signOut()
          .then(() => (location.href = "index.html?deactivated=1"));
      }
    })
    .catch(() => {});
}

async function requireAuth() {
  const session = await getSession();
  if (!session) {
    sessionStorage.removeItem("miq_profile");
    location.href = "index.html";
    return null;
  }
  const cached = sessionStorage.getItem("miq_profile");
  if (cached) {
    try {
      const p = JSON.parse(cached);
      if (p.id === session.user.id) {
        refreshProfileInBackground();
        return p;
      }
    } catch (e) {}
  }
  const profile = await getProfile();
  if (profile && profile.active === false) {
    sessionStorage.removeItem("miq_profile");
    await db.auth.signOut();
    location.href = "index.html?deactivated=1";
    return null;
  }
  return profile;
}

function confirmDialog(title, msg, okLabel = "Confirm", danger = false) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "modal-overlay open";
    ov.innerHTML = `<div class="modal" style="max-width:440px">
      <div class="modal-head"><h3>${esc(title)}</h3></div>
      <div class="modal-body"><p style="font-size:14px;color:var(--ink-2)">${esc(msg)}</p></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-x>Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(okLabel)}</button>
      </div></div>`;
    document.body.appendChild(ov);
    const done = (v) => {
      ov.remove();
      resolve(v);
    };
    ov.addEventListener("click", (e) => {
      if (e.target.closest("[data-ok]")) done(true);
      else if (e.target === ov || e.target.closest("[data-x]")) done(false);
    });
    document.addEventListener("keydown", function esc_(e) {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", esc_);
        done(false);
      }
    });
  });
}

function exportCSV(rows, columns, filename) {
  if (!rows.length) {
    toast("Nothing to export.", true);
    return;
  }
  const escape = (v) => {
    v = v == null ? "" : String(v);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const csv = [
    columns.map((c) => escape(c.label)).join(","),
    ...rows.map((r) =>
      columns
        .map((c) => escape(typeof c.get === "function" ? c.get(r) : r[c.get]))
        .join(","),
    ),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV exported.");
}

async function logHistory(assetId, action, actor, issueId = null) {
  await db.from("asset_history").insert({
    asset_id: assetId,
    action,
    actor: actor || "System",
    issue_id: issueId,
  });
}

function assetCode() {
  const n = Math.floor(1000 + Math.random() * 9000);
  const y = new Date().getFullYear().toString().slice(2);
  return `MIQ-${y}-${n}`;
}
function issueNumber() {
  return `ISS-${Date.now().toString().slice(-8)}`;
}

function publicAssetUrl(code) {
  const base = location.href.replace(/[^/]*$/, "");
  return `${base}public.html?code=${encodeURIComponent(code)}`;
}

function checkConfig() {
  if (SUPABASE_URL.startsWith("PASTE_")) {
    document.body.innerHTML = `<div style="max-width:560px;margin:80px auto;padding:32px;font-family:sans-serif;border:2px dashed #F5A623;border-radius:16px">
      <h2 style="margin-bottom:10px">Setup needed</h2>
      <p>Open <b>js/config.js</b> and paste your Supabase <b>Project URL</b> and <b>anon public key</b>, then run the SQL in <b>supabase-setup.sql</b> inside the Supabase SQL Editor.</p></div>`;
    throw new Error("Supabase not configured");
  }
}
checkConfig();

const ICONS = {
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  asset:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2"/><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 12h6"/></svg>',
  issue:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
  spark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="3.2"/></svg>',
};

function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

async function globalSignOut() {
  sessionStorage.removeItem("miq_profile");
  await db.auth.signOut();
  location.href = "index.html";
}

function renderShell(active, profile) {
  const isAdmin = profile.role === "admin";
  const nav = [
    {
      id: "dashboard",
      href: "dashboard.html",
      label: "Dashboard",
      icon: ICONS.dash,
    },
    { id: "assets", href: "assets.html", label: "Assets", icon: ICONS.asset },
    { id: "issues", href: "issues.html", label: "Issues", icon: ICONS.issue },
  ];
  if (isAdmin)
    nav.push({
      id: "team",
      href: "team.html",
      label: "Team",
      icon: ICONS.team,
    });
  const side = document.getElementById("sidebar");
  side.innerHTML = `
    <div class="brand"><div class="brand-name">Maintain<span>IQ</span></div></div>
    <div class="nav-label">Operations</div>
    <nav class="nav">${nav.map((n) => `<a href="${n.href}" class="${n.id === active ? "active" : ""}">${n.icon}${n.label}</a>`).join("")}</nav>
    <div class="sidebar-user" id="profileMenu">
      <div class="dropdown">
        <div class="dd-mail">${esc(profile.email || "")}</div>
        <div class="dd-sep"></div>
        <a href="settings.html">${ICONS.gear}Settings</a>
        <button class="danger" id="ddSignOut">${ICONS.out}Sign out</button>
      </div>
      <button class="profile-btn" id="profileBtn" aria-haspopup="true" aria-expanded="false">
        <div class="avatar">${esc(initials(profile.full_name || profile.email))}</div>
        <div class="profile-meta">
          <span class="who">${esc(profile.full_name || profile.email)}</span>
          <span class="role-pill">${esc(profile.role)}</span>
        </div>
        ${ICONS.chev}
      </button>
    </div>`;
  const menu = document.getElementById("profileMenu");
  document.getElementById("profileBtn").onclick = () => {
    menu.classList.toggle("open");
    document
      .getElementById("profileBtn")
      .setAttribute("aria-expanded", menu.classList.contains("open"));
  };
  document.getElementById("ddSignOut").onclick = globalSignOut;
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) menu.classList.remove("open");
  });
  const ham = document.getElementById("hamBtn");
  if (ham) {
    ham.innerHTML = ICONS.menu;
    ham.onclick = () => side.classList.toggle("open");
    document.addEventListener("click", (e) => {
      if (
        side.classList.contains("open") &&
        !side.contains(e.target) &&
        e.target !== ham &&
        !ham.contains(e.target)
      )
        side.classList.remove("open");
    });
  }
  return isAdmin;
}
