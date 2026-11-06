tailwind.config = {
    theme: {
    extend: {
        fontFamily: {
        sans: ['Inter', 'sans-serif'],
        },
        colors: {
        brand: {
            red: '#DC2626',
            darkRed: '#B91C1C',
            navy: '#0F172A',
            slate: '#1E293B'
        }
        }
    }
    }
}

// --- DATABASE / STATE ---
const CATEGORIES = ["Home", "News", "Politics", "World", "Business", "Entertainment", "Sports", "Lifestyle", "Opinion"];

let ARTICLES = [];
let articlesState = "loading"; // loading | ready | error

const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=800&q=80";

// Broken or non-image URLs fall back to the default newsroom image instead of
// showing a broken-image icon.
function attachImageFallback(img) {
  img.onerror = () => {
    img.onerror = null;
    img.src = FALLBACK_IMAGE;
  };
}

function normalizeArticle(row) {
  const plainText = (row.content || "").replace(/<[^>]*>/g, " ");
  const words = plainText.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  const date = row.created_at ? new Date(row.created_at) : null;
  return {
    ...row,
    image: row.image_url || FALLBACK_IMAGE,
    readTime: `${minutes} min read`,
    date: date
      ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : ""
  };
}

async function loadArticles() {
  articlesState = "loading";
  renderApp();
  try {
    const res = await fetch("/api/articles");
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);
    const rows = await res.json();
    ARTICLES = Array.isArray(rows) ? rows.map(normalizeArticle) : [];
    articlesState = "ready";
  } catch (err) {
    console.error("Failed to load articles:", err);
    articlesState = "error";
  }
  renderApp();
  renderMostRead();
  renderTicker();
}

function renderTicker() {
  const ticker = document.getElementById("ticker");
  const text = document.getElementById("ticker-text");
  if (!ticker || !text) return;

  if (articlesState === "ready" && ARTICLES.length > 0) {
    ticker.classList.remove("hidden");
    text.textContent = ARTICLES.slice(0, 2).map(art => art.title).join(" • ");
  } else if (articlesState === "error") {
    ticker.classList.remove("hidden");
    text.textContent = "Headlines unavailable right now";
  } else if (articlesState === "ready") {
    ticker.classList.add("hidden");
  }
}

let currentCategory = "Home";
let searchQuery = "";
let savedArticleIds = JSON.parse(localStorage.getItem("mln_saved_articles") || "[]");
let activeModalArticleId = null;

// --- INITIALIZATION ---
window.onload = async function() {
  // Set Current Date
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
  document.getElementById('current-date').innerHTML = `<i class="far fa-calendar-alt mr-1"></i> ${now.toLocaleDateString('en-US', options)}`;

  // Render App Components
  renderCategoryNav();
  renderApp();
  updateSavedCount();

  // Restore session (editor or reader) and apply navigation controls
  await loadCurrentUser();
  checkAccessNotice();

  // Fetch articles from the backend, then render
  await loadArticles();

  // Partner wire feed (ingested headlines)
  await loadWireSources();
  refreshWire();
};

// --- RENDER LOGIC ---
function renderCategoryNav() {
  const nav = document.getElementById('category-nav');
  nav.innerHTML = CATEGORIES.map(cat => {
    const isActive = cat === currentCategory;
    const activeClasses = isActive 
      ? "bg-red-600 text-white font-bold" 
      : "text-slate-300 hover:text-white hover:bg-slate-800";
    return `
      <button onclick="filterByCategory('${cat}')" class="px-3 py-1.5 rounded-md transition ${activeClasses}">
        ${cat}
      </button>
    `;
  }).join('');
}

function renderApp() {
  const filterBanner = document.getElementById('filter-banner');
  const heroSection = document.getElementById('hero-section');
  const feedTitle = document.getElementById('feed-title');
  const feedContainer = document.getElementById('articles-feed');
  const noResults = document.getElementById('no-results');

  // Loading state
  if (articlesState === "loading") {
    filterBanner.classList.add('hidden');
    heroSection.classList.add('hidden');
    feedTitle.textContent = "Latest Kenyan News";
    document.getElementById('feed-count').textContent = "";
    noResults.classList.add('hidden');
    feedContainer.innerHTML = `
      <div class="bg-white p-10 rounded-xl shadow-sm border border-gray-200 text-center">
        <i class="fas fa-circle-notch fa-spin text-4xl text-red-600 mb-3"></i>
        <h3 class="text-base font-bold text-gray-700">Loading today's headlines...</h3>
        <p class="text-xs text-gray-500 mt-1">Fetching the latest stories from the newsroom.</p>
      </div>
    `;
    return;
  }

  // Error state
  if (articlesState === "error") {
    filterBanner.classList.add('hidden');
    heroSection.classList.add('hidden');
    feedTitle.textContent = "Latest Kenyan News";
    document.getElementById('feed-count').textContent = "";
    noResults.classList.add('hidden');
    feedContainer.innerHTML = `
      <div class="bg-white p-10 rounded-xl shadow-sm border border-gray-200 text-center">
        <i class="fas fa-triangle-exclamation text-4xl text-red-600 mb-3"></i>
        <h3 class="text-base font-bold text-gray-700">Could not load articles</h3>
        <p class="text-xs text-gray-500 mt-1">The news server is unreachable right now. Please try again.</p>
        <button onclick="loadArticles()" class="mt-4 bg-red-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-red-700 transition">
          Retry
        </button>
      </div>
    `;
    return;
  }

  // Filter Articles
  let filtered = ARTICLES.filter(art => {
    const matchesCategory = currentCategory === "Home" || art.category === currentCategory;
    const matchesSearch = searchQuery === "" ||
      art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      art.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      art.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Update Filter Banner State
  if (currentCategory !== "Home" || searchQuery !== "") {
    filterBanner.classList.remove('hidden');
    document.getElementById('filter-label').textContent = searchQuery
      ? `"${searchQuery}" in ${currentCategory}`
      : currentCategory;
    heroSection.classList.add('hidden'); // Hide hero grid when searching/filtering specific categories
    feedTitle.textContent = `${currentCategory} Headlines`;
  } else {
    filterBanner.classList.add('hidden');
    if (ARTICLES.length > 0) {
      heroSection.classList.remove('hidden');
      feedTitle.textContent = "Latest Kenyan News";
      renderHeroGrid();
    } else {
      heroSection.classList.add('hidden');
    }
  }

  // Render Articles List Feed
  document.getElementById('feed-count').textContent = `Showing ${filtered.length} article(s)`;

  if (filtered.length === 0) {
    feedContainer.innerHTML = '';
    noResults.classList.remove('hidden');
  } else {
    noResults.classList.add('hidden');
    feedContainer.innerHTML = filtered.map(art => {
      const isSaved = savedArticleIds.includes(art.id);
      return `
        <article class="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition flex flex-col sm:flex-row gap-4 group">
          <img src="${art.image}" alt="${art.title}" onerror="this.onerror=null; this.src='${FALLBACK_IMAGE}'" class="w-full sm:w-48 h-36 object-cover rounded-lg shrink-0 group-hover:brightness-95 transition">
          <div class="flex-1 flex flex-col justify-between">
            <div>
              <div class="flex justify-between items-center mb-1.5">
                <span class="text-[11px] font-extrabold text-red-600 uppercase tracking-wider bg-red-50 px-2 py-0.5 rounded">
                  ${art.category}
                </span>
                <button onclick="toggleSaveArticle(event, ${art.id})" class="text-gray-400 hover:text-red-600 text-sm transition" title="${isSaved ? 'Remove Bookmark' : 'Save Article'}">
                  <i class="${isSaved ? 'fas text-red-600' : 'far'} fa-bookmark"></i>
                </button>
              </div>
              <h3 onclick="openArticleModal(${art.id})" class="text-base md:text-lg font-bold text-slate-900 group-hover:text-red-600 cursor-pointer transition line-clamp-2 leading-snug">
                ${art.title}
              </h3>
              <p class="text-gray-600 text-xs md:text-sm mt-1.5 line-clamp-2 leading-relaxed">
                ${art.summary}
              </p>
            </div>
            <div class="flex items-center justify-between text-[11px] text-gray-400 mt-3 pt-2 border-t border-gray-100">
              <span class="font-medium text-slate-600"><i class="far fa-user mr-1"></i> ${art.author}</span>
              <div class="space-x-3">
                <span><i class="far fa-clock mr-1"></i> ${art.readTime}</span>
                <span>${art.date}</span>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }
}

function renderHeroGrid() {
  const lead = ARTICLES.find(a => a.lead) || ARTICLES[0];
  const subs = ARTICLES.filter(a => a.id !== lead.id).slice(0, 3);

  // Render Lead
  const heroImg = document.getElementById('hero-lead-img');
  attachImageFallback(heroImg);
  heroImg.src = lead.image;
  document.getElementById('hero-lead-cat').textContent = lead.category;
  document.getElementById('hero-lead-title').textContent = lead.title;
  document.getElementById('hero-lead-desc').textContent = lead.summary;
  document.getElementById('hero-lead-author').textContent = lead.author;
  document.getElementById('hero-lead-time').textContent = lead.date;
  document.getElementById('hero-lead-card').onclick = () => openArticleModal(lead.id);

  // Render Sub-Featured Cards
  const subGrid = document.getElementById('hero-sub-grid');
  subGrid.innerHTML = subs.map(art => `
    <article onclick="openArticleModal(${art.id})" class="flex bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition cursor-pointer group h-[120px]">
      <img src="${art.image}" onerror="this.onerror=null; this.src='${FALLBACK_IMAGE}'" class="w-28 sm:w-32 h-full object-cover group-hover:scale-105 transition duration-300" alt="Thumbnail">
      <div class="p-3 flex flex-col justify-between flex-1">
        <div>
          <span class="text-[10px] font-extrabold text-red-600 uppercase tracking-wider">${art.category}</span>
          <h2 class="text-xs font-bold text-slate-900 group-hover:text-red-600 transition line-clamp-2 mt-0.5 leading-snug">
            ${art.title}
          </h2>
        </div>
        <div class="text-[10px] text-gray-400 flex justify-between items-center">
          <span>${art.date}</span>
          <span class="text-red-600 font-semibold group-hover:underline">Read →</span>
        </div>
      </div>
    </article>
  `).join('');
}

function renderMostRead() {
  const mostReadContainer = document.getElementById('most-read-list');
  const popular = ARTICLES.slice(0, 4); // Pick first 4 for mock popular list
  mostReadContainer.innerHTML = popular.map((art, index) => `
    <div onclick="openArticleModal(${art.id})" class="flex items-start space-x-3 cursor-pointer group">
      <span class="text-2xl font-black text-slate-300 group-hover:text-red-600 transition w-6 shrink-0">0${index + 1}</span>
      <div>
        <span class="text-[10px] font-bold text-red-600 uppercase tracking-wider">${art.category}</span>
        <h4 class="text-xs font-bold text-slate-800 group-hover:text-red-600 transition line-clamp-2 leading-snug">
          ${art.title}
        </h4>
      </div>
    </div>
  `).join('');
}

// --- WIRE FEED (articles ingested from partner news sites) ---
// Kept out of ARTICLES on purpose: wire items have no body content and their ids
// come from a different table, so they link out instead of opening the modal.
const WIRE_PAGE_SIZE = 8;

const WIRE = {
  items: [],
  sources: [],
  state: "loading", // loading | ready | error
  page: 1,
  total: 0,
  sourceId: 0 // 0 = all sources
};

let wireRequestToken = 0;
let wireSearchTimer = null;

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wireTimeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function wireQueryString(page) {
  const params = new URLSearchParams({ limit: WIRE_PAGE_SIZE, page });
  if (WIRE.sourceId) params.set("source", WIRE.sourceId);
  if (currentCategory !== "Home") params.set("category", currentCategory);
  if (searchQuery) params.set("q", searchQuery);
  return params.toString();
}

async function loadWireSources() {
  try {
    const res = await fetch("/api/rss/sources");
    WIRE.sources = res.ok ? await res.json() : [];
  } catch {
    WIRE.sources = [];
  }
  renderWireSources();
}

async function loadWirePage() {
  const token = ++wireRequestToken;
  WIRE.state = "loading";
  renderWireFeed();

  try {
    const res = await fetch(`/api/rss?${wireQueryString(WIRE.page)}`);
    if (!res.ok) throw new Error(`Wire API responded with status ${res.status}`);
    const data = await res.json();
    if (token !== wireRequestToken) return; // superseded by a newer request

    WIRE.items = WIRE.page === 1 ? data.articles : WIRE.items.concat(data.articles);
    WIRE.total = data.total;
    WIRE.state = "ready";
  } catch (err) {
    if (token !== wireRequestToken) return;
    console.error("Failed to load wire articles:", err);
    WIRE.state = "error";
  }
  renderWireFeed();
}

function refreshWire() {
  WIRE.page = 1;
  return loadWirePage();
}

function loadMoreWire() {
  WIRE.page++;
  return loadWirePage();
}

function scheduleWireRefresh() {
  clearTimeout(wireSearchTimer);
  wireSearchTimer = setTimeout(refreshWire, 350);
}

function filterWireSource(sourceId) {
  WIRE.sourceId = sourceId;
  renderWireSources();
  refreshWire();
}

function renderWireSources() {
  const container = document.getElementById("wire-sources");
  if (!container) return;

  const chips = [
    { id: 0, name: "All Sources" },
    ...WIRE.sources.map(s => ({ id: s.id, name: s.name }))
  ];

  container.innerHTML = chips.map(chip => {
    const isActive = chip.id === WIRE.sourceId;
    const activeClasses = isActive
      ? "bg-slate-900 text-white font-bold"
      : "text-slate-600 hover:bg-slate-100 border border-gray-200";
    return `
      <button onclick="filterWireSource(${chip.id})" class="px-3 py-1 rounded-full text-[11px] transition ${activeClasses}">
        ${escapeHtml(chip.name)}
      </button>
    `;
  }).join("");
}

function renderWireFeed() {
  const feed = document.getElementById("wire-feed");
  const more = document.getElementById("wire-more");
  if (!feed) return;

  if (WIRE.state === "loading" && WIRE.items.length === 0) {
    feed.innerHTML = `
      <div class="sm:col-span-2 text-center py-8 text-gray-400 text-xs">
        <i class="fas fa-circle-notch fa-spin text-2xl mb-2 block"></i>
        Pulling in partner headlines...
      </div>
    `;
    more.innerHTML = "";
    return;
  }

  if (WIRE.state === "error") {
    feed.innerHTML = `
      <div class="sm:col-span-2 text-center py-8">
        <i class="fas fa-triangle-exclamation text-2xl text-red-500 mb-2 block"></i>
        <p class="text-xs text-gray-500">The wire feed is unavailable right now.</p>
        <button onclick="refreshWire()" class="mt-3 bg-slate-900 text-white text-xs px-4 py-2 rounded-lg hover:bg-slate-700 transition">
          Retry
        </button>
      </div>
    `;
    more.innerHTML = "";
    return;
  }

  if (WIRE.items.length === 0) {
    feed.innerHTML = `
      <div class="sm:col-span-2 text-center py-8 text-gray-400 text-xs">
        <i class="fas fa-satellite-dish text-2xl mb-2 block"></i>
        No partner headlines match this filter yet.
      </div>
    `;
    more.innerHTML = "";
    return;
  }

  feed.innerHTML = WIRE.items.map(art => {
    const image = art.image_url || FALLBACK_IMAGE;
    return `
      <article class="border border-gray-200 rounded-lg p-3 hover:shadow-md transition flex gap-3">
        <img src="${escapeHtml(image)}" alt="" loading="lazy"
          onerror="this.onerror=null; this.src='${FALLBACK_IMAGE}'"
          class="w-24 h-20 object-cover rounded-md shrink-0">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] font-extrabold text-red-600 uppercase tracking-wider bg-red-50 px-2 py-0.5 rounded">
              ${escapeHtml(art.category)}
            </span>
            <span class="text-[10px] text-gray-400 truncate">${escapeHtml(wireTimeAgo(art.published_at))}</span>
          </div>
          <h3 class="text-sm font-bold text-slate-900 leading-snug line-clamp-2">
            <a href="${escapeHtml(art.url)}" target="_blank" rel="noopener noreferrer" class="hover:text-red-600 transition">
              ${escapeHtml(art.title)}
            </a>
          </h3>
          <p class="text-[11px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">${escapeHtml(art.summary || "")}</p>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <span class="text-[10px] font-semibold text-slate-600 truncate">
              <i class="fas fa-broadcast-tower mr-1 text-gray-400"></i>${escapeHtml(art.source_name)}
            </span>
            <a href="${escapeHtml(art.url)}" target="_blank" rel="noopener noreferrer"
              class="text-[10px] font-bold text-red-600 hover:text-red-800 shrink-0 ml-2">
              Read at ${escapeHtml(art.source_name)} <i class="fas fa-external-link-alt ml-0.5"></i>
            </a>
          </div>
        </div>
      </article>
    `;
  }).join("");

  const remaining = WIRE.total - WIRE.items.length;
  more.innerHTML = remaining > 0
    ? `<button onclick="loadMoreWire()" class="bg-white border border-gray-300 text-slate-700 hover:bg-gray-50 text-xs font-bold px-4 py-2 rounded-lg transition">
         Load ${Math.min(remaining, WIRE_PAGE_SIZE)} more of ${WIRE.total} wire story(ies)
       </button>`
    : `<p class="text-[11px] text-gray-400">All ${WIRE.total} wire story(ies) shown. Headlines link to the publishing source.</p>`;
}

// --- INTERACTION & EVENT HANDLERS ---
function filterByCategory(cat) {
  currentCategory = cat;
  renderCategoryNav();
  renderApp();
  refreshWire();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-search');
  searchQuery = input.value.trim();
  
  if (searchQuery.length > 0) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }
  renderApp();
  scheduleWireRefresh();
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('clear-search').classList.add('hidden');
  searchQuery = '';
  renderApp();
  refreshWire();
}

function resetFilters() {
  currentCategory = 'Home';
  clearSearch();
  renderCategoryNav();
}

// Article Modal Functions
function openArticleModal(articleId) {
  const article = ARTICLES.find(a => a.id === articleId);
  if (!article) return;

  activeModalArticleId = article.id;
  document.getElementById('modal-category').textContent = article.category;
  document.getElementById('modal-title').textContent = article.title;
  document.getElementById('modal-author').textContent = `By ${article.author}`;
  document.getElementById('modal-date').textContent = article.date;
  document.getElementById('modal-readtime').textContent = article.readTime;
  const modalImg = document.getElementById('modal-image');
  attachImageFallback(modalImg);
  modalImg.src = article.image;
  document.getElementById('modal-content').innerHTML = article.content || `<p>${article.summary}</p>`;

  updateModalSaveButtonState();
  document.getElementById('article-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function closeArticleModal() {
  document.getElementById('article-modal').classList.add('hidden');
  document.body.style.overflow = 'auto';
  activeModalArticleId = null;
}

function toggleSaveCurrentModalArticle() {
  if (!activeModalArticleId) return;
  const index = savedArticleIds.indexOf(activeModalArticleId);
  if (index > -1) {
    savedArticleIds.splice(index, 1);
  } else {
    savedArticleIds.push(activeModalArticleId);
  }
  localStorage.setItem("mln_saved_articles", JSON.stringify(savedArticleIds));
  updateSavedCount();
  updateModalSaveButtonState();
  renderApp();
}

function updateModalSaveButtonState() {
  const btn = document.getElementById('modal-save-btn');
  const isSaved = savedArticleIds.includes(activeModalArticleId);
  btn.innerHTML = `<i class="${isSaved ? 'fas text-red-600' : 'far'} fa-bookmark"></i>`;
}

function toggleSaveArticle(event, articleId) {
  event.stopPropagation();
  const index = savedArticleIds.indexOf(articleId);
  if (index > -1) {
    savedArticleIds.splice(index, 1);
  } else {
    savedArticleIds.push(articleId);
  }
  localStorage.setItem("mln_saved_articles", JSON.stringify(savedArticleIds));
  updateSavedCount();
  renderApp();
}

function updateSavedCount() {
  document.getElementById('saved-count').textContent = savedArticleIds.length;
}

function toggleSavedArticlesModal() {
  const modal = document.getElementById('saved-modal');
  const list = document.getElementById('saved-articles-list');

  if (modal.classList.contains('hidden')) {
    const savedArticles = ARTICLES.filter(a => savedArticleIds.includes(a.id));
    if (savedArticles.length === 0) {
      list.innerHTML = `
        <div class="text-center py-8 text-gray-500 text-xs">
          <i class="far fa-bookmark text-3xl text-gray-300 mb-2 block"></i>
          No saved articles yet. Click the bookmark icon on any news story to save it for later.
        </div>
      `;
    } else {
      list.innerHTML = savedArticles.map(art => `
        <div class="flex justify-between items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
          <div class="cursor-pointer" onclick="toggleSavedArticlesModal(); openArticleModal(${art.id})">
            <span class="text-[10px] font-bold text-red-600 uppercase">${art.category}</span>
            <h4 class="text-xs font-bold text-slate-900 leading-snug line-clamp-1">${art.title}</h4>
          </div>
          <button onclick="toggleSaveArticle(event, ${art.id}); toggleSavedArticlesModal();" class="text-red-600 hover:text-red-800 text-xs font-semibold shrink-0 ml-2">
            Remove
          </button>
        </div>
      `).join('');
    }
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

function shareArticle() {
  const dummyUrl = window.location.href;
  navigator.clipboard.writeText(dummyUrl).then(() => {
    alert("Article link copied to clipboard!");
  }).catch(() => {
    alert("Sharing link: " + dummyUrl);
  });
}

function addComment() {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;

  const commentsContainer = document.getElementById('modal-comments');
  const newCommentHTML = `
    <div class="bg-red-50/60 p-3 rounded-lg text-xs border border-red-100">
      <div class="flex justify-between font-bold text-slate-800 mb-1">
        <span>You (Reader)</span>
        <span class="text-gray-400 font-normal">Just now</span>
      </div>
      <p class="text-gray-700">${text}</p>
    </div>
  `;
  commentsContainer.innerHTML += newCommentHTML;
  input.value = '';
}

// Widget Handlers
function votePoll(option) {
  document.getElementById('poll-options').classList.add('hidden');
  document.getElementById('poll-result').classList.remove('hidden');
}

function handleNewsletter(e) {
  e.preventDefault();
  const email = document.getElementById('newsletter-email').value;
  const msg = document.getElementById('newsletter-msg');
  msg.textContent = `Thank you! ${email} has been subscribed to the Morning Briefing.`;
  msg.classList.remove('hidden');
  document.getElementById('newsletter-form').reset();
}

function toggleMobileSearch() {
  const searchBox = document.getElementById('search-container');
  searchBox.classList.toggle('hidden');
}

// --- ACCOUNT SESSION & NAVIGATION CONTROL ---
// One session covers both roles: /api/auth/login resolves whether the
// credentials belong to an editor or a reader and returns the role.
let currentAccount = null; // { id, name, email, role } | null

function openAuthModal(tab = 'login') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  switchAuthTab(tab);
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';
  const focusId = tab === 'signup' ? 'auth-signup-name' : 'auth-login-email';
  setTimeout(() => document.getElementById(focusId)?.focus(), 50);
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  document.body.style.overflow = '';
}

function switchAuthTab(tab) {
  const isLogin = tab !== 'signup';
  document.getElementById('auth-login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('auth-signup-form').classList.toggle('hidden', isLogin);

  const loginTab = document.getElementById('auth-tab-login');
  const signupTab = document.getElementById('auth-tab-signup');
  loginTab.className = isLogin
    ? 'flex-1 pb-2.5 text-sm font-bold border-b-2 border-red-600 text-red-600 transition'
    : 'flex-1 pb-2.5 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-slate-900 transition';
  signupTab.className = isLogin
    ? 'flex-1 pb-2.5 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-slate-900 transition'
    : 'flex-1 pb-2.5 text-sm font-bold border-b-2 border-red-600 text-red-600 transition';

  document.getElementById('auth-modal-title').textContent = isLogin ? 'Welcome back' : 'Create your account';
  document.getElementById('auth-modal-subtitle').textContent = isLogin
    ? 'Sign in to your reader account.'
    : 'Join Marial-LouNews in less than a minute.';

  document.getElementById('auth-login-error').classList.add('hidden');
  document.getElementById('auth-signup-error').classList.add('hidden');
}

function showAuthError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.remove('hidden');
}

function toggleAccountMenu() {
  document.getElementById('auth-account-menu')?.classList.toggle('hidden');
}

function closeAccountMenu() {
  document.getElementById('auth-account-menu')?.classList.add('hidden');
}

document.addEventListener('click', (event) => {
  const account = document.getElementById('auth-user');
  if (account && !account.contains(event.target)) closeAccountMenu();
});

function showNavNotice(message) {
  const notice = document.getElementById('nav-notice');
  if (!notice) return;
  document.getElementById('nav-notice-text').textContent = message;
  notice.classList.remove('hidden');
  notice.classList.add('flex');
}

function clearNavNotice() {
  const notice = document.getElementById('nav-notice');
  if (!notice) return;
  notice.classList.add('hidden');
  notice.classList.remove('flex');
}

// /admin bounces reader sessions back to the site with this flag.
function checkAccessNotice() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('access') !== 'editors-only') return;

  showNavNotice(
    'The newsroom console is for editors. You are signed in with a reader account, which keeps its normal access to the site.'
  );
  params.delete('access');
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

function updateAuthUI() {
  const buttons = document.getElementById('auth-buttons');
  const account = document.getElementById('auth-user');
  if (!buttons || !account) return;

  closeAccountMenu();

  if (currentAccount) {
    const isAdmin = currentAccount.role === 'admin';
    document.getElementById('auth-user-name').textContent = currentAccount.name || currentAccount.email;

    const badge = document.getElementById('auth-role-badge');
    badge.textContent = isAdmin ? 'Editor' : 'Reader';
    badge.className = `text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
      isAdmin ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-200'
    }`;

    document.getElementById('auth-menu-name').textContent = currentAccount.name || 'Reader account';
    document.getElementById('auth-menu-email').textContent = currentAccount.email;

    const consoleLink = document.getElementById('nav-admin-console');
    consoleLink.classList.toggle('hidden', !isAdmin);
    consoleLink.classList.toggle('flex', isAdmin);

    buttons.classList.add('hidden');
    buttons.classList.remove('flex');
    account.classList.remove('hidden');
    account.classList.add('flex');
  } else {
    buttons.classList.remove('hidden');
    buttons.classList.add('flex');
    account.classList.add('hidden');
    account.classList.remove('flex');
  }
}

function applySession(data) {
  const profile = data?.role === 'admin' ? data.admin : data?.user;
  currentAccount = profile ? { ...profile, role: data.role } : null;
  updateAuthUI();
  return currentAccount;
}

async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) throw new Error('Not signed in');
    applySession(await res.json());
  } catch {
    currentAccount = null;
    updateAuthUI();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('auth-login-email').value.trim();
  const password = document.getElementById('auth-login-password').value;
  const btn = document.getElementById('auth-login-btn');
  const errorEl = document.getElementById('auth-login-error');
  errorEl.classList.add('hidden');

  btn.disabled = true;
  btn.classList.add('opacity-60', 'cursor-not-allowed');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign in failed. Please try again.');

    const account = applySession(data);
    closeAuthModal();
    e.target.reset();
    if (account?.role === 'admin') {
      clearNavNotice();
      showNavNotice('Signed in as an editor. Open the Admin Console from your account menu to publish.');
    }
  } catch (err) {
    showAuthError('auth-login-error', err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const name = document.getElementById('auth-signup-name').value.trim();
  const email = document.getElementById('auth-signup-email').value.trim();
  const password = document.getElementById('auth-signup-password').value;
  const confirm = document.getElementById('auth-signup-confirm').value;
  const btn = document.getElementById('auth-signup-btn');
  const errorEl = document.getElementById('auth-signup-error');
  errorEl.classList.add('hidden');

  if (password !== confirm) {
    showAuthError('auth-signup-error', 'Passwords do not match.');
    return;
  }

  btn.disabled = true;
  btn.classList.add('opacity-60', 'cursor-not-allowed');
  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not create your account.');

    applySession(data);
    closeAuthModal();
    e.target.reset();
  } catch (err) {
    showAuthError('auth-signup-error', err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

async function logoutUser() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // The session cookie is cleared server-side; the local UI resets either way.
  }
  currentAccount = null;
  clearNavNotice();
  updateAuthUI();
}
