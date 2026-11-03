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
}

let currentCategory = "Home";
let searchQuery = "";
let savedArticleIds = JSON.parse(localStorage.getItem("insight_saved_articles") || "[]");
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

  // Fetch articles from the backend, then render
  await loadArticles();
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
          <img src="${art.image}" alt="${art.title}" class="w-full sm:w-48 h-36 object-cover rounded-lg shrink-0 group-hover:brightness-95 transition">
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
  document.getElementById('hero-lead-img').src = lead.image;
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
      <img src="${art.image}" class="w-28 sm:w-32 h-full object-cover group-hover:scale-105 transition duration-300" alt="Thumbnail">
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

// --- INTERACTION & EVENT HANDLERS ---
function filterByCategory(cat) {
  currentCategory = cat;
  renderCategoryNav();
  renderApp();
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
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('clear-search').classList.add('hidden');
  searchQuery = '';
  renderApp();
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
  document.getElementById('modal-image').src = article.image;
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
  localStorage.setItem("insight_saved_articles", JSON.stringify(savedArticleIds));
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
  localStorage.setItem("insight_saved_articles", JSON.stringify(savedArticleIds));
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
