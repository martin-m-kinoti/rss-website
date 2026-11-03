// --- InsightNews Admin Console ---

const ADMIN_CATEGORIES = ["News", "Politics", "World", "Business", "Entertainment", "Sports", "Lifestyle", "Opinion", "Tech"];
const TOKEN_KEY = "insight_admin_token";

let adminToken = sessionStorage.getItem(TOKEN_KEY) || "";
let articlesCache = [];
let editingArticleId = null;

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("f-category");
  select.innerHTML = ADMIN_CATEGORIES.map(
    cat => `<option value="${cat}">${cat}</option>`
  ).join("");

  document.getElementById("f-image").addEventListener("input", (e) => {
    const preview = document.getElementById("f-image-preview");
    if (e.target.value) {
      preview.src = e.target.value;
      preview.classList.remove("hidden");
    } else {
      preview.classList.add("hidden");
    }
  });

  if (adminToken) {
    verifyToken(adminToken).then(ok => {
      if (ok) enterDashboard();
      else showLogin("Session expired. Please sign in again.");
    });
  } else {
    showLogin();
  }
});

// --- AUTH ---
async function verifyToken(token) {
  try {
    const res = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "x-admin-token": token }
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function login(event) {
  event.preventDefault();
  const errorEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");
  const token = document.getElementById("token-input").value.trim();

  errorEl.classList.add("hidden");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Checking...';

  if (await verifyToken(token)) {
    adminToken = token;
    sessionStorage.setItem(TOKEN_KEY, token);
    enterDashboard();
  } else {
    errorEl.textContent = "Invalid admin token. Check the ADMIN_TOKEN in your backend .env";
    errorEl.classList.remove("hidden");
  }

  btn.disabled = false;
  btn.innerHTML = "Sign In";
}

function logout() {
  adminToken = "";
  sessionStorage.removeItem(TOKEN_KEY);
  showLogin();
}

function showLogin(message) {
  document.getElementById("dashboard-view").classList.add("hidden");
  document.getElementById("logout-btn").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
  if (message) {
    const errorEl = document.getElementById("login-error");
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }
}

function enterDashboard() {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("dashboard-view").classList.remove("hidden");
  document.getElementById("logout-btn").classList.remove("hidden");
  loadArticlesList();
}

// --- API HELPER ---
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": adminToken
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// --- ARTICLES LIST ---
async function loadArticlesList() {
  const container = document.getElementById("articles-list");
  container.innerHTML = `
    <div class="text-center py-10 text-gray-400 text-sm">
      <i class="fas fa-circle-notch fa-spin text-2xl mb-2 block"></i>
      Loading articles...
    </div>
  `;
  try {
    articlesCache = await api("/api/articles");
    renderArticlesList();
  } catch (err) {
    container.innerHTML = `
      <div class="text-center py-10">
        <i class="fas fa-triangle-exclamation text-2xl text-red-500 mb-2 block"></i>
        <p class="text-sm text-gray-600 font-semibold">${escapeHtml(err.message)}</p>
        <button onclick="loadArticlesList()" class="mt-3 bg-red-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-red-700 transition">Retry</button>
      </div>
    `;
  }
}

function renderArticlesList() {
  const container = document.getElementById("articles-list");
  document.getElementById("list-count").textContent =
    `${articlesCache.length} article(s)`;

  if (articlesCache.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-gray-400 text-sm">
        <i class="far fa-newspaper text-3xl mb-2 block"></i>
        No articles yet. Create your first story using the form.
      </div>
    `;
    return;
  }

  container.innerHTML = articlesCache.map(art => `
    <div class="flex flex-col sm:flex-row gap-3 p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition">
      <img src="${art.image_url || ""}" alt="" onerror="this.style.display='none'"
        class="w-full sm:w-28 h-24 sm:h-auto object-cover rounded-md shrink-0 bg-gray-100">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[10px] font-extrabold text-red-600 uppercase tracking-wider bg-red-50 px-2 py-0.5 rounded">${escapeHtml(art.category)}</span>
          ${art.lead ? '<span class="text-[10px] font-bold text-amber-600 uppercase tracking-wider bg-amber-50 px-2 py-0.5 rounded"><i class="fas fa-star mr-0.5"></i> Lead</span>' : ""}
          ${art.featured ? '<span class="text-[10px] font-bold text-slate-600 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded">Featured</span>' : ""}
        </div>
        <h3 class="text-sm font-bold text-slate-900 leading-snug line-clamp-2">${escapeHtml(art.title)}</h3>
        <p class="text-[11px] text-gray-500 mt-1">
          <i class="far fa-user mr-1"></i>${escapeHtml(art.author || "Insight Desk")}
          <span class="mx-1">&bull;</span>
          <i class="far fa-clock mr-1"></i>${formatDate(art.created_at)}
          <span class="mx-1">&bull;</span>
          ID #${art.id}
        </p>
      </div>
      <div class="flex sm:flex-col gap-2 shrink-0 sm:w-24">
        <button onclick="editArticle(${art.id})"
          class="flex-1 bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-bold py-1.5 px-3 rounded-lg transition">
          <i class="fas fa-pen mr-1"></i> Edit
        </button>
        <button onclick="deleteArticle(${art.id})"
          class="flex-1 bg-white border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-bold py-1.5 px-3 rounded-lg transition">
          <i class="fas fa-trash mr-1"></i> Delete
        </button>
      </div>
    </div>
  `).join("");
}

// --- CREATE / EDIT / DELETE ---
async function submitArticle(event) {
  event.preventDefault();
  const msgEl = document.getElementById("form-msg");
  const btn = document.getElementById("submit-btn");

  const payload = {
    title: document.getElementById("f-title").value.trim(),
    category: document.getElementById("f-category").value,
    author: document.getElementById("f-author").value.trim() || "Insight Desk",
    summary: document.getElementById("f-summary").value.trim(),
    image_url: document.getElementById("f-image").value.trim() || null,
    content: document.getElementById("f-content").value,
    lead: document.getElementById("f-lead").checked,
    featured: document.getElementById("f-featured").checked
  };

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Saving...';

  try {
    if (editingArticleId) {
      await api(`/api/articles/${editingArticleId}`, { method: "PUT", body: payload });
      showFormMsg(`Article #${editingArticleId} updated successfully.`, false);
    } else {
      const created = await api("/api/articles", { method: "POST", body: payload });
      showFormMsg(`"${created.title}" published to the homepage.`, false);
    }
    resetForm();
    await loadArticlesList();
  } catch (err) {
    showFormMsg(err.message, true);
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Publish Article';
}

function editArticle(id) {
  const art = articlesCache.find(a => a.id === id);
  if (!art) return;

  editingArticleId = id;
  document.getElementById("f-title").value = art.title || "";
  document.getElementById("f-category").value = art.category || "News";
  document.getElementById("f-author").value = art.author || "";
  document.getElementById("f-summary").value = art.summary || "";
  document.getElementById("f-image").value = art.image_url || "";
  document.getElementById("f-image").dispatchEvent(new Event("input"));
  document.getElementById("f-content").value = art.content || "";
  document.getElementById("f-lead").checked = !!art.lead;
  document.getElementById("f-featured").checked = !!art.featured;

  document.getElementById("form-title").querySelector("span").textContent =
    `Edit Article #${id}`;
  document.getElementById("cancel-edit-btn").classList.remove("hidden");
  document.getElementById("form-msg").classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteArticle(id) {
  const art = articlesCache.find(a => a.id === id);
  const confirmed = confirm(
    `Delete "${art ? art.title : `Article #${id}`}"?\n\nThis permanently removes it from the homepage.`
  );
  if (!confirmed) return;

  try {
    await api(`/api/articles/${id}`, { method: "DELETE" });
    if (editingArticleId === id) resetForm();
    await loadArticlesList();
  } catch (err) {
    showFormMsg(err.message, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

// --- FORM HELPERS ---
function resetForm() {
  editingArticleId = null;
  document.getElementById("article-form").reset();
  document.getElementById("f-image-preview").classList.add("hidden");
  document.getElementById("form-title").querySelector("span").textContent =
    "Create New Article";
  document.getElementById("cancel-edit-btn").classList.add("hidden");
  document.getElementById("form-msg").classList.add("hidden");
}

function showFormMsg(message, isError) {
  const msgEl = document.getElementById("form-msg");
  msgEl.textContent = message;
  msgEl.className = `text-xs font-semibold rounded-lg px-3 py-2 ${
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
