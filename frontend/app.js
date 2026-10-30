/* ==========================================================================
   CSR Work Flow Manager — Jira Software UI in Pure macOS Black & White Glass
   - Authentic macOS Menu Bar, Window Traffic Lights, Vibrancy Sidebar & Dock
   - Replicated Jira Software Workspace:
     1. Jira App Header with [+ Create] button, Global Search & Project Switcher
     2. Jira Project Sidebar (Active Sprint, Backlog & List, Timeline, Analytics,
        8:00 PM Daily Status, People/Users CRUD, Activity & 8 PM Emails)
     3. Jira Avatar Stack Filter Bar + Quick Filter Pills + 5-Column Sprint Board
     4. Jira Right-Hand Issue Detail Inspector Drawer (Inline Status, Assignee,
        Priority, Timeline Extension History & Blocker/Comment Stream)
   ========================================================================== */

const state = {
  token: localStorage.getItem("csr_jwt_token") || null,
  user: null,
  systemInfo: null,
  activeTab: "board", // board | backlog | timeline | analytics | daily | users | comments
  bwMode: localStorage.getItem("csr_bw_mode") || "dark", // default dark
  textSize: "compact", // default compact (A-)
  loginRoleHint: "Admin",
  users: [],
  teams: [],
  selectedTeamFilter: "ALL", // ALL | TEAM-DEVOPS | ...
  tasks: [],
  sprints: [],
  analytics: null,
  dailyMe: null,
  dailyAll: null,
  dailyReports: [],
  allComments: null,
  selectedTaskId: "CSR-101",
  inspectorOpen: true,
  taskFilters: {
    search: "",
    status: "",
    priority: "",
    task_type: "",
    assignee_id: "",
    quick_filter: "ALL", // ALL | MY | BLOCKED | EXTENDED | HIGH_CRIT | DESIGN
  },
  dailyFilter: "ALL", // ALL | SUBMITTED | PENDING | NA
  commentSubTab: "task_comments", // task_comments | daily_entries | email_reports
  analyticsChartTab: "burndown", // burndown | burnup
  analyticsFilterSection: "ALL", // ALL | burndown | velocity | compliance | extensions | workload
};

/* --------------------------------------------------------------------------
   1. Notion Theme & Typography Density Controls
   -------------------------------------------------------------------------- */

function applyVisualPreferences() {
  document.documentElement.setAttribute("data-theme", state.bwMode);
  document.documentElement.setAttribute("data-bw-mode", state.bwMode);
  document.documentElement.setAttribute("data-text-size", state.textSize);
}

function setBwMode(mode) {
  state.bwMode = mode === "dark" ? "dark" : "light";
  localStorage.setItem("csr_bw_mode", state.bwMode);
  applyVisualPreferences();
  render();
}

function setTextSize(size) {
  state.textSize = "compact";
  localStorage.setItem("csr_mac_text_size", "compact");
  applyVisualPreferences();
  render();
}

function renderTrafficLights() {
  return ""; // Clean Notion layout
}

function renderTopPreferenceControls() {
  return `
    <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
      <div class="notion-segmented" role="group" aria-label="Notion Theme Mode">
        <button type="button" class="notion-segmented-btn ${state.bwMode === "light" ? "active" : ""}" onclick="setBwMode('light')" title="Notion Light Theme">
          ☼ Light
        </button>
        <button type="button" class="notion-segmented-btn ${state.bwMode === "dark" ? "active" : ""}" onclick="setBwMode('dark')" title="Notion Dark Theme">
          ☾ Dark
        </button>
      </div>
      <div class="notion-segmented" role="group" aria-label="Text Size">
        <button type="button" class="notion-segmented-btn active" onclick="setTextSize('compact')" title="Text Size: A- (Compact)">
          A-
        </button>
      </div>
    </div>
  `;
}

function isAdminUser(u = state.user) {
  return String(u?.role || "").toUpperCase() === "ADMIN";
}

function renderMacMenuBar() {
  const info = state.systemInfo || {};
  const isOpen = info.daily_status_editable !== false && info.is_daily_status_open !== false;
  const clockLabel = info.current_time_ist || info.server_time_display || "IST Live";

  return `
    <header class="mac-menubar" role="banner">
      <div class="mac-menubar-left">
        <span class="jira-brand-badge">
          <span class="jira-brand-icon">❖</span>
          <span style="font-weight:700;">CSR Work Flow Manager</span>
        </span>
      </div>
      <div class="mac-menubar-right">
        <span class="notion-badge ${isOpen ? "notion-badge-success" : "notion-badge-danger"}">
          ${isOpen ? "● 8:00 PM Window Open" : "✕ 8:00 PM Locked (Auto-NA)"}
        </span>
        ${renderTopPreferenceControls()}
        <span class="mac-menu-item tabular-nums" style="font-weight:600;">${esc(clockLabel)}</span>
      </div>
    </header>
  `;
}

function renderMacDock() {
  return ""; // Clean Notion layout without bottom dock
}

/* --------------------------------------------------------------------------
   2. Utility Helpers & Non-Color Monochrome Badges
   -------------------------------------------------------------------------- */

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initials(name) {
  if (!name) return "CS";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function showToast(msg, isError = false) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = "glass-toast";
  el.setAttribute("role", "status");
  el.innerHTML = `${isError ? "⚠ " : "✓ "} ${esc(msg)}`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.2s ease";
    setTimeout(() => el.remove(), 220);
  }, 3400);
}

async function apiFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 && state.token) {
    handleLogout(false);
    throw new Error("Session expired. Please sign in again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.message || `Request failed (${res.status})`);
  }
  return data;
}

function renderStatusBadge(status) {
  const map = {
    DONE: { cls: "notion-badge-success", icon: "✓", label: "DONE" },
    IN_PROGRESS: { cls: "notion-badge-primary", icon: "◐", label: "IN PROGRESS" },
    IN_REVIEW: { cls: "notion-badge-purple", icon: "◑", label: "IN REVIEW" },
    TODO: { cls: "notion-badge-neutral", icon: "○", label: "TO DO" },
    BLOCKED: { cls: "notion-badge-danger", icon: "⚠", label: "BLOCKED" },
  };
  const cfg = map[status] || map.TODO;
  return `<span class="notion-badge ${cfg.cls}"><span aria-hidden="true">${cfg.icon}</span> ${cfg.label}</span>`;
}

function renderPriorityBadge(priority) {
  const map = {
    CRITICAL: { cls: "notion-badge-danger", icon: "‼", label: "CRITICAL" },
    HIGH: { cls: "notion-badge-orange", icon: "▲", label: "HIGH" },
    MEDIUM: { cls: "notion-badge-primary", icon: "■", label: "MEDIUM" },
    LOW: { cls: "notion-badge-neutral", icon: "▽", label: "LOW" },
  };
  const cfg = map[priority] || map.MEDIUM;
  return `<span class="notion-badge ${cfg.cls}"><span aria-hidden="true">${cfg.icon}</span> ${cfg.label}</span>`;
}

function renderTaskTypeIcon(taskType) {
  const icons = {
    DESIGN: "▣",
    CSR: "◈",
    WORKFLOW: "⚙",
    REVIEW: "◎",
  };
  return icons[taskType] || "◈";
}

function renderDailyStatusBadge(status) {
  if (status === "SUBMITTED") {
    return `<span class="notion-badge notion-badge-success"><span aria-hidden="true">✓</span> SUBMITTED</span>`;
  }
  if (status === "NA") {
    return `<span class="notion-badge notion-badge-danger"><span aria-hidden="true">✕</span> NA (MISSED 8 PM)</span>`;
  }
  return `<span class="notion-badge notion-badge-neutral"><span aria-hidden="true">◷</span> PENDING</span>`;
}

/* --------------------------------------------------------------------------
   3. Native <dialog> Modal Helpers
   -------------------------------------------------------------------------- */

function setupDialogBehavior() {
  const dialog = document.getElementById("csr-modal");
  if (!dialog) return;

  dialog.addEventListener("close", () => {
    dialog.returnValue = "";
  });

  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dlg) => {
      const r = dlg.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    dialog.addEventListener("pointerdown", (e) => {
      pressedOutside = outside(e, dialog);
    });
    dialog.addEventListener("pointerup", (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
    });
  }
}

function openDialog(htmlContent) {
  const dialog = document.getElementById("csr-modal");
  if (!dialog) return;
  dialog.innerHTML = htmlContent;
  if (!dialog.open) {
    dialog.showModal();
  }
}

function closeDialog() {
  const dialog = document.getElementById("csr-modal");
  if (dialog && dialog.open) {
    dialog.close();
  }
}

/* --------------------------------------------------------------------------
   4. Bootstrap & Data Fetching
   -------------------------------------------------------------------------- */

async function initApp() {
  applyVisualPreferences();
  setupDialogBehavior();

  try {
    state.systemInfo = await apiFetch("/api/info");
  } catch (err) {
    console.error("Info load error:", err);
  }

  if (state.token) {
    try {
      const meRes = await apiFetch("/api/auth/me");
      state.user = meRes.user;
      await refreshWorkspaceData();
    } catch (err) {
      state.token = null;
      state.user = null;
      localStorage.removeItem("csr_jwt_token");
    }
  }
  render();
}

async function refreshWorkspaceData() {
  if (!state.user) return;
  const requests = [
    apiFetch("/api/info")
      .then((d) => (state.systemInfo = d))
      .catch((err) => console.warn("info fetch:", err)),
    apiFetch("/api/users")
      .then((d) => (state.users = d.users || []))
      .catch((err) => console.warn("users fetch:", err)),
    apiFetch("/api/teams")
      .then((d) => (state.teams = d.teams || []))
      .catch((err) => console.warn("teams fetch:", err)),
    apiFetch("/api/tasks")
      .then((d) => {
        state.tasks = d.tasks || [];
        if (state.tasks.length && !state.tasks.some((t) => t.id === state.selectedTaskId)) {
          state.selectedTaskId = state.tasks[0].id;
        }
      })
      .catch((err) => console.warn("tasks fetch:", err)),
    apiFetch("/api/sprints")
      .then((d) => (state.sprints = d.sprints || []))
      .catch((err) => console.warn("sprints fetch:", err)),
    apiFetch("/api/analytics")
      .then((d) => (state.analytics = d))
      .catch((err) => console.warn("analytics fetch:", err)),
    apiFetch("/api/daily-status")
      .then((d) => {
        state.dailyMe = d;
        state.dailyAll = d;
      })
      .catch((err) => console.warn("daily-status fetch:", err)),
  ];

  if (isAdminUser()) {
    requests.push(
      apiFetch("/api/comments/all").then((d) => (state.allComments = d)).catch(() => {}),
      apiFetch("/api/daily-status/reports").then((d) => (state.dailyReports = d.reports || [])).catch(() => {})
    );
  }
  await Promise.allSettled(requests);
}

function computeLocalAnalytics() {
  if (state.analytics) return state.analytics;
  const tasks = state.tasks || [];
  const totalTasks = tasks.length;
  const statusCounts = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, BLOCKED: 0, DONE: 0 };
  const priorityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const typeCounts = { CSR: 0, DESIGN: 0, WORKFLOW: 0, REVIEW: 0 };
  let totalPoints = 0;
  let donePoints = 0;
  let overdueCount = 0;
  let blockerCount = 0;
  let extensionCount = 0;

  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
    typeCounts[t.task_type] = (typeCounts[t.task_type] || 0) + 1;
    const pts = Number(t.story_points || 0);
    totalPoints += pts;
    if (t.status === "DONE") donePoints += pts;
    if (t.is_overdue) overdueCount++;
    if (t.has_blocker || t.status === "BLOCKED") blockerCount++;
    extensionCount += Number(t.extension_count || 0);
  }

  const dailyAll = state.dailyAll || { total_members: state.users.length, submitted_count: 0, pending_count: 0, na_count: 0 };
  const totalMembers = dailyAll.total_members || state.users.length || 1;
  const submittedCount = dailyAll.submitted_count || 0;

  return {
    total_tasks: totalTasks,
    completion_rate: totalTasks ? Math.round((statusCounts.DONE / totalTasks) * 100) : 0,
    total_points: totalPoints,
    done_points: donePoints,
    points_rate: totalPoints ? Math.round((donePoints / totalPoints) * 100) : 0,
    overdue_count: overdueCount,
    blocker_count: blockerCount,
    extension_count: extensionCount,
    status_counts: statusCounts,
    priority_counts: priorityCounts,
    type_counts: typeCounts,
    daily_compliance: {
      total_members: totalMembers,
      submitted_count: submittedCount,
      pending_count: dailyAll.pending_count || 0,
      na_count: dailyAll.na_count || 0,
      compliance_rate: Math.round((submittedCount / totalMembers) * 100),
    },
    department_breakdown: [],
    member_workload: [],
  };
}

/* --------------------------------------------------------------------------
   5. Root Render Dispatcher
   -------------------------------------------------------------------------- */

function render() {
  const root = document.getElementById("app");
  if (!root) return;

  if (!state.user) {
    root.innerHTML = renderSingleScreenMainPage();
    bindLoginEvents();
  } else {
    root.innerHTML = renderJiraMacDashboard();
  }
}

/* --------------------------------------------------------------------------
   6. SINGLE NON-SCROLLABLE macOS MAIN WINDOW (100dvh, Pure B&W Glass)
   -------------------------------------------------------------------------- */

function renderSingleScreenMainPage() {
  return `
    <div class="main-landing-viewport">
      ${renderMacMenuBar()}

      <main class="landing-window-stage">
        <div class="mac-window landing-mac-window">
          <div class="mac-window-titlebar">
            ${renderTrafficLights()}
            <div class="mac-window-title">
              <span>◈</span>
              <span>CSR Work Flow Manager</span>
            </div>
            <span class="bw-badge bw-badge-outline">Internal 20-Member Workspace</span>
          </div>

          <div class="landing-split-body">
            <section class="landing-left-vibrancy" aria-labelledby="main-hero-heading">
              <div>
                <span class="bw-badge bw-badge-outline" style="margin-bottom:0.4rem;">
                  ● Internal 20-Member Jira & Daily Status Workspace
                </span>
                <h1 id="main-hero-heading" class="landing-headline">
                  CSR Work Flow Manager
                </h1>
              </div>

              <div class="landing-pillars-grid">
                <div class="landing-pillar-box">
                  <div class="landing-pillar-title"><span>▤</span> Jira Sprint Board & Inspector</div>
                  <p class="landing-pillar-desc">5-column Jira board, clickable avatar filters, backlog table, timeline roadmap & split issue inspector.</p>
                </div>
                <div class="landing-pillar-box">
                  <div class="landing-pillar-title"><span>🕗</span> 8:00 PM Daily Status & Auto-NA</div>
                  <p class="landing-pillar-desc">Members submit daily tasks before 8:00 PM. At 8:00 PM, editing locks and missing updates trigger an email as <strong>NA</strong>.</p>
                </div>
                <div class="landing-pillar-box">
                  <div class="landing-pillar-title"><span>👥</span> Admin User CRUD Controls</div>
                  <p class="landing-pillar-desc">Manager Admin can Add, Edit, and Delete team members, assign design tasks, and extend timelines.</p>
                </div>
                <div class="landing-pillar-box">
                  <div class="landing-pillar-title"><span>📊</span> Real-Time Velocity & Analytics</div>
                  <p class="landing-pillar-desc">Sprint velocity ring charts, 8:00 PM compliance meters, blocker tracking, and workload matrices.</p>
                </div>
              </div>

              <div class="landing-metrics-bar">
                <div>
                  <div class="landing-metric-val">20 Members</div>
                  <div class="landing-metric-lbl">Internal Team</div>
                </div>
                <div>
                  <div class="landing-metric-val">8:00 PM IST</div>
                  <div class="landing-metric-lbl">Daily Cutoff & Mail</div>
                </div>
                <div>
                  <div class="landing-metric-val">Admin & User</div>
                  <div class="landing-metric-lbl">Role Access</div>
                </div>
              </div>
            </section>

            <aside class="landing-right-auth" aria-labelledby="signin-title">
              <div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
                  <h2 id="signin-title" style="font-size:var(--fs-lg);">Sign In to Jira Workspace</h2>
                  <span class="bw-badge bw-badge-outline">${esc(state.loginRoleHint)} Mode</span>
                </div>
                <div class="role-switch-group" role="tablist" aria-label="Select Role">
                  <button type="button" class="role-switch-btn ${state.loginRoleHint === "Admin" ? "active" : ""}" onclick="selectLoginRole('Admin')">
                    ★ Manager (Admin)
                  </button>
                  <button type="button" class="role-switch-btn ${state.loginRoleHint === "User" ? "active" : ""}" onclick="selectLoginRole('User')">
                    ● Team Member (User)
                  </button>
                </div>
              </div>

              <form id="login-form" style="display:flex;flex-direction:column;gap:0.65rem;margin-block:0.5rem;">
                <div class="form-group">
                  <label class="form-label" for="login-username">Username</label>
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    class="glass-input"
                    autocomplete="username"
                    spellcheck="false"
                    autocapitalize="none"
                    autocorrect="off"
                    enterkeyhint="next"
                    placeholder="e.g. admin or priya"
                    value="${state.loginRoleHint === "Admin" ? "admin" : "priya"}"
                    required
                  />
                </div>

                <div class="form-group">
                  <div style="display:flex;align-items:center;justify-content:space-between;">
                    <label class="form-label" for="login-password">Password</label>
                    <button type="button" class="btn-bw-glass btn-sm" onclick="togglePasswordVisibility()" id="pwd-toggle-btn" style="padding:0.12rem 0.45rem;">
                      Show
                    </button>
                  </div>
                  <input
                    id="login-password"
                    name="password"
                    type="password"
                    class="glass-input"
                    autocomplete="current-password"
                    enterkeyhint="done"
                    placeholder="Enter password"
                    value="${state.loginRoleHint === "Admin" ? "Admin@123" : "User@123"}"
                    required
                  />
                </div>

                <button type="submit" class="btn-bw-primary btn-block" style="padding:0.6rem;">
                  Sign In to CSR Work Flow Manager →
                </button>
              </form>

              <div>
                <div style="font-size:var(--fs-2xs);font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:0.35rem;">
                  1-Click Instant Demo Accounts:
                </div>
                <div class="demo-accounts-grid">
                  <button type="button" class="demo-account-btn" onclick="quickDemoLogin('admin', 'Admin@123')">
                    <span><strong>admin</strong> (Manager)</span>
                    <span class="bw-badge bw-badge-solid">Admin</span>
                  </button>
                  <button type="button" class="demo-account-btn" onclick="quickDemoLogin('priya', 'User@123')">
                    <span><strong>priya</strong> (Design)</span>
                    <span class="bw-badge bw-badge-outline">User</span>
                  </button>
                  <button type="button" class="demo-account-btn" onclick="quickDemoLogin('arjun', 'User@123')">
                    <span><strong>arjun</strong> (UX)</span>
                    <span class="bw-badge bw-badge-outline">User</span>
                  </button>
                  <button type="button" class="demo-account-btn" onclick="quickDemoLogin('vikram', 'User@123')">
                    <span><strong>vikram</strong> (CSR)</span>
                    <span class="bw-badge bw-badge-outline">User</span>
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <footer style="height:26px;padding-inline:1.2rem;display:flex;align-items:center;justify-content:space-between;font-size:var(--fs-2xs);color:var(--text-muted);">
        <span>CSR Work Flow Manager</span>
        <span>Daily Status Window: Editable until 8:00 PM IST • Automatic NA Email Dispatch at 8:00 PM</span>
      </footer>
    </div>
  `;
}

function selectLoginRole(role) {
  state.loginRoleHint = role;
  render();
}

function togglePasswordVisibility() {
  const input = document.getElementById("login-password");
  const btn = document.getElementById("pwd-toggle-btn");
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    if (btn) btn.textContent = "Hide";
  } else {
    input.type = "password";
    if (btn) btn.textContent = "Show";
  }
}

function bindLoginEvents() {
  const form = document.getElementById("login-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = document.getElementById("login-username")?.value?.trim();
    const p = document.getElementById("login-password")?.value || "";
    if (!u || !p) return;
    await performLogin(u, p);
  });
}

async function quickDemoLogin(username, password) {
  await performLogin(username, password);
}

async function performLogin(username, password) {
  try {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.token = res.access_token;
    state.user = res.user;
    localStorage.setItem("csr_jwt_token", state.token);
    await refreshWorkspaceData();
    showToast(`Signed in as ${state.user.full_name} (${state.user.role})`);
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

function handleLogout(notify = true) {
  state.token = null;
  state.user = null;
  localStorage.removeItem("csr_jwt_token");
  if (notify) showToast("Signed out of CSR Work Flow Manager.");
  render();
}

/* --------------------------------------------------------------------------
   7. JIRA SOFTWARE DASHBOARD INSIDE macOS BLACK & WHITE GLASS WINDOW
   -------------------------------------------------------------------------- */

function switchTab(tab) {
  state.activeTab = tab;
  render();
}

function renderJiraMacDashboard() {
  const user = state.user;
  const isAdmin = isAdminUser(user);
  const info = state.systemInfo || {};
  const isEditable = info.daily_status_editable !== false && info.is_daily_status_open !== false;
  const analytics = computeLocalAnalytics();
  const dailyComp = analytics.daily_compliance || {};

  const planningItems = [
    { id: "board", icon: "▤", label: "Active Sprint Board", count: state.tasks.length },
    { id: "backlog", icon: "☰", label: "Backlog & Issues", count: `${analytics.total_points} pts` },
    { id: "timeline", icon: "🗺️", label: "Timeline & Deadlines", count: `${analytics.extension_count} ext` },
    { id: "analytics", icon: "📊", label: "Reports & Analytics", count: `${analytics.completion_rate}%` },
  ];

  const opsItems = [
    {
      id: "daily",
      icon: "🕗",
      label: "8:00 PM Daily Status",
      count: `${dailyComp.submitted_count || 0}/${dailyComp.total_members || state.users.length}`,
    },
    {
      id: "teams",
      icon: "🏢",
      label: isAdmin ? "Teams (Create & Manage)" : "Teams & Squads",
      count: state.teams.length,
    },
    {
      id: "users",
      icon: "👥",
      label: isAdmin ? "People (Add/Edit/Delete)" : "People & Roster",
      count: state.users.length,
    },
    {
      id: "comments",
      icon: "💬",
      label: "All Comments & 8 PM Mail",
      count: state.allComments ? state.allComments.total_task_comments || 0 : "Feed",
    },
  ];

  const tabLabels = {
    board: "Active Sprint Board",
    backlog: "Backlog & Issues",
    timeline: "Timeline & Deadlines",
    analytics: "Reports & Analytics",
    daily: "8:00 PM Daily Status",
    teams: isAdmin ? "Teams (Create & Manage Squads)" : "Teams & Squads Directory",
    users: isAdmin ? "People (Add/Edit/Delete)" : "People & Team Directory",
    comments: "Activity & Comments Feed",
  };
  const currentTabLabel = tabLabels[state.activeTab] || "Workspace";

  return `
    <div class="mac-desktop-shell">
      <!-- 1. SINGLE CLEAN NOTION TOP NAVIGATION BAR -->
      <header class="notion-topbar" aria-label="Notion Workspace Top Bar">
        <div class="notion-topbar-left">
          <span class="jira-brand-icon">❖</span>
          <div class="notion-breadcrumb">
            <span style="font-weight:700;color:var(--text-primary);">CSR Work Flow</span>
            <span>/</span>
            <span style="font-weight:600;color:var(--notion-primary);">${esc(currentTabLabel)}</span>
          </div>
        </div>

        <div class="notion-topbar-right">
          <input
            type="search"
            class="notion-search-input"
            placeholder="🔍 Search CSR-101, titles, assignees..."
            value="${esc(state.taskFilters.search)}"
            oninput="setTaskFilter('search', this.value)"
            aria-label="Search issues"
          />
          <span class="notion-badge ${isEditable ? "notion-badge-success" : "notion-badge-danger"}">
            ${isEditable ? "● 8:00 PM Window Open" : "✕ 8:00 PM Locked (Auto-NA)"}
          </span>
          ${renderTopPreferenceControls()}
          <div class="notion-user-chip">
            <div class="mono-avatar" style="width:24px;height:24px;font-size:0.65rem;">${esc(initials(user.full_name))}</div>
            <span style="font-size:var(--fs-xs);font-weight:600;">${esc(user.username)}</span>
            <span class="notion-badge ${isAdmin ? "notion-badge-primary" : "notion-badge-neutral"}">${esc(user.role)}</span>
          </div>
          <button type="button" class="btn-bw-glass btn-sm" onclick="handleLogout()">Sign Out</button>
        </div>
      </header>

      <!-- 2. MAIN WORKSPACE: LEFT SIDEBAR (ONLY PLACE FOR NAVIGATION) + RIGHT STAGE -->
      <div class="jira-window-body">
        <!-- LEFT NOTION PROJECT SIDEBAR -->
          <aside class="jira-project-sidebar" aria-label="Jira Project Sidebar">
            <div class="jira-project-header">
              <div class="jira-project-avatar">CSR</div>
              <div style="min-width:0;">
                <div style="font-size:var(--fs-sm);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  CSR Design & Ops
                </div>
                <div style="font-size:var(--fs-2xs);color:var(--text-muted);">
                  Software & Design Project
                </div>
              </div>
            </div>

            <div>
              <div class="sidebar-section-label">Planning (Jira)</div>
              <nav class="sidebar-nav-list">
                ${planningItems
                  .map(
                    (item) => `
                  <button
                    type="button"
                    class="sidebar-nav-btn ${state.activeTab === item.id ? "active" : ""}"
                    onclick="switchTab('${item.id}')"
                  >
                    <span style="display:flex;align-items:center;gap:0.45rem;">
                      <span aria-hidden="true">${item.icon}</span>
                      <span>${esc(item.label)}</span>
                    </span>
                    <span class="sidebar-nav-count">${esc(item.count)}</span>
                  </button>
                `
                  )
                  .join("")}
              </nav>
            </div>

            <div>
              <div class="sidebar-section-label">Daily Status & Team</div>
              <nav class="sidebar-nav-list">
                ${opsItems
                  .map(
                    (item) => `
                  <button
                    type="button"
                    class="sidebar-nav-btn ${state.activeTab === item.id ? "active" : ""}"
                    onclick="switchTab('${item.id}')"
                  >
                    <span style="display:flex;align-items:center;gap:0.45rem;">
                      <span aria-hidden="true">${item.icon}</span>
                      <span>${esc(item.label)}</span>
                    </span>
                    <span class="sidebar-nav-count">${esc(item.count)}</span>
                  </button>
                `
                  )
                  .join("")}
              </nav>
            </div>

            <!-- Direct 1-Click Shortcuts -->
            <div class="sidebar-quick-actions">
              <div class="sidebar-section-label">Project Shortcuts</div>
              ${
                isAdmin
                  ? `
                <button type="button" class="btn-bw-primary btn-block" onclick="openCreateTaskDialog()">
                  + Create / Assign Issue
                </button>
                <button type="button" class="btn-bw-glass btn-block" onclick="openCreateUserDialog()">
                  + Add Team Member
                </button>
                <button type="button" class="btn-bw-glass btn-block" onclick="openCreateTeamDialog()">
                  + Create Team / Squad
                </button>
                <button type="button" class="btn-bw-glass btn-block" onclick="switchTab('users')">
                  ✎ Edit / Delete Users (${state.users.length})
                </button>
              `
                  : ""
              }
              <button type="button" class="btn-bw-glass btn-block" onclick="switchTab('daily')">
                🕗 Submit 8:00 PM Status
              </button>
              ${
                isAdmin
                  ? `
                <button type="button" class="btn-bw-glass btn-block" onclick="trigger8PmEmailNow()">
                  ✉ Trigger 8:00 PM Cutoff Mail
                </button>
              `
                  : ""
              }
            </div>

            <!-- 8:00 PM Clock Simulator -->
            ${
              isAdmin
                ? `
              <div class="sidebar-quick-actions" style="margin-top:auto;">
                <div class="sidebar-section-label">8:00 PM Cutoff Simulator</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.3rem;">
                  <button type="button" class="btn-bw-glass btn-sm" onclick="simulateClock(18, 30)">
                    6:30 PM (Open)
                  </button>
                  <button type="button" class="btn-bw-glass btn-sm" onclick="simulateClock(20, 15)">
                    8:15 PM (Locked)
                  </button>
                </div>
                <button type="button" class="btn-bw-glass btn-sm btn-block" onclick="simulateClock(null, 0)">
                  Reset Live IST Clock
                </button>
              </div>
            `
                : ""
            }
          </aside>

          <!-- RIGHT JIRA WORKSPACE MAIN AREA -->
          <main class="jira-workspace-main" id="workspace-view-body">
            ${renderActiveJiraView()}
          </main>
        </div>
      </div>

      <!-- FLOATING BOTTOM macOS GLASS DOCK -->
      ${renderMacDock()}
    </div>
  `;
}

function renderActiveJiraView() {
  switch (state.activeTab) {
    case "board":
      return renderJiraActiveSprintBoardView();
    case "backlog":
      return renderJiraBacklogAndListView();
    case "timeline":
      return renderJiraTimelineView();
    case "analytics":
      return renderAnalyticsView();
    case "daily":
      return renderDailyStatusView();
    case "teams":
      return renderTeamsView();
    case "users":
      return renderUsersDirectoryView();
    case "comments":
      return renderCommentsAndMailView();
    default:
      return renderJiraActiveSprintBoardView();
  }
}

/* --------------------------------------------------------------------------
   8. JIRA VIEW 1: ACTIVE SPRINT BOARD + AVATAR FILTERS + RIGHT ISSUE INSPECTOR
   -------------------------------------------------------------------------- */

function getFilteredTasks() {
  return state.tasks.filter((t) => {
    if (state.selectedTeamFilter && state.selectedTeamFilter !== "ALL") {
      const activeTeam = state.teams.find((tm) => tm.id === state.selectedTeamFilter);
      if (activeTeam && !(activeTeam.member_ids || []).includes(t.assignee_id)) {
        return false;
      }
    }

    const f = state.taskFilters;
    if (f.status && t.status !== f.status) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.task_type && t.task_type !== f.task_type) return false;
    if (f.assignee_id && t.assignee_id !== f.assignee_id) return false;

    if (f.quick_filter === "MY" && t.assignee_id !== state.user?.id) return false;
    if (f.quick_filter === "BLOCKED" && !t.has_blocker && t.status !== "BLOCKED") return false;
    if (f.quick_filter === "EXTENDED" && !(t.extension_count > 0)) return false;
    if (f.quick_filter === "HIGH_CRIT" && t.priority !== "CRITICAL" && t.priority !== "HIGH") return false;
    if (f.quick_filter === "DESIGN" && !String(t.task_type || "").toUpperCase().includes("DESIGN")) return false;

    if (f.search) {
      const q = f.search.toLowerCase();
      const match =
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.assignee_name || "").toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });
}

function setTaskFilter(key, val) {
  state.taskFilters[key] = val;
  render();
}

function toggleAssigneeFilter(userId) {
  state.taskFilters.assignee_id = state.taskFilters.assignee_id === userId ? "" : userId;
  render();
}

function setQuickFilter(qf) {
  state.taskFilters.quick_filter = state.taskFilters.quick_filter === qf && qf !== "ALL" ? "ALL" : qf;
  render();
}

function filterByTeam(teamId) {
  state.selectedTeamFilter = teamId;
  render();
}

function focusTeam(teamId) {
  state.selectedTeamFilter = teamId;
  state.activeTab = "board";
  render();
}

function selectIssueForInspector(taskId) {
  state.selectedTaskId = taskId;
  state.inspectorOpen = true;
  render();
}

function toggleInspectorPane() {
  state.inspectorOpen = !state.inspectorOpen;
  render();
}

function renderJiraActiveSprintBoardView() {
  const isAdmin = isAdminUser();
  const a = computeLocalAnalytics();
  const filtered = getFilteredTasks();
  const activeSprint = state.sprints[0] || { name: "CSR Sprint 14 — Design & Operations", goal: "Deliver high-contrast CSR workflow & zero-miss 8 PM daily status" };
  const selectedTask = state.tasks.find((t) => t.id === state.selectedTaskId) || filtered[0] || state.tasks[0];

  return `
    <div class="jira-sprint-container">
      <!-- 1. COMPACT JIRA SPRINT HEADER (Notion clean design, no duplicate nav buttons) -->
      <section class="jira-sprint-header">
        <div class="jira-title-row">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <h1 style="font-size:var(--fs-lg);font-weight:700;line-height:1.2;margin:0;">${esc(activeSprint.name)}</h1>
              <span class="notion-badge notion-badge-primary">${filtered.length} Issues</span>
              <span class="notion-badge notion-badge-success">${a.done_points || 0}/${a.total_points || 0} Story Pts</span>
            </div>
            <p style="font-size:var(--fs-xs);color:var(--text-muted);margin-top:0.2rem;margin-bottom:0;">
              Goal: ${esc(activeSprint.goal)}
            </p>
          </div>

          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" class="btn-bw-glass btn-sm ${state.inspectorOpen ? "active" : ""}" onclick="toggleInspectorPane()">
              ◫ ${state.inspectorOpen ? "Hide Inspector" : "Show Inspector"}
            </button>
            ${
              isAdmin
                ? `<button type="button" class="btn-bw-primary btn-sm" onclick="openCreateTaskDialog()">+ Create Issue</button>`
                : ""
            }
          </div>
        </div>

        <!-- JIRA SIGNATURE FILTER BAR: SEARCH + CLICKABLE AVATAR STACK + QUICK FILTER PILLS -->
        <div class="jira-filter-bar">
          <div class="jira-filter-left">
            <input
              type="search"
              class="notion-search-input"
              style="width:180px;height:30px;font-size:var(--fs-xs);"
              placeholder="Filter board..."
              value="${esc(state.taskFilters.search)}"
              oninput="setTaskFilter('search', this.value)"
            />

            <!-- Team Filter Selector -->
            <select
              class="glass-select"
              style="padding: 0.15rem 0.5rem; height: 28px; font-size: var(--fs-xs); max-width: 175px;"
              onchange="filterByTeam(this.value)"
              title="Filter by Team / Squad"
            >
              <option value="ALL" ${state.selectedTeamFilter === "ALL" ? "selected" : ""}>🏢 All Teams</option>
              ${state.teams.map((tm) => `
                <option value="${esc(tm.id)}" ${state.selectedTeamFilter === tm.id ? "selected" : ""}>
                  ${esc(tm.name)}
                </option>
              `).join("")}
            </select>

            <!-- Clickable Jira Avatar Stack -->
            <div class="jira-avatar-stack" role="group" aria-label="Filter by Assignee Avatar">
              <button
                type="button"
                class="jira-avatar-filter-btn ${!state.taskFilters.assignee_id ? "active" : ""}"
                onclick="setTaskFilter('assignee_id', '')"
                title="All Assignees"
              >
                ALL
              </button>
              ${state.users
                .slice(0, 9)
                .map(
                  (u) => `
                <button
                  type="button"
                  class="jira-avatar-filter-btn ${state.taskFilters.assignee_id === u.id ? "active" : ""}"
                  onclick="toggleAssigneeFilter('${esc(u.id)}')"
                  title="Filter by ${esc(u.full_name)} (@${esc(u.username)})"
                >
                  ${esc(initials(u.full_name))}
                </button>
              `
                )
                .join("")}
            </div>

            <!-- Jira Quick Filter Pills -->
            ${[
              { id: "ALL", label: "All" },
              { id: "MY", label: "Only Mine" },
              { id: "BLOCKED", label: `⚠ Blocked (${a.blocker_count})` },
              { id: "EXTENDED", label: `📅 Extended (${a.extension_count})` },
              { id: "HIGH_CRIT", label: "‼ High/Critical" },
              { id: "DESIGN", label: "▣ Design" },
            ]
              .map(
                (qf) => `
              <button
                type="button"
                class="jira-quick-pill ${state.taskFilters.quick_filter === qf.id ? "active" : ""}"
                onclick="setQuickFilter('${qf.id}')"
              >
                ${qf.label}
              </button>
            `
              )
              .join("")}
          </div>
        </div>
      </section>

      <!-- 2. JIRA 5-COLUMN KANBAN BOARD (Spacious, full-height, no bulky telemetry squishing it) -->
      <div class="jira-board-split-layout ${state.inspectorOpen && selectedTask ? "with-inspector" : ""}">
        <div class="kanban-board-grid" role="region" aria-label="Jira Active Sprint Columns">
          ${[
            { key: "TODO", label: "TO DO" },
            { key: "IN_PROGRESS", label: "IN PROGRESS" },
            { key: "IN_REVIEW", label: "IN REVIEW" },
            { key: "BLOCKED", label: "BLOCKED" },
            { key: "DONE", label: "DONE" },
          ]
            .map((col) => {
              const colTasks = filtered.filter((t) => t.status === col.key);
              const colPoints = colTasks.reduce((acc, t) => acc + Number(t.story_points || 0), 0);
              return `
                <div class="kanban-col">
                  <div class="kanban-col-header">
                    <span>${col.label} (${colTasks.length})</span>
                    <span class="jira-story-pts">${colPoints} pts</span>
                  </div>

                  <div class="kanban-col-cards">
                    ${
                      colTasks.length === 0
                        ? `<div style="padding:1.5rem 0.5rem;text-align:center;font-size:var(--fs-xs);color:var(--text-muted);border:1px dashed var(--border-divider);border-radius:var(--radius-md);">No issues in ${col.label}</div>`
                        : colTasks
                            .map(
                              (t) => `
                            <article
                              class="jira-issue-card ${selectedTask && selectedTask.id === t.id ? "selected" : ""}"
                              onclick="selectIssueForInspector('${esc(t.id)}')"
                            >
                              <div class="jira-card-summary">${esc(t.title)}</div>

                              <div class="jira-card-tags">
                                <span class="notion-badge notion-badge-neutral">${esc(t.task_type)}</span>
                                ${t.has_blocker ? `<span class="notion-badge notion-badge-danger">⚠ BLOCKER</span>` : ""}
                                <span class="notion-badge notion-badge-neutral tabular-nums">📅 ${esc(t.due_date)}</span>
                                ${
                                  t.extension_count > 0
                                    ? `<span class="notion-badge notion-badge-orange">Ext ×${t.extension_count}</span>`
                                    : ""
                                }
                              </div>

                              <div class="jira-card-footer">
                                <div class="jira-key-cluster">
                                  <span title="${esc(t.task_type)}">${renderTaskTypeIcon(t.task_type)}</span>
                                  <strong style="font-family:var(--font-mono);font-size:var(--fs-xs);">${esc(t.id)}</strong>
                                  ${renderPriorityBadge(t.priority)}
                                </div>

                                <div style="display:flex;align-items:center;gap:0.35rem;">
                                  <span class="jira-story-pts" title="Story Points">${t.story_points || 3}</span>
                                  <span class="jira-story-pts" title="Comments">💬 ${(t.comments || []).length}</span>
                                  <span class="mono-avatar" style="width:24px;height:24px;border-radius:50%;font-size:0.65rem;" title="Assignee: ${esc(t.assignee_name)}">
                                    ${esc(initials(t.assignee_name))}
                                  </span>
                                </div>
                              </div>

                              <div style="display:flex;align-items:center;justify-content:space-between;gap:0.3rem;padding-top:0.3rem;border-top:1px solid var(--border-divider);" onclick="event.stopPropagation()">
                                <select
                                  class="inline-select"
                                  aria-label="Move status for ${esc(t.id)}"
                                  onchange="quickUpdateTaskStatus('${esc(t.id)}', this.value)"
                                >
                                  ${["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE"]
                                    .map((st) => `<option value="${st}" ${t.status === st ? "selected" : ""}>${st}</option>`)
                                    .join("")}
                                </select>
                                <div style="display:flex;gap:0.25rem;">
                                  <button type="button" class="btn-bw-glass btn-sm" onclick="openTaskDetailDialog('${esc(t.id)}')" title="Open Comment & Blocker Modal">
                                    💬
                                  </button>
                                  ${
                                    isAdmin
                                      ? `<button type="button" class="btn-bw-glass btn-sm" onclick="openExtendTimelineDialog('${esc(t.id)}')" title="Extend Deadline">
                                          📅
                                        </button>`
                                      : ""
                                  }
                                </div>
                              </div>
                            </article>
                          `
                            )
                            .join("")
                    }
                  </div>

                  ${
                    isAdmin && col.key === "TODO"
                      ? `<button type="button" class="btn-bw-glass btn-sm btn-block" onclick="openCreateTaskDialog()" style="margin-top:0.5rem;flex-shrink:0;">
                          + Create Issue
                        </button>`
                      : ""
                  }
                </div>
              `;
            })
            .join("")}
        </div>

        <!-- RIGHT-HAND JIRA ISSUE DETAIL INSPECTOR PANE -->
        ${state.inspectorOpen && selectedTask ? renderJiraInspectorDrawer(selectedTask) : ""}
      </div>
    </div>
  `;
}

function renderJiraInspectorDrawer(t) {
  const isAdmin = isAdminUser();
  const comments = t.comments || [];
  const extensions = t.timeline_history || t.timeline_extensions || [];

  return `
    <aside class="jira-inspector-pane" aria-label="Jira Issue Detail Inspector">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding-bottom:0.55rem;border-bottom:1px solid var(--glass-divider);">
        <div style="display:flex;align-items:center;gap:0.4rem;">
          <span>${renderTaskTypeIcon(t.task_type)}</span>
          <strong style="font-family:var(--font-mono);font-size:var(--fs-sm);">${esc(t.id)}</strong>
          ${t.has_blocker ? `<span class="bw-badge bw-badge-striped">⚠ BLOCKER</span>` : ""}
        </div>
        <div style="display:flex;gap:0.35rem;">
          ${
            isAdmin
              ? `<button type="button" class="btn-bw-glass btn-sm" onclick="openExtendTimelineDialog('${esc(t.id)}')">
                  📅 Extend Date
                </button>`
              : ""
          }
          <button type="button" class="btn-bw-glass btn-sm" onclick="toggleInspectorPane()" title="Close Inspector">
            ✕
          </button>
        </div>
      </div>

      <div>
        <h2 style="font-size:var(--fs-lg);line-height:1.25;">${esc(t.title)}</h2>
        <p style="font-size:var(--fs-xs);color:var(--text-secondary);margin-top:0.35rem;">
          ${esc(t.description || "No description provided.")}
        </p>
      </div>

      <!-- Jira Status Transition & Pinned Details Box -->
      <div class="jira-details-box">
        <div style="font-size:var(--fs-2xs);font-weight:800;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--glass-divider);padding-bottom:0.35rem;">
          Issue Details & Workflow
        </div>

        <div class="jira-detail-row">
          <span class="jira-detail-label">Status</span>
          <select
            class="inline-select"
            aria-label="Issue Status"
            onchange="quickUpdateTaskStatus('${esc(t.id)}', this.value)"
          >
            ${["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE"]
              .map((st) => `<option value="${st}" ${t.status === st ? "selected" : ""}>${st}</option>`)
              .join("")}
          </select>
        </div>

        <div class="jira-detail-row">
          <span class="jira-detail-label">Assignee</span>
          ${
            isAdmin
              ? `<select class="inline-select" aria-label="Reassign Issue" onchange="quickUpdateTaskField('${esc(t.id)}', { assignee_id: this.value })">
                  ${state.users
                    .map((u) => `<option value="${esc(u.id)}" ${t.assignee_id === u.id ? "selected" : ""}>${esc(u.full_name)}</option>`)
                    .join("")}
                </select>`
              : `<span style="font-weight:700;">👤 ${esc(t.assignee_name)}</span>`
          }
        </div>

        <div class="jira-detail-row">
          <span class="jira-detail-label">Priority</span>
          ${
            isAdmin
              ? `<select class="inline-select" aria-label="Issue Priority" onchange="quickUpdateTaskField('${esc(t.id)}', { priority: this.value })">
                  ${["CRITICAL", "HIGH", "MEDIUM", "LOW"]
                    .map((p) => `<option value="${p}" ${t.priority === p ? "selected" : ""}>${p}</option>`)
                    .join("")}
                </select>`
              : renderPriorityBadge(t.priority)
          }
        </div>

        <div class="jira-detail-row">
          <span class="jira-detail-label">Deadline</span>
          <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
            <strong class="tabular-nums">${esc(t.due_date)}</strong>
            ${
              t.extension_count > 0
                ? `<span class="bw-badge bw-badge-outline">Ext ×${t.extension_count}</span>`
                : ""
            }
          </div>
        </div>

        <div class="jira-detail-row">
          <span class="jira-detail-label">Story Points</span>
          <span class="jira-story-pts">${t.story_points || 3} pts • ${esc(t.task_type)}</span>
        </div>
      </div>

      <!-- Timeline Extension History -->
      ${
        extensions.length > 0
          ? `
        <div class="jira-details-box">
          <div style="font-size:var(--fs-2xs);font-weight:800;text-transform:uppercase;color:var(--text-muted);">
            📅 Timeline Extension Log (${extensions.length})
          </div>
          ${extensions
            .map(
              (ex) => `
            <div style="font-size:var(--fs-2xs);padding-top:0.3rem;border-top:1px solid var(--glass-divider);">
              <div><strong>${esc(ex.old_due_date || ex.previous_due_date)} → ${esc(ex.new_due_date)}</strong></div>
              <div style="color:var(--text-secondary);">${esc(ex.reason)}</div>
            </div>
          `
            )
            .join("")}
        </div>
      `
          : ""
      }

      <!-- Jira Activity / Comments & Blocker Stream -->
      <div style="display:flex;flex-direction:column;gap:0.55rem;">
        <div style="font-size:var(--fs-xs);font-weight:800;text-transform:uppercase;color:var(--text-muted);">
          💬 Activity & Blockers (${comments.length})
        </div>

        <form onsubmit="handleInspectorCommentSubmit(event, '${esc(t.id)}')" style="display:flex;flex-direction:column;gap:0.45rem;">
          <textarea
            id="inspector-comment-input"
            class="glass-textarea"
            style="min-block-size:2.2lh;"
            placeholder="Add a Jira comment or report a blocker..."
            required
          ></textarea>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;">
            <label style="display:flex;align-items:center;gap:0.35rem;font-size:var(--fs-2xs);font-weight:700;cursor:pointer;">
              <input type="checkbox" id="inspector-comment-blocker" />
              ⚠ Flag as Blocker
            </label>
            <button type="submit" class="btn-bw-primary btn-sm">Post Comment</button>
          </div>
        </form>

        <div style="display:flex;flex-direction:column;gap:0.45rem;max-height:210px;overflow-y:auto;">
          ${
            comments.length === 0
              ? `<div style="font-size:var(--fs-2xs);color:var(--text-muted);">No comments yet on ${esc(t.id)}.</div>`
              : comments
                  .slice()
                  .reverse()
                  .map(
                    (c) => `
                  <div class="glass-panel" style="padding:0.55rem 0.7rem;font-size:var(--fs-xs);">
                    <div style="display:flex;justify-content:space-between;font-size:var(--fs-2xs);color:var(--text-muted);">
                      <strong>${esc(c.author_name)} (${esc(c.author_role)})</strong>
                      <span class="tabular-nums">${esc((c.created_at || "").slice(0, 16).replace("T", " "))}</span>
                    </div>
                    <div style="margin-top:0.25rem;">
                      ${c.is_blocker || c.comment_type === "BLOCKER" ? `<span class="bw-badge bw-badge-striped">⚠ BLOCKER</span> ` : ""}
                      ${esc(c.content)}
                    </div>
                  </div>
                `
                  )
                  .join("")
          }
        </div>
      </div>
    </aside>
  `;
}

async function quickUpdateTaskStatus(taskId, newStatus) {
  try {
    await apiFetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ status: newStatus }),
    });
    await refreshWorkspaceData();
    showToast(`${taskId} → ${newStatus}`);
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function quickUpdateTaskField(taskId, fieldsObj) {
  try {
    await apiFetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify(fieldsObj),
    });
    await refreshWorkspaceData();
    showToast(`Updated ${taskId}`);
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleInspectorCommentSubmit(e, taskId) {
  e.preventDefault();
  const content = document.getElementById("inspector-comment-input")?.value?.trim();
  const isBlocker = document.getElementById("inspector-comment-blocker")?.checked || false;
  if (!content) return;
  try {
    await apiFetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({
        content,
        is_blocker: isBlocker,
        comment_type: isBlocker ? "BLOCKER" : "REMARK",
      }),
    });
    await refreshWorkspaceData();
    showToast(`Comment posted on ${taskId}`);
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* --------------------------------------------------------------------------
   9. JIRA VIEW 2: BACKLOG & ISSUE NAVIGATOR TABLE (With Inline Issue Creation)
   -------------------------------------------------------------------------- */

function renderJiraBacklogAndListView() {
  const isAdmin = isAdminUser();
  const filtered = getFilteredTasks();
  const todoPts = filtered.filter((t) => t.status === "TODO").reduce((s, t) => s + Number(t.story_points || 0), 0);
  const progPts = filtered
    .filter((t) => t.status === "IN_PROGRESS" || t.status === "IN_REVIEW" || t.status === "BLOCKED")
    .reduce((s, t) => s + Number(t.story_points || 0), 0);
  const donePts = filtered.filter((t) => t.status === "DONE").reduce((s, t) => s + Number(t.story_points || 0), 0);

  return `
    <div class="mac-content-scroll">
      <section class="glass-card section-card">
        <div class="section-card-header">
          <div>
            <h1 class="section-card-title">☰ Jira Backlog & Issue Navigator — CSR Sprint 14 (${filtered.length} Issues)</h1>
            <p class="section-card-subtitle">
              Click any issue row to inspect, change status, post blocker remarks, or extend deadlines
            </p>
          </div>

          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <span class="bw-badge bw-badge-dashed" title="To Do Story Points">To Do: ${todoPts} pts</span>
            <span class="bw-badge bw-badge-outline" title="In Progress Story Points">In Progress: ${progPts} pts</span>
            <span class="bw-badge bw-badge-solid" title="Completed Story Points">Done: ${donePts} pts</span>
            ${
              isAdmin
                ? `<button type="button" class="btn-bw-primary" onclick="openCreateTaskDialog()">+ Create Issue</button>`
                : ""
            }
          </div>
        </div>

        <div class="table-scroll-container" tabindex="0" role="region" aria-label="Jira Backlog Issue Table">
          <table class="bw-table">
            <thead>
              <tr>
                <th>Type & Key</th>
                <th>Summary & Blocker Status</th>
                <th>Assignee</th>
                <th>Priority</th>
                <th>Points</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map(
                  (t) => `
                <tr onclick="selectIssueForInspector('${esc(t.id)}')" style="cursor:pointer;">
                  <td>
                    <span class="bw-badge bw-badge-solid">${renderTaskTypeIcon(t.task_type)} ${esc(t.id)}</span>
                    <div style="font-size:var(--fs-2xs);color:var(--text-muted);margin-top:0.15rem;">${esc(t.task_type)}</div>
                  </td>
                  <td>
                    <div style="font-weight:700;">${esc(t.title)}</div>
                    ${
                      t.has_blocker
                        ? `<div style="margin-top:0.2rem;"><span class="bw-badge bw-badge-striped">⚠ BLOCKER: ${esc(t.blocker_summary || t.blocker_reason || "Flagged")}</span></div>`
                        : ""
                    }
                  </td>
                  <td onclick="event.stopPropagation()">
                    ${
                      isAdmin
                        ? `<select class="inline-select" aria-label="Assignee for ${esc(t.id)}" onchange="quickUpdateTaskField('${esc(t.id)}', { assignee_id: this.value })">
                            ${state.users
                              .map((u) => `<option value="${esc(u.id)}" ${t.assignee_id === u.id ? "selected" : ""}>${esc(u.full_name)}</option>`)
                              .join("")}
                          </select>`
                        : `<span style="font-weight:600;">${esc(t.assignee_name)}</span>`
                    }
                  </td>
                  <td>${renderPriorityBadge(t.priority)}</td>
                  <td><span class="jira-story-pts">${t.story_points || 3}</span></td>
                  <td onclick="event.stopPropagation()">
                    <select
                      class="inline-select"
                      aria-label="Status for ${esc(t.id)}"
                      onchange="quickUpdateTaskStatus('${esc(t.id)}', this.value)"
                    >
                      ${["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE"]
                        .map((st) => `<option value="${st}" ${t.status === st ? "selected" : ""}>${st}</option>`)
                        .join("")}
                    </select>
                  </td>
                  <td>
                    <div class="tabular-nums" style="font-weight:700;">${esc(t.due_date)}</div>
                    ${
                      t.extension_count > 0
                        ? `<span class="bw-badge bw-badge-outline">Ext ×${t.extension_count}</span>`
                        : ""
                    }
                  </td>
                  <td onclick="event.stopPropagation()">
                    <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                      <button type="button" class="btn-bw-glass btn-sm" onclick="openTaskDetailDialog('${esc(t.id)}')">
                        💬 Comments (${(t.comments || []).length})
                      </button>
                      ${
                        isAdmin
                          ? `<button type="button" class="btn-bw-glass btn-sm" onclick="openExtendTimelineDialog('${esc(t.id)}')">
                              📅 Extend Date
                            </button>`
                          : ""
                      }
                    </div>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   10. JIRA VIEW 3: TIMELINE / ROADMAPS & DEADLINE EXTENSIONS
   -------------------------------------------------------------------------- */

function renderJiraTimelineView() {
  const isAdmin = isAdminUser();

  return `
    <div class="mac-content-scroll">
      <section class="glass-card section-card">
        <div class="section-card-header">
          <div>
            <h1 class="section-card-title">🗺️ Jira Timeline & Deadline Extensions Roadmap</h1>
            <p class="section-card-subtitle">
              Visual schedule of all CSR & Design tasks, original vs extended timelines, and revision logs
            </p>
          </div>
          ${
            isAdmin
              ? `<button type="button" class="btn-bw-primary" onclick="openCreateTaskDialog()">+ Assign Task on Timeline</button>`
              : ""
          }
        </div>

        <div class="glass-panel" style="overflow:hidden;">
          ${state.tasks
            .map((t, idx) => {
              const offsetPct = (idx * 8) % 35;
              const widthPct = Math.min(92 - offsetPct, 35 + Number(t.story_points || 3) * 5);
              return `
                <div class="timeline-row">
                  <div>
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                      <span class="bw-badge bw-badge-solid">${esc(t.id)}</span>
                      <strong style="font-size:var(--fs-sm);">${esc(t.title)}</strong>
                    </div>
                    <div style="font-size:var(--fs-2xs);color:var(--text-muted);margin-top:0.2rem;">
                      👤 ${esc(t.assignee_name)} • Original: ${esc(t.original_due_date || t.due_date)} → Current: <strong>${esc(t.due_date)}</strong>
                    </div>
                  </div>

                  <div class="timeline-bar-track">
                    <div
                      class="timeline-bar-fill"
                      style="margin-left:${offsetPct}%;width:${widthPct}%;${
                        t.has_blocker
                          ? "background:repeating-linear-gradient(-45deg, var(--stripe-fg) 0 5px, var(--stripe-bg) 5px 10px);color:var(--text-primary);border:1px solid var(--text-primary);"
                          : ""
                      }"
                    >
                      ${esc(t.status)} • Due ${esc(t.due_date)} ${t.extension_count > 0 ? `(+${t.extension_count} Ext)` : ""}
                    </div>
                  </div>

                  <div style="display:flex;gap:0.4rem;">
                    <button type="button" class="btn-bw-glass btn-sm" onclick="openTaskDetailDialog('${esc(t.id)}')">
                      💬 (${(t.comments || []).length})
                    </button>
                    ${
                      isAdmin
                        ? `<button type="button" class="btn-bw-primary btn-sm" onclick="openExtendTimelineDialog('${esc(t.id)}')">
                            📅 Extend Timeline
                          </button>`
                        : ""
                    }
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   11. JIRA VIEW 4: REPORTS & ANALYTICS STUDIO
   -------------------------------------------------------------------------- */

function renderKpiStrip(a) {
  const dc = a.daily_compliance || {};
  return `
    <section class="kpi-strip-grid" aria-label="Key Performance Indicators">
      <div class="glass-card kpi-glass-card">
        <div class="kpi-label">1. Sprint Completion Rate</div>
        <div class="kpi-value-row">
          <span class="kpi-big-number">${a.completion_rate}%</span>
          <span class="bw-badge bw-badge-solid">${a.status_counts?.DONE || 0} / ${a.total_tasks} Done</span>
        </div>
        <div class="mono-progress-track" aria-hidden="true">
          <div class="mono-progress-fill" style="width:${a.completion_rate}%;"></div>
        </div>
        <div class="kpi-subtext">${a.done_points} of ${a.total_points} Story Points delivered</div>
      </div>

      <div class="glass-card kpi-glass-card">
        <div class="kpi-label">2. 8:00 PM Status Compliance</div>
        <div class="kpi-value-row">
          <span class="kpi-big-number">${dc.compliance_rate || 0}%</span>
          <span class="bw-badge bw-badge-outline">${dc.submitted_count || 0}/${dc.total_members || state.users.length} Sent</span>
        </div>
        <div class="mono-progress-track" aria-hidden="true">
          <div class="mono-progress-fill" style="width:${dc.compliance_rate || 0}%;"></div>
        </div>
        <div class="kpi-subtext">Pending: ${dc.pending_count || 0} • Auto-NA: ${dc.na_count || 0}</div>
      </div>

      <div class="glass-card kpi-glass-card">
        <div class="kpi-label">3. Active Blockers & Overdue</div>
        <div class="kpi-value-row">
          <span class="kpi-big-number">${a.blocker_count}</span>
          <span class="bw-badge ${a.blocker_count > 0 ? "bw-badge-striped" : "bw-badge-outline"}">
            ${a.overdue_count} Overdue
          </span>
        </div>
        <div class="mono-progress-track" aria-hidden="true">
          <div class="mono-progress-striped" style="width:${a.total_tasks ? Math.min(100, Math.round((a.blocker_count / a.total_tasks) * 100)) : 0}%;"></div>
        </div>
        <div class="kpi-subtext">Critical Priority Issues: ${a.priority_counts?.CRITICAL || 0}</div>
      </div>

      <div class="glass-card kpi-glass-card">
        <div class="kpi-label">4. Timeline Extensions & Team</div>
        <div class="kpi-value-row">
          <span class="kpi-big-number">${a.extension_count}</span>
          <span class="bw-badge bw-badge-outline">${state.users.length} Members</span>
        </div>
        <div class="mono-progress-track" aria-hidden="true">
          <div class="mono-progress-fill" style="width:${Math.min(100, a.extension_count * 15)}%;"></div>
        </div>
        <div class="kpi-subtext">Tracked with full manager audit history</div>
      </div>
    </section>
  `;
}

function renderCompactAnalyticsCharts(a) {
  const sc = a.status_counts || {};
  const total = a.total_tasks || 1;
  const donePct = Math.round(((sc.DONE || 0) / total) * 100);
  const progPct = Math.round((((sc.IN_PROGRESS || 0) + (sc.IN_REVIEW || 0)) / total) * 100);
  const dc = a.daily_compliance || {};

  const conicGradient = `conic-gradient(
    var(--chart-1) 0% ${donePct}%,
    var(--chart-3) ${donePct}% ${donePct + progPct}%,
    var(--chart-4) ${donePct + progPct}% 100%
  )`;

  return `
    <div class="analytics-grid-3col">
      <div class="glass-panel" style="padding:1rem;">
        <div style="font-size:var(--fs-xs);font-weight:800;text-transform:uppercase;margin-bottom:0.75rem;">
          Jira Issue Pipeline Ring
        </div>
        <div class="donut-chart-wrap">
          <div class="mono-donut" style="background:${conicGradient};" role="img" aria-label="Task completion ring chart showing ${donePct}% completed">
            <div class="mono-donut-hole">
              <span style="font-size:var(--fs-lg);font-weight:800;" class="tabular-nums">${donePct}%</span>
              <span style="font-size:var(--fs-2xs);color:var(--text-muted);font-weight:700;">DONE</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.35rem;flex:1;">
            <div style="display:flex;justify-content:space-between;font-size:var(--fs-xs);font-weight:700;">
              <span>■ Done</span><span>${sc.DONE || 0} (${donePct}%)</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:var(--fs-xs);color:var(--text-secondary);">
              <span>◐ In Progress / Review</span><span>${(sc.IN_PROGRESS || 0) + (sc.IN_REVIEW || 0)} (${progPct}%)</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:var(--fs-xs);color:var(--text-muted);">
              <span>○ To Do / Blocked</span><span>${(sc.TODO || 0) + (sc.BLOCKED || 0)}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="glass-panel" style="padding:1rem;display:flex;flex-direction:column;justify-content:space-between;gap:0.45rem;">
        <div style="font-size:var(--fs-xs);font-weight:800;text-transform:uppercase;">
          Jira Status Breakdown
        </div>
        ${[
          { label: "✓ DONE", count: sc.DONE || 0, striped: false },
          { label: "◐ IN PROGRESS", count: sc.IN_PROGRESS || 0, striped: false },
          { label: "◑ IN REVIEW", count: sc.IN_REVIEW || 0, striped: false },
          { label: "○ TO DO", count: sc.TODO || 0, striped: false },
          { label: "⚠ BLOCKED", count: sc.BLOCKED || 0, striped: true },
        ]
          .map((row) => {
            const pct = Math.round((row.count / total) * 100);
            return `
              <div class="bar-row">
                <div class="bar-row-header">
                  <span>${row.label}</span>
                  <span class="tabular-nums">${row.count} (${pct}%)</span>
                </div>
                <div class="mono-progress-track">
                  <div class="${row.striped ? "mono-progress-striped" : "mono-progress-fill"}" style="width:${pct}%;"></div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="glass-panel" style="padding:1rem;display:flex;flex-direction:column;justify-content:space-between;gap:0.55rem;">
        <div style="font-size:var(--fs-xs);font-weight:800;text-transform:uppercase;">
          8:00 PM Daily Status Meter
        </div>
        ${[
          { label: "✓ SUBMITTED (< 8 PM)", count: dc.submitted_count || 0, striped: false },
          { label: "◷ PENDING SUBMISSION", count: dc.pending_count || 0, striped: false },
          { label: "✕ AUTO-MARKED NA (≥ 8 PM)", count: dc.na_count || 0, striped: true },
        ]
          .map((row) => {
            const totM = dc.total_members || state.users.length || 1;
            const pct = Math.round((row.count / totM) * 100);
            return `
              <div class="bar-row">
                <div class="bar-row-header">
                  <span>${row.label}</span>
                  <span class="tabular-nums">${row.count} / ${totM} (${pct}%)</span>
                </div>
                <div class="mono-progress-track">
                  <div class="${row.striped ? "mono-progress-striped" : "mono-progress-fill"}" style="width:${pct}%;"></div>
                </div>
              </div>
            `;
          })
          .join("")}
        <div style="padding-top:0.35rem;border-top:1px solid var(--glass-divider);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:var(--fs-2xs);color:var(--text-muted);font-weight:700;">Cutoff: 8:00 PM IST</span>
          <button type="button" class="btn-bw-glass btn-sm" onclick="switchTab('daily')">Open 8 PM Status →</button>
        </div>
      </div>
    </div>
  `;
}

function setAnalyticsChartTab(tab) {
  state.analyticsChartTab = tab;
  render();
}

function setAnalyticsFilterSection(sec) {
  state.analyticsFilterSection = sec;
  render();
}

function renderBurndownAndBurnupCard(a) {
  const bd = a.burndown || {};
  const bu = a.burnup || {};
  const isBurnup = state.analyticsChartTab === "burnup";
  const days = isBurnup ? (bu.days || []) : (bd.days || []);
  const totalScope = bd.total_scope_points || a.total_points || 37;
  const completed = bd.completed_points || a.done_points || 8;
  const remaining = bd.remaining_points !== undefined ? bd.remaining_points : Math.max(0, totalScope - completed);
  const burnTarget = bd.daily_burn_target || 4.1;
  const actualRate = bd.actual_burn_rate || 2.0;
  const daysRemaining = bd.days_remaining !== undefined ? bd.days_remaining : 5;

  // SVG Chart Dimensions
  const svgWidth = 740;
  const svgHeight = 260;
  const padLeft = 55;
  const padRight = 45;
  const padTop = 30;
  const padBottom = 40;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;
  const maxPts = 40;

  const getX = (idx, total) => padLeft + (idx / Math.max(1, total - 1)) * plotW;
  const getY = (pts) => padTop + ((maxPts - Math.min(maxPts, Math.max(0, pts))) / maxPts) * plotH;

  // Gridlines & Y-Axis ticks
  const yTicks = [40, 30, 20, 10, 0];
  const gridLines = yTicks
    .map((tick) => {
      const y = getY(tick);
      return `
        <line x1="${padLeft}" y1="${y}" x2="${svgWidth - padRight}" y2="${y}" stroke="var(--border-divider)" stroke-width="1" stroke-dasharray="3,3" />
        <text x="${padLeft - 10}" y="${y + 4}" text-anchor="end" font-size="11" font-family="var(--font-mono)" fill="var(--text-muted)">${tick}</text>
      `;
    })
    .join("");

  // X-Axis labels
  const numDays = days.length || 9;
  let todayIdx = days.findIndex((d) => d.is_today);
  if (todayIdx === -1) todayIdx = 3;

  const xLabels = days
    .map((d, idx) => {
      const x = getX(idx, numDays);
      const isToday = d.is_today;
      return `
        <text x="${x}" y="${svgHeight - 14}" text-anchor="middle" font-size="11" font-family="var(--font-sans)" font-weight="${isToday ? "700" : "500"}" fill="${isToday ? "var(--notion-primary)" : "var(--text-secondary)"}">
          ${esc(d.label)}
        </text>
      `;
    })
    .join("");

  // Chart Lines according to mode
  let chartLinesSvg = "";
  const todayX = getX(todayIdx, numDays);

  if (!isBurnup) {
    // BURNDOWN MODE:
    // 1. Ideal Burndown Line (0, totalScope) -> (end, 0)
    const idealStart = { x: getX(0, numDays), y: getY(totalScope) };
    const idealEnd = { x: getX(numDays - 1, numDays), y: getY(0) };
    const idealLineSvg = `
      <line x1="${idealStart.x}" y1="${idealStart.y}" x2="${idealEnd.x}" y2="${idealEnd.y}" stroke="#94A3B8" stroke-dasharray="6,4" stroke-width="2" />
    `;

    // 2. Actual Burndown Line (Past + Today)
    const pastDays = days.filter((d) => d.is_past_or_today);
    const actualCoords = pastDays.map((d, idx) => ({
      x: getX(idx, numDays),
      y: getY(d.actual_remaining !== null && d.actual_remaining !== undefined ? d.actual_remaining : remaining),
      pts: d.actual_remaining !== null && d.actual_remaining !== undefined ? d.actual_remaining : remaining,
      d: d,
    }));

    let actualPathD = "";
    if (actualCoords.length > 0) {
      actualPathD = `M ${actualCoords[0].x},${actualCoords[0].y} ` + actualCoords.slice(1).map((c) => `L ${c.x},${c.y}`).join(" ");
    }

    // Shaded Area Polygon
    let areaPolygonSvg = "";
    if (actualCoords.length > 1) {
      const lastCoord = actualCoords[actualCoords.length - 1];
      const firstCoord = actualCoords[0];
      const zeroY = getY(0);
      areaPolygonSvg = `
        <polygon points="${firstCoord.x},${zeroY} ${actualCoords.map((c) => `${c.x},${c.y}`).join(" ")} ${lastCoord.x},${zeroY}" fill="url(#burnBlueGrad)" />
      `;
    }

    // 3. Projected Burndown Line (Today -> End)
    const projDays = days.filter((d, idx) => idx >= todayIdx);
    const projCoords = projDays.map((d, i) => {
      const realIdx = todayIdx + i;
      return {
        x: getX(realIdx, numDays),
        y: getY(d.projected_remaining !== null && d.projected_remaining !== undefined ? d.projected_remaining : 0),
        pts: d.projected_remaining,
        d: d,
      };
    });

    let projPathD = "";
    if (projCoords.length > 0) {
      projPathD = `M ${projCoords[0].x},${projCoords[0].y} ` + projCoords.slice(1).map((c) => `L ${c.x},${c.y}`).join(" ");
    }

    // Points on Actual Line
    const pointCirclesSvg = actualCoords
      .map(
        (c) => `
        <circle cx="${c.x}" cy="${c.y}" r="5" fill="#ffffff" stroke="#0075DE" stroke-width="2.5" style="cursor:pointer;">
          <title>${c.d.label} (Day ${c.d.day_index}): ${c.pts} story points remaining</title>
        </circle>
      `
      )
      .join("");

    // Points on Projected Line
    const projCirclesSvg = projCoords
      .slice(1)
      .map(
        (c) => `
        <circle cx="${c.x}" cy="${c.y}" r="4" fill="#ffffff" stroke="#27918D" stroke-width="2" stroke-dasharray="2,2" style="cursor:pointer;">
          <title>${c.d.label} (Projected Pace): ${c.pts} story points remaining</title>
        </circle>
      `
      )
      .join("");

    chartLinesSvg = `
      ${idealLineSvg}
      ${areaPolygonSvg}
      ${actualPathD ? `<path d="${actualPathD}" fill="none" stroke="#0075DE" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
      ${projPathD ? `<path d="${projPathD}" fill="none" stroke="#27918D" stroke-dasharray="5,4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
      ${pointCirclesSvg}
      ${projCirclesSvg}
    `;
  } else {
    // BURNUP MODE:
    // 1. Total Scope Line
    const scopeY = getY(totalScope);
    const scopeLineSvg = `
      <line x1="${getX(0, numDays)}" y1="${scopeY}" x2="${getX(numDays - 1, numDays)}" y2="${scopeY}" stroke="#9849E8" stroke-dasharray="6,4" stroke-width="2.5" />
      <text x="${getX(numDays - 1, numDays) - 5}" y="${scopeY - 8}" text-anchor="end" font-size="11" font-weight="700" fill="#9849E8">Total Scope: ${totalScope} pts</text>
    `;

    // 2. Actual Completed Points
    const pastDays = days.filter((d) => d.is_past_or_today);
    const actualCoords = pastDays.map((d, idx) => ({
      x: getX(idx, numDays),
      y: getY(d.actual_completed !== null && d.actual_completed !== undefined ? d.actual_completed : completed),
      pts: d.actual_completed !== null && d.actual_completed !== undefined ? d.actual_completed : completed,
      d: d,
    }));

    let actualPathD = "";
    if (actualCoords.length > 0) {
      actualPathD = `M ${actualCoords[0].x},${actualCoords[0].y} ` + actualCoords.slice(1).map((c) => `L ${c.x},${c.y}`).join(" ");
    }

    let areaPolygonSvg = "";
    if (actualCoords.length > 1) {
      const lastCoord = actualCoords[actualCoords.length - 1];
      const firstCoord = actualCoords[0];
      const zeroY = getY(0);
      areaPolygonSvg = `
        <polygon points="${firstCoord.x},${zeroY} ${actualCoords.map((c) => `${c.x},${c.y}`).join(" ")} ${lastCoord.x},${zeroY}" fill="url(#burnTealGrad)" />
      `;
    }

    // 3. Projected Completed Points
    const projDays = days.filter((d, idx) => idx >= todayIdx);
    const projCoords = projDays.map((d, i) => {
      const realIdx = todayIdx + i;
      return {
        x: getX(realIdx, numDays),
        y: getY(d.projected_completed !== null && d.projected_completed !== undefined ? d.projected_completed : totalScope),
        pts: d.projected_completed,
        d: d,
      };
    });

    let projPathD = "";
    if (projCoords.length > 0) {
      projPathD = `M ${projCoords[0].x},${projCoords[0].y} ` + projCoords.slice(1).map((c) => `L ${c.x},${c.y}`).join(" ");
    }

    const pointCirclesSvg = actualCoords
      .map(
        (c) => `
        <circle cx="${c.x}" cy="${c.y}" r="5" fill="#ffffff" stroke="#27918D" stroke-width="2.5" style="cursor:pointer;">
          <title>${c.d.label} (Day ${c.d.day_index}): ${c.pts} story points delivered</title>
        </circle>
      `
      )
      .join("");

    const projCirclesSvg = projCoords
      .slice(1)
      .map(
        (c) => `
        <circle cx="${c.x}" cy="${c.y}" r="4" fill="#ffffff" stroke="#62AEF0" stroke-width="2" stroke-dasharray="2,2" style="cursor:pointer;">
          <title>${c.d.label} (Projected Deliveries): ${c.pts} story points</title>
        </circle>
      `
      )
      .join("");

    chartLinesSvg = `
      ${scopeLineSvg}
      ${areaPolygonSvg}
      ${actualPathD ? `<path d="${actualPathD}" fill="none" stroke="#27918D" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
      ${projPathD ? `<path d="${projPathD}" fill="none" stroke="#62AEF0" stroke-dasharray="5,4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
      ${pointCirclesSvg}
      ${projCirclesSvg}
    `;
  }

  // Today Vertical Line & Badge
  const todayMarkerSvg = `
    <line x1="${todayX}" y1="${padTop - 5}" x2="${todayX}" y2="${getY(0)}" stroke="#27918D" stroke-dasharray="3,3" stroke-width="1.5" />
    <rect x="${todayX - 25}" y="7" width="50" height="17" rx="4" fill="#27918D" />
    <text x="${todayX}" y="19" text-anchor="middle" fill="#ffffff" font-size="9" font-weight="700" letter-spacing="0.5">TODAY</text>
  `;

  return `
    <section class="burndown-chart-card" id="analytics-section-burndown">
      <div class="burndown-header-row">
        <div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <h2 class="section-card-title" style="margin:0;">
              ${isBurnup ? "📈 Sprint Burnup Chart" : "📉 Sprint Burndown Chart"} — ${esc(bd.sprint_name || "Sprint 14")}
            </h2>
            <span class="notion-badge notion-badge-primary">${totalScope} Total Points</span>
            <span class="notion-badge notion-badge-success">${completed} Points Delivered (${Math.round((completed / totalScope) * 100)}%)</span>
          </div>
          <p class="section-card-subtitle" style="margin-top:0.25rem;">
            ${isBurnup
              ? "Tracks scope stability (committed points) versus accumulated deliverable points rising to target."
              : "Tracks remaining effort in story points decremented to zero by sprint close on Nov 03."}
          </p>
        </div>

        <!-- Mode Toggle: Burndown vs Burnup -->
        <div class="notion-segmented" role="group" aria-label="Burndown or Burnup Toggle">
          <button
            type="button"
            class="notion-segmented-btn ${!isBurnup ? "active" : ""}"
            onclick="setAnalyticsChartTab('burndown')"
          >
            📉 Burndown (Remaining)
          </button>
          <button
            type="button"
            class="notion-segmented-btn ${isBurnup ? "active" : ""}"
            onclick="setAnalyticsChartTab('burnup')"
          >
            📈 Burnup (Scope & Deliveries)
          </button>
        </div>
      </div>

      <!-- KPI Summary Strip -->
      <div class="burndown-kpi-strip">
        <div class="burndown-kpi-pill">
          <span class="burndown-kpi-label">Sprint Scope</span>
          <span class="burndown-kpi-value">${totalScope} pts</span>
        </div>
        <div class="burndown-kpi-pill">
          <span class="burndown-kpi-label">Completed</span>
          <span class="burndown-kpi-value" style="color:var(--notion-teal);">${completed} pts</span>
        </div>
        <div class="burndown-kpi-pill">
          <span class="burndown-kpi-label">Remaining</span>
          <span class="burndown-kpi-value" style="color:var(--notion-primary);">${remaining} pts</span>
        </div>
        <div class="burndown-kpi-pill">
          <span class="burndown-kpi-label">Target Burn Rate</span>
          <span class="burndown-kpi-value">${burnTarget} pts/day</span>
        </div>
        <div class="burndown-kpi-pill">
          <span class="burndown-kpi-label">Actual Velocity</span>
          <span class="burndown-kpi-value">${actualRate} pts/day</span>
        </div>
        <div class="burndown-kpi-pill">
          <span class="burndown-kpi-label">Days Left</span>
          <span class="burndown-kpi-value" style="color:var(--notion-orange);">${daysRemaining} Days</span>
        </div>
      </div>

      <!-- Interactive SVG Chart Viewport -->
      <div class="burndown-svg-container" role="region" aria-label="${isBurnup ? "Sprint Burnup Chart" : "Sprint Burndown Chart"}">
        <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="burndown-svg" aria-hidden="true">
          <defs>
            <linearGradient id="burnBlueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0075DE" stop-opacity="0.28" />
              <stop offset="100%" stop-color="#0075DE" stop-opacity="0.02" />
            </linearGradient>
            <linearGradient id="burnTealGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#27918D" stop-opacity="0.28" />
              <stop offset="100%" stop-color="#27918D" stop-opacity="0.02" />
            </linearGradient>
          </defs>

          <!-- Grid & Axis -->
          ${gridLines}
          ${xLabels}

          <!-- Chart Lines & Polygons -->
          ${chartLinesSvg}

          <!-- Today Marker -->
          ${todayMarkerSvg}
        </svg>
      </div>

      <!-- Legend -->
      <div class="burndown-legend">
        ${!isBurnup
          ? `
          <div class="legend-item">
            <span class="legend-line legend-line-dashed"></span>
            <span>Ideal Burndown (${burnTarget} pts/day target)</span>
          </div>
          <div class="legend-item">
            <span class="legend-line" style="background:#0075DE;"></span>
            <strong style="color:var(--text-primary);">Actual Remaining (${remaining} pts)</strong>
          </div>
          <div class="legend-item">
            <span class="legend-line legend-line-dotted"></span>
            <span>Projected Delivery (Pace: on track for Nov 03)</span>
          </div>
          <div class="legend-item">
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#27918D;"></span>
            <span>Today (Oct 29 IST)</span>
          </div>
        `
          : `
          <div class="legend-item">
            <span class="legend-line legend-line-dashed" style="border-top-color:#9849E8;"></span>
            <strong style="color:#9849E8;">Total Committed Scope (${totalScope} pts)</strong>
          </div>
          <div class="legend-item">
            <span class="legend-line" style="background:#27918D;"></span>
            <strong style="color:var(--text-primary);">Actual Completed Story Points (${completed} pts)</strong>
          </div>
          <div class="legend-item">
            <span class="legend-line legend-line-dotted" style="border-top-color:#62AEF0;"></span>
            <span>Projected Scope Completion</span>
          </div>
        `}
      </div>
    </section>
  `;
}

function render7DayComplianceCard(a) {
  const trend = a.compliance_trend || [];
  const avgRate = trend.length ? Math.round(trend.reduce((acc, t) => acc + (t.rate || 0), 0) / trend.length) : 0;
  const totalSubmissions = trend.reduce((acc, t) => acc + (t.submitted || 0), 0);
  const totalNAs = trend.reduce((acc, t) => acc + (t.na || 0), 0);

  return `
    <section class="glass-card section-card" id="analytics-section-compliance">
      <div class="section-card-header">
        <div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <h2 class="section-card-title">🕗 7-Day 8:00 PM Daily Status Compliance Trend</h2>
            <span class="notion-badge notion-badge-success">${avgRate}% 7-Day Average</span>
            <span class="notion-badge notion-badge-neutral">${totalSubmissions} Total Submitted</span>
            ${totalNAs > 0 ? `<span class="notion-badge notion-badge-danger">${totalNAs} Auto-NA Flags</span>` : ""}
          </div>
          <p class="section-card-subtitle">
            Monitors team on-time daily comment submission consistency before the automated 8:00 PM IST cutoff.
          </p>
        </div>
        <button type="button" class="btn-bw-glass btn-sm" onclick="switchTab('daily')">Open Daily Status →</button>
      </div>

      <div class="compliance-trend-grid">
        ${trend
          .map((d) => {
            const tot = d.total || 9;
            const subPct = Math.round(((d.submitted || 0) / tot) * 100);
            const naPct = Math.round(((d.na || 0) / tot) * 100);
            return `
              <div class="compliance-day-card ${d.is_today ? "today" : ""}">
                <div style="font-size:var(--fs-2xs);font-weight:700;color:${d.is_today ? "var(--notion-primary)" : "var(--text-muted)"};">
                  ${esc(d.day_name)}
                </div>
                <div style="font-size:var(--fs-xs);font-weight:800;color:var(--text-primary);">
                  ${esc(d.label)}
                </div>

                <div class="compliance-mini-bar-track" title="${d.submitted}/${tot} submitted, ${d.na} auto-NA">
                  <div class="compliance-mini-bar-fill" style="block-size:${subPct}%;"></div>
                  ${d.na > 0 ? `<div class="compliance-mini-bar-na" style="block-size:${naPct}%;"></div>` : ""}
                </div>

                <span class="notion-badge ${d.rate >= 80 ? "notion-badge-success" : d.rate > 0 ? "notion-badge-orange" : "notion-badge-danger"}" style="font-size:0.65rem;padding:2px 6px;">
                  ${d.rate}%
                </span>
                <div style="font-size:0.65rem;color:var(--text-muted);white-space:nowrap;">
                  ${d.submitted}/${tot} Sent
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderVelocityHistoryCard(a) {
  const history = a.velocity_history || [];

  return `
    <section class="glass-card section-card" id="analytics-section-velocity">
      <div class="section-card-header">
        <div>
          <h2 class="section-card-title">📊 Multi-Sprint Velocity & Throughput Comparison</h2>
          <p class="section-card-subtitle">
            Committed story points vs delivered story points across completed and active sprints.
          </p>
        </div>
        <span class="notion-badge notion-badge-primary">Sprint Delivery Efficiency</span>
      </div>

      <div style="display:flex;flex-direction:column;gap:0.4rem;">
        ${history
          .map((vh) => {
            const committed = vh.committed || 30;
            const delivered = vh.delivered || 0;
            const maxPts = 40;
            const delivPct = Math.round((delivered / maxPts) * 100);
            const commitPct = Math.round((committed / maxPts) * 100);
            const gapPct = Math.max(0, commitPct - delivPct);

            return `
              <div class="velocity-sprint-row">
                <div>
                  <div style="font-weight:700;font-size:var(--fs-sm);">${esc(vh.sprint)}</div>
                  <div style="font-size:var(--fs-2xs);color:var(--text-muted);">${vh.status === "ACTIVE" ? "In Progress" : "Completed"}</div>
                </div>

                <div class="velocity-bar-dual" title="${delivered} of ${committed} points delivered (${vh.velocity_pct}%)">
                  <div class="velocity-bar-delivered" style="inline-size:${delivPct}%;"></div>
                  <div class="velocity-bar-gap" style="inline-size:${gapPct}%;"></div>
                </div>

                <div style="text-align:right;">
                  <span class="notion-badge ${vh.status === "ACTIVE" ? "notion-badge-orange" : "notion-badge-success"}">
                    ${delivered}/${committed} pts (${vh.velocity_pct}%)
                  </span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderTimelineExtensionsAuditCard(a) {
  const extensions = a.timeline_extensions_audit || [];

  return `
    <section class="glass-card section-card" id="analytics-section-extensions">
      <div class="section-card-header">
        <div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <h2 class="section-card-title">📅 Timeline Extensions & Deadline Slippage Audit Log</h2>
            <span class="notion-badge notion-badge-orange">${extensions.length} Authorized Extensions</span>
          </div>
          <p class="section-card-subtitle">
            Formal managerial audit trail of task deadline adjustments, reasons, and date drift.
          </p>
        </div>
        <button type="button" class="btn-bw-glass btn-sm" onclick="switchTab('timeline')">Open Timeline Roadmap →</button>
      </div>

      ${
        extensions.length === 0
          ? `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:var(--fs-xs);">No deadline extensions requested yet. All tasks are currently on their original schedules.</div>`
          : `
        <div class="table-scroll-container" tabindex="0" role="region" aria-label="Timeline Extensions Audit Table">
          <table class="bw-table">
            <thead>
              <tr>
                <th>Task Key & Title</th>
                <th>Assignee</th>
                <th>Original Date</th>
                <th>Extended Date</th>
                <th>Drift</th>
                <th>Manager Reason</th>
                <th>Authorized By</th>
                <th>Audit Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${extensions
                .map(
                  (ex) => `
                <tr>
                  <td>
                    <span class="notion-badge notion-badge-neutral">${esc(ex.task_id)}</span>
                    <strong style="margin-left:0.35rem;">${esc(ex.task_title)}</strong>
                  </td>
                  <td>${esc(ex.assignee_name)}</td>
                  <td class="tabular-nums">${esc(ex.old_due_date)}</td>
                  <td class="tabular-nums" style="font-weight:700;color:var(--notion-primary);">${esc(ex.new_due_date)}</td>
                  <td>
                    <span class="notion-badge notion-badge-orange">Extended</span>
                  </td>
                  <td style="max-width:280px;">${esc(ex.reason)}</td>
                  <td>${esc(ex.extended_by_name)}</td>
                  <td class="tabular-nums" style="font-size:var(--fs-2xs);color:var(--text-muted);">${esc(ex.timestamp)}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
      }
    </section>
  `;
}

function renderAnalyticsView() {
  const a = computeLocalAnalytics();
  const workload = a.member_workload || [];
  const filter = state.analyticsFilterSection || "ALL";

  return `
    <div class="mac-content-scroll">
      <!-- 1. Top KPI Summary Strip -->
      ${renderKpiStrip(a)}

      <!-- 2. Analytics Sub-Section Quick Filter Pills -->
      <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;padding:0.25rem 0;">
        ${[
          { id: "ALL", label: "All Analytics Views" },
          { id: "burndown", label: "📉 Burndown & Burnup" },
          { id: "velocity", label: "📊 Velocity History" },
          { id: "compliance", label: "🕗 8 PM Compliance Trend" },
          { id: "pipeline", label: "◐ Issue Pipeline & CFD" },
          { id: "workload", label: "👥 Team Workload" },
          { id: "extensions", label: "📅 Timeline Extensions" },
        ]
          .map(
            (tab) => `
          <button
            type="button"
            class="notion-segmented-btn ${filter === tab.id ? "active" : ""}"
            onclick="setAnalyticsFilterSection('${tab.id}')"
          >
            ${tab.label}
          </button>
        `
          )
          .join("")}
      </div>

      <!-- 3. Sprint Burndown & Burnup Chart -->
      ${filter === "ALL" || filter === "burndown" ? renderBurndownAndBurnupCard(a) : ""}

      <!-- 4. Multi-Sprint Velocity History -->
      ${filter === "ALL" || filter === "velocity" ? renderVelocityHistoryCard(a) : ""}

      <!-- 5. 7-Day 8:00 PM Daily Status Compliance Trend -->
      ${filter === "ALL" || filter === "compliance" ? render7DayComplianceCard(a) : ""}

      <!-- 6. Issue Pipeline Ring & Status Distribution -->
      ${
        filter === "ALL" || filter === "pipeline"
          ? `
        <section class="glass-card section-card" id="analytics-section-pipeline">
          <div class="section-card-header">
            <div>
              <h2 class="section-card-title">◐ Jira Status Distribution, Issue Pipeline & Today's 8 PM Meter</h2>
              <p class="section-card-subtitle">Real-time breakdown across all 5 Jira stages and team daily submissions</p>
            </div>
          </div>
          ${renderCompactAnalyticsCharts(a)}
        </section>
      `
          : ""
      }

      <!-- 7. Timeline Extensions & Deadline Slippage Audit -->
      ${filter === "ALL" || filter === "extensions" ? renderTimelineExtensionsAuditCard(a) : ""}

      <!-- 8. Team Member Workload Matrix -->
      ${
        filter === "ALL" || filter === "workload"
          ? `
        <section class="glass-card section-card" id="analytics-section-workload">
          <div class="section-card-header">
            <div>
              <h2 class="section-card-title">👥 Team Member Workload, Blockers & 8:00 PM Status Matrix</h2>
              <p class="section-card-subtitle">Individual issue load, completion rate, timeline extensions, and today's 8:00 PM status</p>
            </div>
          </div>

          <div class="table-scroll-container" tabindex="0" role="region" aria-label="Team Workload Matrix">
            <table class="bw-table">
              <thead>
                <tr>
                  <th>Team Member</th>
                  <th>Department</th>
                  <th>Assigned</th>
                  <th>Done</th>
                  <th>Blockers</th>
                  <th>Extensions</th>
                  <th>8:00 PM Status</th>
                  <th>Completion</th>
                </tr>
              </thead>
              <tbody>
                ${workload
                  .map(
                    (m) => `
                  <tr>
                    <td>
                      <div style="font-weight:700;">${esc(m.full_name)}</div>
                      <div style="font-size:var(--fs-2xs);color:var(--text-muted);">@${esc(m.username)}</div>
                    </td>
                    <td>${esc(m.department)}</td>
                    <td class="tabular-nums" style="font-weight:700;">${m.total_tasks}</td>
                    <td class="tabular-nums">${m.done_tasks}</td>
                    <td>
                      ${
                        m.blocked_tasks > 0
                          ? `<span class="notion-badge notion-badge-danger">⚠ ${m.blocked_tasks}</span>`
                          : `<span class="notion-badge notion-badge-neutral">0</span>`
                      }
                    </td>
                    <td class="tabular-nums">${m.extensions}</td>
                    <td>${renderDailyStatusBadge(m.daily_status)}</td>
                    <td style="min-width:140px;">
                      <div style="display:flex;align-items:center;gap:0.45rem;">
                        <div class="mono-progress-track" style="flex:1;">
                          <div class="mono-progress-fill" style="width:${m.completion_pct}%;"></div>
                        </div>
                        <span class="tabular-nums" style="font-size:var(--fs-2xs);font-weight:700;">${m.completion_pct}%</span>
                      </div>
                    </td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `
          : ""
      }
    </div>
  `;
}

/* --------------------------------------------------------------------------
   12. JIRA VIEW 5: 8:00 PM DAILY STATUS & AUTO-NA EMAIL BOARD
   -------------------------------------------------------------------------- */

function renderDailyStatusView() {
  const isAdmin = isAdminUser();
  const isEditable = state.systemInfo?.daily_status_editable !== false;
  const myEntry = state.dailyMe?.entry || {};
  const allEntries = state.dailyAll?.entries || [];
  const filteredEntries =
    state.dailyFilter === "ALL"
      ? allEntries
      : allEntries.filter((e) => e.status === state.dailyFilter);

  return `
    <div class="mac-content-scroll">
      <div class="workspace-split-grid">
        <section class="glass-card section-card">
          <div class="section-card-header">
            <div>
              <h2 class="section-card-title">✎ Submit My Daily Tasks (Before 8:00 PM)</h2>
              <p class="section-card-subtitle">
                ${
                  isEditable
                    ? "Editable until 8:00 PM IST. At 8:00 PM, unsubmitted users are marked NA."
                    : "LOCKED (After 8:00 PM IST). Unsubmitted users are marked NA."
                }
              </p>
            </div>
            ${renderDailyStatusBadge(myEntry.status || "PENDING")}
          </div>

          <form onsubmit="submitMyDailyStatus(event)" style="display:flex;flex-direction:column;gap:0.8rem;">
            <div class="form-group">
              <label class="form-label" for="daily-full-tasks">Today's Jira Issues Worked On (One per line)</label>
              <textarea
                id="daily-full-tasks"
                class="glass-textarea"
                placeholder="CSR-101: Completed wireframes\nCSR-103: Reviewed design system tokens"
                ${!isEditable ? "disabled" : ""}
                required
              >${esc((myEntry.tasks_summary || []).join("\n"))}</textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="daily-full-comments">Daily Status Comments</label>
              <textarea
                id="daily-full-comments"
                class="glass-textarea"
                placeholder="Summarize progress, deliverables, and next steps..."
                ${!isEditable ? "disabled" : ""}
                required
              >${esc(myEntry.comments || "")}</textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="daily-full-blockers">Blockers / Dependencies (Optional)</label>
              <input
                id="daily-full-blockers"
                type="text"
                class="glass-input"
                placeholder="Any blockers needing manager attention..."
                value="${esc(myEntry.blockers || "")}"
                ${!isEditable ? "disabled" : ""}
              />
            </div>

            <button type="submit" class="btn-bw-primary" ${!isEditable ? "disabled style='opacity:0.5;cursor:not-allowed;'" : ""}>
              ${myEntry.status === "SUBMITTED" ? "✓ Update Daily Status (Before 8:00 PM)" : "✓ Submit Daily Status"}
            </button>
          </form>
        </section>

        <section class="glass-card section-card">
          <div class="section-card-header">
            <div>
              <h2 class="section-card-title">👥 Team 8:00 PM Compliance Matrix</h2>
              <p class="section-card-subtitle">
                Submitted: ${state.dailyAll?.submitted_count || 0} • Pending: ${state.dailyAll?.pending_count || 0} • Auto-NA: ${state.dailyAll?.na_count || 0}
              </p>
            </div>
            ${
              isAdmin
                ? `<button type="button" class="btn-bw-primary btn-sm" onclick="trigger8PmEmailNow()">
                    ✉ Trigger 8:00 PM Cutoff & Email
                  </button>`
                : ""
            }
          </div>

          <div class="segmented-glass" style="align-self:flex-start;">
            ${["ALL", "SUBMITTED", "PENDING", "NA"]
              .map(
                (f) => `
              <button type="button" class="segmented-btn ${state.dailyFilter === f ? "active" : ""}" onclick="state.dailyFilter='${f}';render();">
                ${f}
              </button>
            `
              )
              .join("")}
          </div>

          <div class="table-scroll-container" tabindex="0" role="region" aria-label="Team Daily Status Table">
            <table class="bw-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>8:00 PM Status</th>
                  <th>Daily Comments</th>
                  <th>Blockers</th>
                </tr>
              </thead>
              <tbody>
                ${filteredEntries
                  .map(
                    (e) => `
                  <tr>
                    <td>
                      <div style="font-weight:700;">${esc(e.full_name)}</div>
                      <div style="font-size:var(--fs-2xs);color:var(--text-muted);">${esc(e.department || "")}</div>
                    </td>
                    <td>
                      ${renderDailyStatusBadge(e.status)}
                      <div style="font-size:var(--fs-2xs);color:var(--text-muted);margin-top:0.15rem;" class="tabular-nums">
                        ${esc(e.updated_at_ist || "Not submitted")}
                      </div>
                    </td>
                    <td>
                      ${
                        e.status === "NA"
                          ? `<strong>NA — Did not submit before 8:00 PM</strong>`
                          : `<div>${esc(e.comments || "—")}</div>`
                      }
                    </td>
                    <td>${esc(e.blockers || "None")}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;
}

async function submitMyDailyStatus(e) {
  e.preventDefault();
  const fullTasks = document.getElementById("daily-full-tasks")?.value || "";
  const fullComments = document.getElementById("daily-full-comments")?.value || "";
  const blockers = document.getElementById("daily-full-blockers")?.value || "";

  const tasksList = fullTasks
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    await apiFetch("/api/daily-status", {
      method: "POST",
      body: JSON.stringify({
        tasks_summary: tasksList.length ? tasksList : [fullComments.trim()],
        comments: fullComments.trim(),
        blockers: blockers.trim(),
      }),
    });
    await refreshWorkspaceData();
    showToast("Daily Status submitted before 8:00 PM!");
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function trigger8PmEmailNow() {
  try {
    const res = await apiFetch("/api/daily-status/trigger-8pm-report", {
      method: "POST",
    });
    await refreshWorkspaceData();
    showToast(
      `8:00 PM Report Dispatched! Submitted: ${res.report.submitted_count}, Marked NA: ${res.report.na_count}`
    );
    state.activeTab = "comments";
    state.commentSubTab = "email_reports";
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function simulateClock(hour, minute) {
  try {
    const q = hour === null ? "" : `?hour=${hour}&minute=${minute}`;
    state.systemInfo = await apiFetch(`/api/admin/simulate-clock${q}`, {
      method: "POST",
    });
    await refreshWorkspaceData();
    showToast(
      hour === null
        ? "Reset to real IST clock."
        : `Simulated IST Clock set to ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    );
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* --------------------------------------------------------------------------
   12b. JIRA VIEW: TEAMS & SQUADS MANAGEMENT (CREATE, EDIT, ASSIGN TEAMS)
   -------------------------------------------------------------------------- */

function renderTeamsView() {
  const isAdmin = isAdminUser();

  return `
    <div class="mac-content-scroll">
      <section class="glass-card section-card">
        <div class="section-card-header">
          <div>
            <h2 class="section-card-title">
              🏢 Teams & Squads Administration
            </h2>
            <p class="section-card-subtitle">
              ${state.teams.length} teams configured • Organize your DevOps, Engineering & Custom squads
            </p>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center;">
            ${
              state.selectedTeamFilter !== "ALL"
                ? `<button type="button" class="btn-bw-glass btn-sm" onclick="filterByTeam('ALL')">
                    ✕ Clear Team Filter
                   </button>`
                : ""
            }
            ${
              isAdmin
                ? `<button type="button" class="btn-bw-primary" onclick="openCreateTeamDialog()">
                    + Create New Team
                   </button>`
                : ""
            }
          </div>
        </div>

        <!-- TEAMS GRID -->
        <div class="user-cards-grid" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
          ${state.teams
            .map((tm) => {
              const isSelected = state.selectedTeamFilter === tm.id;
              const memberIds = tm.member_ids || [];
              const members = state.users.filter((u) => memberIds.includes(u.id));
              const lead = state.users.find((u) => u.id === tm.lead_id);
              const teamTasks = state.tasks.filter((t) => memberIds.includes(t.assignee_id));
              const doneTasks = teamTasks.filter((t) => t.status === "DONE").length;

              return `
                <article class="user-glass-card ${isSelected ? "selected-team-card" : ""}" style="display:flex;flex-direction:column;justify-content:space-between;gap:0.75rem;">
                  <div>
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;">
                      <div>
                        <div style="font-size:var(--fs-md);font-weight:800;color:var(--text-primary);">
                          ${esc(tm.name)}
                        </div>
                        <div style="font-size:var(--fs-2xs);color:var(--text-muted);font-family:var(--font-mono);">
                          ${esc(tm.id)}
                        </div>
                      </div>
                      <span class="bw-badge ${tm.id === 'TEAM-DEVOPS' ? 'bw-badge-solid' : 'bw-badge-outline'}">
                        ${esc(tm.slug || 'team')}
                      </span>
                    </div>

                    <p style="font-size:var(--fs-xs);color:var(--text-secondary);margin-top:0.4rem;line-height:1.4;">
                      ${esc(tm.description || "No description provided.")}
                    </p>
                  </div>

                  <div style="padding-block:0.4rem;border-block:1px solid var(--glass-divider);font-size:var(--fs-xs);display:flex;flex-direction:column;gap:0.35rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <span style="color:var(--text-muted);">Team Lead:</span>
                      <strong>${esc(lead ? lead.full_name : tm.lead_name || "Unassigned")}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <span style="color:var(--text-muted);">Assigned Tasks:</span>
                      <span class="tabular-nums">📋 <strong>${doneTasks}/${teamTasks.length}</strong> Done</span>
                    </div>

                    <!-- Member Avatar Badges -->
                    <div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.25rem;">
                      ${members.length > 0
                        ? members.map(m => `
                            <span class="notion-badge notion-badge-neutral" style="font-size:var(--fs-2xs);padding:2px 6px;" title="${esc(m.full_name)} (@${esc(m.username)})">
                              <span class="mono-avatar" style="width:14px;height:14px;font-size:8px;margin-right:3px;">${esc(initials(m.full_name))}</span>
                              ${esc(m.full_name.split(' ')[0])}
                            </span>
                          `).join("")
                        : `<span style="font-size:var(--fs-2xs);color:var(--text-muted);">No members assigned yet</span>`
                      }
                    </div>
                  </div>

                  <div style="display:flex;gap:0.4rem;justify-content:space-between;align-items:center;flex-wrap:wrap;">
                    <button
                      type="button"
                      class="btn-bw-glass btn-sm ${isSelected ? 'active' : ''}"
                      onclick="focusTeam('${esc(tm.id)}')"
                      title="Filter Sprint Board & Backlog to this Team"
                    >
                      ${isSelected ? '✓ Viewing Team' : '🔍 Focus Board'}
                    </button>
                    ${isAdmin ? `
                      <div style="display:flex;gap:0.3rem;">
                        <button type="button" class="btn-bw-glass btn-sm" onclick="openEditTeamDialog('${esc(tm.id)}')">
                          ✎ Edit
                        </button>
                        <button type="button" class="btn-bw-danger btn-sm" onclick="openDeleteTeamConfirmDialog('${esc(tm.id)}', '${esc(tm.name)}')">
                          🗑 Delete
                        </button>
                      </div>
                    ` : ""}
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   13. JIRA VIEW 6: PEOPLE & USER ADMINISTRATION (ADD / EDIT / DELETE USERS)
   -------------------------------------------------------------------------- */

function renderUsersDirectoryView() {
  const isAdmin = isAdminUser();

  return `
    <div class="mac-content-scroll">
      <section class="glass-card section-card">
        <div class="section-card-header">
          <div>
            <h2 class="section-card-title">
              👥 ${isAdmin ? "Jira People & Manager User Administration (Add / Edit / Delete)" : "Project People Directory"}
            </h2>
            <p class="section-card-subtitle">
              ${state.users.length} members in CSR Work Flow Manager
            </p>
          </div>
          ${
            isAdmin
              ? `<button type="button" class="btn-bw-primary" onclick="openCreateUserDialog()">
                  + Add New User
                </button>`
              : ""
          }
        </div>

        <div class="user-cards-grid">
          ${state.users
            .map((u) => {
              const uTasks = state.tasks.filter((t) => t.assignee_id === u.id);
              const uDone = uTasks.filter((t) => t.status === "DONE").length;
              return `
                <article class="user-glass-card">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.65rem;">
                    <div style="display:flex;align-items:center;gap:0.65rem;">
                      <div class="mono-avatar">${esc(initials(u.full_name))}</div>
                      <div>
                        <div style="font-size:var(--fs-md);font-weight:800;">${esc(u.full_name)}</div>
                        <div style="font-size:var(--fs-2xs);color:var(--text-muted);">@${esc(u.username)} • ${esc(u.email)}</div>
                      </div>
                    </div>
                    <span class="bw-badge ${isAdminUser(u) ? "bw-badge-solid" : "bw-badge-outline"}">
                      ${esc(u.role)}
                    </span>
                  </div>

                  <div style="display:flex;justify-content:space-between;align-items:center;padding-block:0.5rem;border-block:1px solid var(--glass-divider);font-size:var(--fs-xs);">
                    <span>🏢 <strong>${esc(u.department || "General")}</strong> • <span class="notion-badge notion-badge-neutral" style="font-size:var(--fs-2xs);padding:1px 5px;">${esc((state.teams.find(tm => tm.id === u.team_id) || {}).name || "DevOps Team")}</span></span>
                    <span class="tabular-nums">📋 <strong>${uDone}/${uTasks.length}</strong> Done</span>
                  </div>

                  ${
                    isAdmin
                      ? `
                    <div style="display:flex;gap:0.4rem;justify-content:flex-end;">
                      <button type="button" class="btn-bw-glass btn-sm" onclick="openEditUserDialog('${esc(u.id)}')">
                        ✎ Edit User
                      </button>
                      ${
                        u.id !== state.user.id
                          ? `<button type="button" class="btn-bw-danger btn-sm" onclick="openDeleteUserConfirmDialog('${esc(u.id)}', '${esc(u.full_name)}')">
                              🗑 Delete User
                            </button>`
                          : `<span class="bw-badge bw-badge-dashed">Current Admin</span>`
                      }
                    </div>
                  `
                      : ""
                  }
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   14. JIRA VIEW 7: ALL USER COMMENTS, BLOCKERS & 8:00 PM EMAIL REPORTS
   -------------------------------------------------------------------------- */

function renderCommentsAndMailView() {
  const isAdmin = isAdminUser();
  const taskComments = state.allComments?.task_comments || [];
  const dailyEntries = state.dailyAll?.entries || [];
  const reports = state.dailyReports || [];

  return `
    <div class="mac-content-scroll">
      <section class="glass-card section-card">
        <div class="section-card-header">
          <div class="segmented-glass">
            <button type="button" class="segmented-btn ${state.commentSubTab === "task_comments" ? "active" : ""}" onclick="state.commentSubTab='task_comments';render();">
              💬 Jira Issue Comments & Blockers (${taskComments.length})
            </button>
            <button type="button" class="segmented-btn ${state.commentSubTab === "daily_entries" ? "active" : ""}" onclick="state.commentSubTab='daily_entries';render();">
              🕗 Daily Status Remarks (${dailyEntries.length})
            </button>
            ${
              isAdmin
                ? `<button type="button" class="segmented-btn ${state.commentSubTab === "email_reports" ? "active" : ""}" onclick="state.commentSubTab='email_reports';render();">
                    ✉ 8:00 PM Email Reports (${reports.length})
                  </button>`
                : ""
            }
          </div>
          ${
            isAdmin
              ? `<button type="button" class="btn-bw-primary btn-sm" onclick="trigger8PmEmailNow()">
                  ✉ Trigger 8:00 PM Cutoff & Email
                </button>`
              : ""
          }
        </div>

        ${
          state.commentSubTab === "task_comments"
            ? `
          <div class="table-scroll-container" tabindex="0" role="region" aria-label="All Jira Issue Comments">
            <table class="bw-table">
              <thead>
                <tr>
                  <th>Issue Key</th>
                  <th>Author</th>
                  <th>Comment / Blocker</th>
                  <th>Type</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${(taskComments.length ? taskComments : state.tasks.flatMap((t) => (t.comments || []).map((c) => ({ ...c, task_id: t.id, task_title: t.title }))))
                  .map(
                    (c) => `
                  <tr>
                    <td>
                      <span class="bw-badge bw-badge-solid">${esc(c.task_id)}</span>
                      <div style="font-size:var(--fs-2xs);margin-top:0.15rem;">${esc(c.task_title || "")}</div>
                    </td>
                    <td>
                      <div style="font-weight:700;">${esc(c.author_name)}</div>
                      <div style="font-size:var(--fs-2xs);color:var(--text-muted);">${esc(c.author_role)}</div>
                    </td>
                    <td>${esc(c.content)}</td>
                    <td>
                      ${
                        c.is_blocker || c.comment_type === "BLOCKER"
                          ? `<span class="bw-badge bw-badge-striped">⚠ BLOCKER</span>`
                          : `<span class="bw-badge bw-badge-outline">Remark</span>`
                      }
                    </td>
                    <td class="tabular-nums" style="font-size:var(--fs-2xs);">${esc(c.created_at)}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
            : state.commentSubTab === "daily_entries"
            ? `
          <div class="table-scroll-container" tabindex="0" role="region" aria-label="Daily Status Remarks">
            <table class="bw-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>8:00 PM Status</th>
                  <th>Daily Comments</th>
                  <th>Blockers</th>
                </tr>
              </thead>
              <tbody>
                ${dailyEntries
                  .map(
                    (e) => `
                  <tr>
                    <td style="font-weight:700;">${esc(e.full_name)}</td>
                    <td>${renderDailyStatusBadge(e.status)}</td>
                    <td>${e.status === "NA" ? "<strong>NA (Unsubmitted at 8:00 PM)</strong>" : esc(e.comments || "—")}</td>
                    <td>${esc(e.blockers || "None")}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
            : `
          <div style="display:flex;flex-direction:column;gap:0.85rem;">
            ${
              reports.length === 0
                ? `<p style="color:var(--text-muted);">No 8:00 PM email report triggered yet today. Click <strong>Trigger 8:00 PM Cutoff & Email</strong> above to generate and preview.</p>`
                : reports
                    .map(
                      (r) => `
                    <div class="glass-panel" style="padding:1rem;">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                        <div>
                          <strong style="font-size:var(--fs-md);">${esc(r.subject)}</strong>
                          <div style="font-size:var(--fs-2xs);color:var(--text-muted);">
                            Dispatched at ${esc(r.triggered_at_ist)} • Submitted: ${r.submitted_count} • Auto-NA: ${r.na_count}
                          </div>
                        </div>
                        <span class="bw-badge bw-badge-solid">${esc(r.dispatch_status)}</span>
                      </div>
                      <pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:var(--fs-2xs);padding:0.8rem;background:var(--glass-input);border-radius:var(--radius-sm);border:1px solid var(--glass-border);">${esc(r.text_body)}</pre>
                    </div>
                  `
                    )
                    .join("")
            }
          </div>
        `
        }
      </section>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   15. DIALOG MODALS: CREATE ISSUE, EXTEND TIMELINE, ISSUE COMMENTS, USER CRUD
   -------------------------------------------------------------------------- */

function openCreateTaskDialog() {
  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);">+ Create Jira Issue — CSR Design & Ops</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕ Close</button>
    </div>
    <form onsubmit="handleCreateTaskSubmit(event)">
      <div class="dialog-body">
        <div class="form-group">
          <label class="form-label" for="new-task-title">Issue Summary (Title)</label>
          <input id="new-task-title" type="text" class="glass-input" required autofocus placeholder="e.g. Design High-Contrast CSR Workflow Dashboard" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div class="form-group">
            <label class="form-label" for="new-task-assignee">Assignee</label>
            <select id="new-task-assignee" class="glass-select" required>
              ${state.users
                .map((u) => `<option value="${esc(u.id)}">${esc(u.full_name)} (${esc(u.department || u.role)})</option>`)
                .join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="new-task-due">Due Date (Deadline)</label>
            <input id="new-task-due" type="date" class="glass-input" value="${esc(state.systemInfo?.current_date_ist || "2026-10-30")}" required />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;">
          <div class="form-group">
            <label class="form-label" for="new-task-type">Issue Type</label>
            <select id="new-task-type" class="glass-select">
              <option value="DESIGN">▣ DESIGN</option>
              <option value="CSR">◈ CSR</option>
              <option value="WORKFLOW">⚙ WORKFLOW</option>
              <option value="REVIEW">◎ REVIEW</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="new-task-priority">Priority</label>
            <select id="new-task-priority" class="glass-select">
              <option value="HIGH">▲ HIGH</option>
              <option value="CRITICAL">‼ CRITICAL</option>
              <option value="MEDIUM">■ MEDIUM</option>
              <option value="LOW">▽ LOW</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="new-task-pts">Story Points</label>
            <input id="new-task-pts" type="number" min="1" max="21" value="5" class="glass-input" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="new-task-desc">Description & Acceptance Criteria</label>
          <textarea id="new-task-desc" class="glass-textarea" placeholder="Describe deliverables, acceptance criteria, and design specs..."></textarea>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn-bw-glass" onclick="closeDialog()">Cancel</button>
        <button type="submit" class="btn-bw-primary">✓ Create Issue</button>
      </div>
    </form>
  `);
}

async function handleCreateTaskSubmit(e) {
  e.preventDefault();
  try {
    const res = await apiFetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: document.getElementById("new-task-title").value.trim(),
        assignee_id: document.getElementById("new-task-assignee").value,
        due_date: document.getElementById("new-task-due").value,
        task_type: document.getElementById("new-task-type").value,
        priority: document.getElementById("new-task-priority").value,
        story_points: Number(document.getElementById("new-task-pts").value || 3),
        description: document.getElementById("new-task-desc").value.trim(),
      }),
    });
    if (res.task?.id) {
      state.selectedTaskId = res.task.id;
    }
    closeDialog();
    await refreshWorkspaceData();
    showToast("New Jira issue created!");
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openExtendTimelineDialog(taskId) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);">📅 Extend Timeline — ${esc(t.id)}</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕ Close</button>
    </div>
    <form onsubmit="handleExtendTimelineSubmit(event, '${esc(t.id)}')">
      <div class="dialog-body">
        <div style="font-weight:700;">${esc(t.title)}</div>
        <div style="font-size:var(--fs-xs);color:var(--text-muted);">
          Current Due Date: <strong>${esc(t.due_date)}</strong> (Original: ${esc(t.original_due_date || t.due_date)})
        </div>
        <div class="form-group">
          <label class="form-label" for="ext-new-date">New Extended Due Date</label>
          <input id="ext-new-date" type="date" class="glass-input" value="${esc(t.due_date)}" required autofocus />
        </div>
        <div class="form-group">
          <label class="form-label" for="ext-reason">Reason for Timeline Extension</label>
          <textarea id="ext-reason" class="glass-textarea" placeholder="Document why the deadline is being extended..." required></textarea>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn-bw-glass" onclick="closeDialog()">Cancel</button>
        <button type="submit" class="btn-bw-primary">✓ Save Extended Timeline</button>
      </div>
    </form>
  `);
}

async function handleExtendTimelineSubmit(e, taskId) {
  e.preventDefault();
  try {
    await apiFetch(`/api/tasks/${taskId}/extend-timeline`, {
      method: "POST",
      body: JSON.stringify({
        new_due_date: document.getElementById("ext-new-date").value,
        reason: document.getElementById("ext-reason").value.trim(),
      }),
    });
    closeDialog();
    await refreshWorkspaceData();
    showToast(`Timeline extended for ${taskId}`);
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openTaskDetailDialog(taskId) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const comments = t.comments || [];

  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <span class="bw-badge bw-badge-solid">${esc(t.id)}</span>
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);">${esc(t.title)}</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕ Close</button>
    </div>
    <div class="dialog-body">
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        ${renderStatusBadge(t.status)}
        ${renderPriorityBadge(t.priority)}
        <span class="bw-badge bw-badge-outline">👤 ${esc(t.assignee_name)}</span>
        <span class="bw-badge bw-badge-outline">📅 Due: ${esc(t.due_date)}</span>
      </div>
      <p style="font-size:var(--fs-sm);color:var(--text-secondary);">${esc(t.description || "No description provided.")}</p>

      <div style="border-top:1px solid var(--glass-divider);padding-top:0.75rem;">
        <h3 style="font-size:var(--fs-md);margin-bottom:0.5rem;">💬 Issue Comments & Blockers (${comments.length})</h3>
        <div style="display:flex;flex-direction:column;gap:0.45rem;max-height:200px;overflow-y:auto;">
          ${
            comments.length === 0
              ? `<div style="color:var(--text-muted);font-size:var(--fs-xs);">No comments yet. Add a status update or blocker below.</div>`
              : comments
                  .map(
                    (c) => `
                  <div class="glass-panel" style="padding:0.65rem;">
                    <div style="display:flex;justify-content:space-between;font-size:var(--fs-2xs);color:var(--text-muted);">
                      <strong>${esc(c.author_name)} (${esc(c.author_role)})</strong>
                      <span>${esc(c.created_at)}</span>
                    </div>
                    <div style="margin-top:0.25rem;font-weight:600;font-size:var(--fs-xs);">
                      ${c.is_blocker || c.comment_type === "BLOCKER" ? `<span class="bw-badge bw-badge-striped">⚠ BLOCKER</span> ` : ""}
                      ${esc(c.content)}
                    </div>
                  </div>
                `
                  )
                  .join("")
          }
        </div>
      </div>

      <form onsubmit="handleAddTaskComment(event, '${esc(t.id)}')" style="display:flex;flex-direction:column;gap:0.55rem;border-top:1px solid var(--glass-divider);padding-top:0.75rem;">
        <label class="form-label" for="task-comment-input">Add Comment, Remark or Blocker</label>
        <textarea id="task-comment-input" class="glass-textarea" placeholder="Write your update, remark, or blocker details..." required autofocus></textarea>
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
          <label style="display:flex;align-items:center;gap:0.4rem;font-weight:700;font-size:var(--fs-xs);cursor:pointer;">
            <input type="checkbox" id="task-comment-blocker" />
            ⚠ Flag this comment as an Active Blocker
          </label>
          <button type="submit" class="btn-bw-primary">Post Comment</button>
        </div>
      </form>
    </div>
  `);
}

async function handleAddTaskComment(e, taskId) {
  e.preventDefault();
  const isBlocker = document.getElementById("task-comment-blocker").checked;
  try {
    await apiFetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({
        content: document.getElementById("task-comment-input").value.trim(),
        is_blocker: isBlocker,
        comment_type: isBlocker ? "BLOCKER" : "REMARK",
      }),
    });
    await refreshWorkspaceData();
    showToast("Comment added!");
    openTaskDetailDialog(taskId);
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* --------------------------------------------------------------------------
   16. MANAGER ADMIN USER CRUD DIALOGS (ADD / EDIT / DELETE USER)
   -------------------------------------------------------------------------- */

function openCreateUserDialog() {
  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);">+ Add New Team Member</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕ Close</button>
    </div>
    <form onsubmit="handleCreateUserSubmit(event)">
      <div class="dialog-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div class="form-group">
            <label class="form-label" for="cu-fullname">Full Name</label>
            <input id="cu-fullname" type="text" class="glass-input" placeholder="e.g. Rohan Mehta" required autofocus />
          </div>
          <div class="form-group">
            <label class="form-label" for="cu-username">Username</label>
            <input id="cu-username" type="text" class="glass-input" placeholder="e.g. rohan" spellcheck="false" required />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div class="form-group">
            <label class="form-label" for="cu-email">Email Address</label>
            <input id="cu-email" type="email" class="glass-input" placeholder="rohan@csr-internal.local" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="cu-dept">Department</label>
            <input id="cu-dept" type="text" class="glass-input" value="DevOps & Cloud Engineering" required />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div class="form-group">
            <label class="form-label" for="cu-team">Assigned Team / Squad</label>
            <select id="cu-team" class="glass-select">
              ${state.teams.map(tm => `
                <option value="${esc(tm.id)}" ${tm.id === "TEAM-DEVOPS" ? "selected" : ""}>${esc(tm.name)}</option>
              `).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="cu-role">Access Role</label>
            <select id="cu-role" class="glass-select">
              <option value="User">User (Team Member)</option>
              <option value="Admin">Admin (Manager)</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="cu-password">Initial Password</label>
          <input id="cu-password" type="text" class="glass-input" value="User@123" required />
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn-bw-glass" onclick="closeDialog()">Cancel</button>
        <button type="submit" class="btn-bw-primary">✓ Create User</button>
      </div>
    </form>
  `);
}

async function handleCreateUserSubmit(e) {
  e.preventDefault();
  try {
    await apiFetch("/api/users", {
      method: "POST",
      body: JSON.stringify({
        full_name: document.getElementById("cu-fullname").value.trim(),
        username: document.getElementById("cu-username").value.trim(),
        email: document.getElementById("cu-email").value.trim(),
        department: document.getElementById("cu-dept").value.trim(),
        team_id: document.getElementById("cu-team") ? document.getElementById("cu-team").value : undefined,
        role: document.getElementById("cu-role").value,
        password: document.getElementById("cu-password").value,
      }),
    });
    closeDialog();
    await refreshWorkspaceData();
    showToast("User created successfully!");
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openEditUserDialog(userId) {
  const u = state.users.find((x) => x.id === userId);
  if (!u) return;
  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);">✎ Edit User — ${esc(u.full_name)}</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕ Close</button>
    </div>
    <form onsubmit="handleEditUserSubmit(event, '${esc(u.id)}')">
      <div class="dialog-body">
        <div class="form-group">
          <label class="form-label" for="eu-fullname">Full Name</label>
          <input id="eu-fullname" type="text" class="glass-input" value="${esc(u.full_name)}" required autofocus />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div class="form-group">
            <label class="form-label" for="eu-email">Email Address</label>
            <input id="eu-email" type="email" class="glass-input" value="${esc(u.email)}" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="eu-dept">Department</label>
            <input id="eu-dept" type="text" class="glass-input" value="${esc(u.department || "")}" required />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div class="form-group">
            <label class="form-label" for="eu-team">Assigned Team / Squad</label>
            <select id="eu-team" class="glass-select">
              <option value="">-- No Team --</option>
              ${state.teams.map(tm => `
                <option value="${esc(tm.id)}" ${tm.id === u.team_id ? "selected" : ""}>${esc(tm.name)}</option>
              `).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="eu-role">Role</label>
            <select id="eu-role" class="glass-select">
              <option value="User" ${!isAdminUser(u) ? "selected" : ""}>User (Team Member)</option>
              <option value="Admin" ${isAdminUser(u) ? "selected" : ""}>Admin (Manager)</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="eu-password">Reset Password (Optional)</label>
          <input id="eu-password" type="password" class="glass-input" placeholder="Leave blank to keep existing" />
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn-bw-glass" onclick="closeDialog()">Cancel</button>
        <button type="submit" class="btn-bw-primary">✓ Save User Changes</button>
      </div>
    </form>
  `);
}

async function handleEditUserSubmit(e, userId) {
  e.preventDefault();
  const payload = {
    full_name: document.getElementById("eu-fullname").value.trim(),
    email: document.getElementById("eu-email").value.trim(),
    department: document.getElementById("eu-dept").value.trim(),
    team_id: document.getElementById("eu-team") ? document.getElementById("eu-team").value : undefined,
    role: document.getElementById("eu-role").value,
  };
  const pwd = document.getElementById("eu-password").value;
  if (pwd && pwd.trim().length >= 6) {
    payload.password = pwd.trim();
  }
  try {
    await apiFetch(`/api/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    closeDialog();
    await refreshWorkspaceData();
    showToast("User updated successfully!");
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openDeleteUserConfirmDialog(userId, fullName) {
  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);">🗑 Delete User Account?</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕ Close</button>
    </div>
    <div class="dialog-body">
      <p style="font-size:var(--fs-sm);">
        Are you sure you want to permanently remove <strong>${esc(fullName)}</strong> from CSR Work Flow Manager?
      </p>
      <p style="font-size:var(--fs-xs);color:var(--text-muted);">
        Any tasks currently assigned to this user will remain in the project backlog.
      </p>
    </div>
    <div class="dialog-footer">
      <button type="button" class="btn-bw-glass" autofocus onclick="closeDialog()">Cancel</button>
      <button type="button" class="btn-bw-primary" onclick="confirmDeleteUser('${esc(userId)}')">
        🗑 Confirm Delete User
      </button>
    </div>
  `);
}

async function confirmDeleteUser(userId) {
  try {
    await apiFetch(`/api/users/${userId}`, { method: "DELETE" });
    closeDialog();
    await refreshWorkspaceData();
    showToast("User deleted.");
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* --------------------------------------------------------------------------
   17. TEAM & SQUAD CRUD DIALOGS
   -------------------------------------------------------------------------- */

function openCreateTeamDialog() {
  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);">+ Create New Team / Squad</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕ Close</button>
    </div>
    <form onsubmit="handleCreateTeamSubmit(event)">
      <div class="dialog-body">
        <div class="form-group">
          <label class="form-label" for="ct-name">Team Name</label>
          <input id="ct-name" type="text" class="glass-input" placeholder="e.g. DevOps Team, Platform SRE, Cloud Security" required autofocus />
        </div>
        <div class="form-group">
          <label class="form-label" for="ct-desc">Description</label>
          <textarea id="ct-desc" class="glass-textarea" rows="2" placeholder="Responsibilities and scope for this team..."></textarea>
        </div>
        <div class="form-group">
          <label class="form-label" for="ct-lead">Team Lead</label>
          <select id="ct-lead" class="glass-select">
            <option value="">-- Select Team Lead --</option>
            ${state.users.map(u => `
              <option value="${esc(u.id)}">${esc(u.full_name)} (@${esc(u.username)}) — ${esc(u.department || "")}</option>
            `).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Assign Team Members</label>
          <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border-input);border-radius:var(--radius-sm);padding:0.5rem;display:flex;flex-direction:column;gap:0.35rem;background:var(--bg-hover);">
            ${state.users.map(u => `
              <label style="display:flex;align-items:center;gap:0.45rem;font-size:var(--fs-xs);cursor:pointer;">
                <input type="checkbox" name="team-member-check" value="${esc(u.id)}" />
                <span>${esc(u.full_name)} (@${esc(u.username)}) • <small style="color:var(--text-muted);">${esc(u.designation || u.department || "")}</small></span>
              </label>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn-bw-glass" onclick="closeDialog()">Cancel</button>
        <button type="submit" class="btn-bw-primary">✓ Create Team</button>
      </div>
    </form>
  `);
}

async function handleCreateTeamSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("ct-name").value.trim();
  const description = document.getElementById("ct-desc").value.trim();
  const lead_id = document.getElementById("ct-lead").value || null;
  const memberCheckboxes = document.querySelectorAll('input[name="team-member-check"]:checked');
  const member_ids = Array.from(memberCheckboxes).map(cb => cb.value);

  try {
    await apiFetch("/api/teams", {
      method: "POST",
      body: JSON.stringify({ name, description, lead_id, member_ids }),
    });
    closeDialog();
    await refreshWorkspaceData();
    showToast(`Team '${name}' created successfully!`);
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openEditTeamDialog(teamId) {
  const tm = state.teams.find(t => t.id === teamId);
  if (!tm) return;
  const currentMembers = new Set(tm.member_ids || []);

  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);">✎ Edit Team — ${esc(tm.name)}</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕ Close</button>
    </div>
    <form onsubmit="handleEditTeamSubmit(event, '${esc(tm.id)}')">
      <div class="dialog-body">
        <div class="form-group">
          <label class="form-label" for="et-name">Team Name</label>
          <input id="et-name" type="text" class="glass-input" value="${esc(tm.name)}" required autofocus />
        </div>
        <div class="form-group">
          <label class="form-label" for="et-desc">Description</label>
          <textarea id="et-desc" class="glass-textarea" rows="2">${esc(tm.description || "")}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label" for="et-lead">Team Lead</label>
          <select id="et-lead" class="glass-select">
            <option value="">-- Select Team Lead --</option>
            ${state.users.map(u => `
              <option value="${esc(u.id)}" ${u.id === tm.lead_id ? "selected" : ""}>${esc(u.full_name)} (@${esc(u.username)})</option>
            `).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Team Members</label>
          <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border-input);border-radius:var(--radius-sm);padding:0.5rem;display:flex;flex-direction:column;gap:0.35rem;background:var(--bg-hover);">
            ${state.users.map(u => `
              <label style="display:flex;align-items:center;gap:0.45rem;font-size:var(--fs-xs);cursor:pointer;">
                <input type="checkbox" name="edit-team-member-check" value="${esc(u.id)}" ${currentMembers.has(u.id) ? "checked" : ""} />
                <span>${esc(u.full_name)} (@${esc(u.username)}) • <small style="color:var(--text-muted);">${esc(u.designation || u.department || "")}</small></span>
              </label>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn-bw-glass" onclick="closeDialog()">Cancel</button>
        <button type="submit" class="btn-bw-primary">✓ Save Team Changes</button>
      </div>
    </form>
  `);
}

async function handleEditTeamSubmit(e, teamId) {
  e.preventDefault();
  const name = document.getElementById("et-name").value.trim();
  const description = document.getElementById("et-desc").value.trim();
  const lead_id = document.getElementById("et-lead").value || null;
  const memberCheckboxes = document.querySelectorAll('input[name="edit-team-member-check"]:checked');
  const member_ids = Array.from(memberCheckboxes).map(cb => cb.value);

  try {
    await apiFetch(`/api/teams/${teamId}`, {
      method: "PUT",
      body: JSON.stringify({ name, description, lead_id, member_ids }),
    });
    closeDialog();
    await refreshWorkspaceData();
    showToast(`Team '${name}' updated successfully!`);
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openDeleteTeamConfirmDialog(teamId, teamName) {
  openDialog(`
    <div class="dialog-header">
      <div style="display:flex;align-items:center;gap:0.55rem;">
        ${renderTrafficLights()}
        <h2 id="csr-modal-title" style="font-size:var(--fs-lg);color:var(--notion-error);">🗑 Delete Team Confirmation</h2>
      </div>
      <button type="button" class="btn-bw-glass btn-sm" onclick="closeDialog()">✕</button>
    </div>
    <div class="dialog-body">
      <p style="font-size:var(--fs-sm);line-height:1.5;">
        Are you sure you want to delete the team <strong>"${esc(teamName)}"</strong>?
      </p>
      <p style="font-size:var(--fs-xs);color:var(--text-muted);margin-top:0.4rem;">
        Team members will not be deleted, but their association with this team will be cleared.
      </p>
    </div>
    <div class="dialog-footer">
      <button type="button" class="btn-bw-glass" onclick="closeDialog()">Cancel</button>
      <button type="button" class="btn-bw-danger" onclick="executeDeleteTeam('${esc(teamId)}')">Yes, Delete Team</button>
    </div>
  `);
}

async function executeDeleteTeam(teamId) {
  try {
    await apiFetch(`/api/teams/${teamId}`, { method: "DELETE" });
    closeDialog();
    if (state.selectedTeamFilter === teamId) {
      state.selectedTeamFilter = "ALL";
    }
    await refreshWorkspaceData();
    showToast("Team deleted successfully.");
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}


window.addEventListener("DOMContentLoaded", initApp);
