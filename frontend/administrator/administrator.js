// --- Marial-LouNews Administrator Console ---

const WIRE_CATEGORIES = ["News", "Politics", "World", "Business", "Entertainment", "Sports", "Lifestyle", "Opinion"];
const ROLE_LABELS = { user: "Reader", editor: "Editor", administrator: "Administrator" };
const ROLE_BADGES = {
  user: "bg-slate-100 text-slate-600",
  editor: "bg-emerald-50 text-emerald-700",
  administrator: "bg-red-50 text-red-600"
};

let currentAccount = null;
let accountsCache = [];
let editingAccount = null;
let wireSourcesCache = [];

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("w-category").innerHTML = WIRE_CATEGORIES.map(
    cat => `<option value="${cat}">${cat}</option>`
  ).join("");

  const session = await loadSession();
  if (!session) return;

  currentAccount = session.account;
  setIdentity();
  loadAccounts();
  loadWireList();
});

function setIdentity() {
  const el = document.getElementById("admin-identity");
  document.getElementById("admin-identity-name").textContent =
    `${currentAccount.name || currentAccount.email} · Administrator`;
  el.classList.remove("hidden");
  el.classList.add("flex");
}

async function loadSession() {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      window.location.href = "/editor";
      return null;
    }
    const data = await res.json();
    if (data.role === "administrator") return data;

    window.location.href = data.role === "user"
      ? "/?access=staff-only"
      : "/editor?access=administrators-only";
    return null;
  } catch {
    window.location.href = "/editor";
    return null;
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Server unreachable; the cookie will expire on its own
  }
  window.location.href = "/editor";
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    window.location.href = "/editor";
    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// --- USER MANAGEMENT ---
function isSelf(account) {
  return account.role !== "user" && account.id === currentAccount.id;
}

async function loadAccounts() {
  const container = document.getElementById("accounts-list");
  container.innerHTML = `
    <div class="text-center py-10 text-gray-400 text-sm">
      <i class="fas fa-circle-notch fa-spin text-2xl mb-2 block"></i>
      Loading accounts...
    </div>
  `;
  try {
    accountsCache = await api("/api/admin/users");
    renderAccounts();
  } catch (err) {
    container.innerHTML = `
      <div class="text-center py-10">
        <i class="fas fa-triangle-exclamation text-2xl text-red-500 mb-2 block"></i>
        <p class="text-sm text-gray-600 font-semibold">${escapeHtml(err.message)}</p>
        <button onclick="loadAccounts()" class="mt-3 bg-red-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-red-700 transition">Retry</button>
      </div>
    `;
  }
}

function renderAccounts() {
  const container = document.getElementById("accounts-list");
  const tally = { administrator: 0, editor: 0, user: 0 };
  accountsCache.forEach(acc => { tally[acc.role] = (tally[acc.role] || 0) + 1; });
  document.getElementById("accounts-count").textContent =
    `${tally.administrator} admin · ${tally.editor} editor(s) · ${tally.user} reader(s)`;

  const filter = document.getElementById("u-filter").value;
  const rows = filter === "all" ? accountsCache : accountsCache.filter(acc => acc.role === filter);

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-gray-400 text-sm">
        <i class="far fa-user text-3xl mb-2 block"></i>
        No accounts in this view.
      </div>
    `;
    return;
  }

  container.innerHTML = rows.map(acc => {
    const self = isSelf(acc);
    return `
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-gray-300 transition">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="text-sm font-bold text-slate-900 truncate">${escapeHtml(acc.name || acc.email)}</h4>
            <span class="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded ${ROLE_BADGES[acc.role] || ROLE_BADGES.user}">${ROLE_LABELS[acc.role] || acc.role}</span>
            ${self ? '<span class="text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-white px-2 py-0.5 rounded">You</span>' : ""}
          </div>
          <p class="text-[11px] text-gray-500 truncate mt-0.5">
            <i class="far fa-envelope mr-1"></i>${escapeHtml(acc.email)}
            <span class="mx-1">&bull;</span>
            <i class="far fa-clock mr-1"></i>${formatDate(acc.created_at)}
          </p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button onclick="editAccount('${acc.role}', ${acc.id})"
            class="bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-bold py-1.5 px-3 rounded-lg transition">
            <i class="fas fa-pen mr-1"></i> Edit
          </button>
          <button onclick="deleteAccount('${acc.role}', ${acc.id})" ${self ? "disabled" : ""}
            title="${self ? "You cannot delete your own account" : "Delete account"}"
            class="bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold py-1.5 px-3 rounded-lg transition">
            <i class="fas fa-trash mr-1"></i> Delete
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function editAccount(role, id) {
  const account = accountsCache.find(acc => acc.role === role && acc.id === id);
  if (!account) return;

  editingAccount = account;
  document.getElementById("u-name").value = account.name || "";
  document.getElementById("u-email").value = account.email || "";

  const password = document.getElementById("u-password");
  password.value = "";
  password.required = false;
  password.placeholder = "Leave blank to keep the current password";
  document.getElementById("u-password-hint").textContent = "(leave blank to keep the current password)";

  const roleSelect = document.getElementById("u-role");
  roleSelect.value = account.role;
  roleSelect.disabled = isSelf(account);

  document.getElementById("account-form-title").textContent = `Edit ${account.name || account.email}`;
  document.getElementById("account-submit-btn").innerHTML = '<i class="fas fa-save mr-1"></i> Save Changes';
  document.getElementById("account-cancel-btn").classList.remove("hidden");
  document.getElementById("account-form-msg").classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetAccountForm() {
  editingAccount = null;
  document.getElementById("account-form").reset();

  const password = document.getElementById("u-password");
  password.required = true;
  password.placeholder = "Set a password";
  document.getElementById("u-password-hint").textContent = "(min 8 characters)";
  document.getElementById("u-role").disabled = false;

  document.getElementById("account-form-title").textContent = "Add an Account";
  document.getElementById("account-submit-btn").innerHTML = '<i class="fas fa-user-plus mr-1"></i> Create Account';
  document.getElementById("account-cancel-btn").classList.add("hidden");
  document.getElementById("account-form-msg").classList.add("hidden");
}

async function submitAccount(event) {
  event.preventDefault();
  const btn = document.getElementById("account-submit-btn");
  const edited = editingAccount;

  const name = document.getElementById("u-name").value.trim();
  const email = document.getElementById("u-email").value.trim();
  const password = document.getElementById("u-password").value;
  const role = document.getElementById("u-role").value;

  const payload = { name, email, role };
  if (password) payload.password = password;

  if (edited && role !== edited.role) {
    const note = role === "user"
      ? "Their stories stay on the site, but only administrators will be able to edit them."
      : "They get newsroom access with this email and password.";
    if (!confirm(`Change ${edited.name || edited.email} from ${ROLE_LABELS[edited.role]} to ${ROLE_LABELS[role]}?\n\n${note}`)) {
      return;
    }
  }

  btn.disabled = true;
  try {
    let saved;
    if (edited) {
      saved = await api(`/api/admin/users/${edited.id}?role=${edited.role}`, { method: "PUT", body: payload });
    } else {
      saved = await api("/api/admin/users", { method: "POST", body: payload });
    }

    const wasSelf = edited && isSelf(edited);
    resetAccountForm();
    if (wasSelf) {
      currentAccount = { ...currentAccount, ...saved };
      setIdentity();
    }
    showAccountMsg(
      edited ? `${saved.name || saved.email} updated.` : `${saved.name || saved.email} added as ${ROLE_LABELS[role]}.`,
      false
    );
    await loadAccounts();
  } catch (err) {
    showAccountMsg(err.message, true);
  }

  btn.disabled = false;
}

async function deleteAccount(role, id) {
  const account = accountsCache.find(acc => acc.role === role && acc.id === id);
  if (!account) return;

  const note = role === "user"
    ? "They will no longer be able to sign in."
    : "Their stories stay on the site and become editable by administrators only.";
  if (!confirm(`Delete ${account.name || account.email} (${ROLE_LABELS[role]})?\n\n${note}`)) return;

  try {
    await api(`/api/admin/users/${id}?role=${role}`, { method: "DELETE" });
    if (editingAccount && editingAccount.id === id && editingAccount.role === role) resetAccountForm();
    showAccountMsg(`${account.name || account.email} deleted.`, false);
    await loadAccounts();
  } catch (err) {
    showAccountMsg(err.message, true);
  }
}

function showAccountMsg(message, isError) {
  const el = document.getElementById("account-form-msg");
  el.textContent = message;
  el.className = `text-xs font-semibold rounded-lg px-3 py-2 ${
    isError
      ? "bg-red-50 text-red-700 border border-red-200"
      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
  }`;
}

// --- WIRE SOURCES (RSS INGEST FROM PARTNER SITES) ---
async function loadWireList() {
  const container = document.getElementById("wire-list");
  container.innerHTML = `
    <div class="text-center py-10 text-gray-400 text-sm">
      <i class="fas fa-circle-notch fa-spin text-2xl mb-2 block"></i>
      Loading feeds...
    </div>
  `;
  try {
    wireSourcesCache = await api("/api/admin/rss/sources");
    renderWireList();
  } catch (err) {
    container.innerHTML = `
      <div class="text-center py-10">
        <i class="fas fa-triangle-exclamation text-2xl text-red-500 mb-2 block"></i>
        <p class="text-sm text-gray-600 font-semibold">${escapeHtml(err.message)}</p>
        <button onclick="loadWireList()" class="mt-3 bg-red-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-red-700 transition">Retry</button>
      </div>
    `;
  }
}

function renderWireList() {
  const container = document.getElementById("wire-list");
  document.getElementById("wire-status").textContent = `${wireSourcesCache.length} feed(s)`;

  if (wireSourcesCache.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-gray-400 text-sm">
        <i class="fas fa-satellite-dish text-3xl mb-2 block"></i>
        No partner feeds yet. Add one to start pulling headlines.
      </div>
    `;
    return;
  }

  container.innerHTML = wireSourcesCache.map(s => `
    <div class="p-3 border ${s.active ? "border-gray-200" : "border-gray-200 bg-gray-50 opacity-70"} rounded-lg">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            <h4 class="text-sm font-bold text-slate-900">${escapeHtml(s.name)}</h4>
            <span class="text-[10px] font-extrabold text-red-600 uppercase tracking-wider bg-red-50 px-2 py-0.5 rounded">${escapeHtml(s.category)}</span>
            ${s.active
              ? '<span class="text-[10px] font-bold text-emerald-700 uppercase tracking-wider bg-emerald-50 px-2 py-0.5 rounded">Active</span>'
              : '<span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-200 px-2 py-0.5 rounded">Paused</span>'}
          </div>
          <p class="text-[11px] font-mono text-gray-500 truncate" title="${escapeHtml(s.feed_url)}">${escapeHtml(s.feed_url)}</p>
          <p class="text-[11px] text-gray-500 mt-1">
            <i class="far fa-file-alt mr-1"></i>${s.article_count} stored
            <span class="mx-1">&bull;</span>
            <i class="far fa-clock mr-1"></i>${formatDateTime(s.last_fetched_at)}
          </p>
          ${s.last_error ? `<p class="text-[11px] font-semibold text-red-600 mt-1"><i class="fas fa-exclamation-circle mr-1"></i>${escapeHtml(s.last_error)}</p>` : ""}
        </div>
        <div class="flex flex-col gap-1.5 shrink-0 w-28">
          <button onclick="fetchWireSource(${s.id}, this)"
            class="bg-slate-900 hover:bg-slate-700 disabled:opacity-50 text-white text-[11px] font-bold py-1.5 px-2 rounded-lg transition">
            <i class="fas fa-rotate mr-1"></i> Fetch
          </button>
          <button onclick="toggleWireSource(${s.id}, ${!s.active})"
            class="bg-white border ${s.active ? "border-amber-300 text-amber-700 hover:bg-amber-50" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"} text-[11px] font-bold py-1.5 px-2 rounded-lg transition">
            ${s.active ? "Pause" : "Resume"}
          </button>
          <button onclick="deleteWireSource(${s.id})"
            class="bg-white border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-bold py-1.5 px-2 rounded-lg transition">
            <i class="fas fa-trash mr-1"></i> Delete
          </button>
        </div>
      </div>
    </div>
  `).join("");
}

async function submitWireSource(event) {
  event.preventDefault();
  const btn = document.getElementById("wire-submit-btn");
  const payload = {
    name: document.getElementById("w-name").value.trim(),
    feed_url: document.getElementById("w-feed").value.trim(),
    site_url: document.getElementById("w-site").value.trim(),
    category: document.getElementById("w-category").value
  };

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Adding & fetching...';

  try {
    const res = await api("/api/admin/rss/sources", { method: "POST", body: payload });
    const fetched = res.fetch?.error
      ? `Feed saved, but the first fetch failed: ${res.fetch.error}`
      : `Feed saved and ${res.fetch?.items ?? 0} headline(s) pulled in.`;
    showWireMsg(fetched, !!res.fetch?.error);
    document.getElementById("wire-form").reset();
    await loadWireList();
  } catch (err) {
    showWireMsg(err.message, true);
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-plus mr-1"></i> Add & Fetch Feed';
}

async function fetchWireSource(id, btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Fetching';
  }
  try {
    const result = await api(`/api/admin/rss/sources/${id}/ingest`, { method: "POST" });
    showWireMsg(
      result.error ? `${result.name}: fetch failed - ${result.error}` : `${result.name}: ${result.items} headline(s) processed.`,
      !!result.error
    );
    await loadWireList();
  } catch (err) {
    showWireMsg(err.message, true);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-rotate mr-1"></i> Fetch';
    }
  }
}

async function toggleWireSource(id, active) {
  try {
    await api(`/api/admin/rss/sources/${id}`, { method: "PUT", body: { active } });
    await loadWireList();
  } catch (err) {
    showWireMsg(err.message, true);
  }
}

async function deleteWireSource(id) {
  const source = wireSourcesCache.find(s => s.id === id);
  const confirmed = confirm(
    `Remove "${source ? source.name : `Feed #${id}`}"?\n\n` +
    `This also deletes its ${source ? source.article_count : 0} stored headline(s). Headlines already written up as MLN articles are not affected.`
  );
  if (!confirmed) return;

  try {
    await api(`/api/admin/rss/sources/${id}`, { method: "DELETE" });
    await loadWireList();
  } catch (err) {
    showWireMsg(err.message, true);
  }
}

async function ingestAllWire() {
  const btn = document.getElementById("wire-ingest-btn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Fetching...';

  try {
    const summary = await api("/api/admin/rss/ingest", { method: "POST" });
    const failed = summary.failed ? `, ${summary.failed} failed` : "";
    showWireMsg(`Fetched ${summary.items} headline(s) from ${summary.sources} feed(s)${failed}.`, !!summary.failed);
    await loadWireList();
  } catch (err) {
    showWireMsg(err.message, true);
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-rotate mr-1"></i> Fetch All Now';
}

function showWireMsg(message, isError) {
  const el = document.getElementById("wire-form-msg");
  el.textContent = message;
  el.className = `text-xs font-semibold rounded-lg px-3 py-2 ${
    isError
      ? "bg-red-50 text-red-700 border border-red-200"
      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
  }`;
}

// --- UTILS ---
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });
}

function formatDateTime(iso) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
}