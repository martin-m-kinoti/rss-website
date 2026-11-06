// Article ingest from partner news sites (RSS/Atom) for the MLN wire feed.
// Tables: rss_sources (feeds to poll) and rss_articles (deduped items, link out to the original).

import { Router } from "express";
import Parser from "rss-parser";
import cron from "node-cron";
import { supabaseAdmin } from "./supabase.js";

const SUMMARY_MAX_CHARS = 300; // keep excerpts short (copyright-friendly)
const FETCH_CRON = process.env.RSS_FETCH_CRON || "*/20 * * * *";
const RETENTION_DAYS = Number(process.env.RSS_RETENTION_DAYS) || 30;
const DEFAULT_WIRE_CATEGORY = "News";

const SITE_CATEGORIES = [
  "News",
  "Politics",
  "World",
  "Business",
  "Entertainment",
  "Sports",
  "Lifestyle",
  "Opinion"
];

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "Marial-LouNews-FeedReader/1.0 (+https://marialounews.co.ke)"
  },
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumb"]
    ]
  }
});

// ---------- helpers ----------

function stripHtml(html = "") {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || null;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function extractImage(item) {
  if (item.enclosure?.url && (item.enclosure.type || "").startsWith("image")) {
    return item.enclosure.url;
  }
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  if (item.mediaThumb?.$?.url) return item.mediaThumb.$.url;

  const html = item["content:encoded"] || item.content || "";
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function toIsoDate(item) {
  const raw = item.isoDate || item.pubDate;
  const d = raw ? new Date(raw) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// Feed categories arrive in any casing ("world"), and the homepage filters on the
// site's own category labels, so every category is mapped to one of them.
function normalizeCategory(raw) {
  const match = SITE_CATEGORIES.find(c => c.toLowerCase() === String(raw || "").trim().toLowerCase());
  return match || DEFAULT_WIRE_CATEGORY;
}

function isHttpUrl(value) {
  return /^https?:\/\/.+/i.test(String(value || "").trim());
}

// PostgREST treats % and _ as wildcards, and , separates terms inside or().
function toLikePattern(value) {
  const cleaned = String(value)
    .replace(/[%_,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `%${cleaned}%` : null;
}

function presentArticle(row) {
  const source = Array.isArray(row.rss_sources) ? row.rss_sources[0] : row.rss_sources;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    image_url: row.image_url,
    author: row.author,
    published_at: row.published_at,
    source_id: row.source_id,
    source_name: source?.name || "Wire",
    site_url: source?.site_url || null,
    category: normalizeCategory(source?.category)
  };
}

// ---------- ingestion ----------

async function readFeed(source) {
  const feed = await parser.parseURL(source.feed_url);

  const rows = (feed.items || [])
    .filter(item => item.title && item.link)
    .map(item => ({
      source_id: source.id,
      guid: item.guid || item.id || item.link,
      title: truncate(stripHtml(item.title), 500),
      summary: truncate(
        stripHtml(item.contentSnippet || item.summary || item.content || ""),
        SUMMARY_MAX_CHARS
      ),
      url: item.link,
      image_url: extractImage(item),
      author: item.creator || item.author || null,
      published_at: toIsoDate(item)
    }));

  if (rows.length) {
    const { error } = await supabaseAdmin
      .from("rss_articles")
      .upsert(rows, { onConflict: "source_id,guid", ignoreDuplicates: true });
    if (error) throw error;
  }

  return rows.length;
}

async function fetchSource(source) {
  const result = { id: source.id, name: source.name, items: 0, error: null };
  try {
    result.items = await readFeed(source);
  } catch (err) {
    result.error = err.message;
    console.error(`[rss] ${source.name} failed:`, err.message);
  }

  const { error: statusError } = await supabaseAdmin
    .from("rss_sources")
    .update({ last_fetched_at: new Date().toISOString(), last_error: result.error })
    .eq("id", source.id);
  if (statusError) console.error(`[rss] status update failed for ${source.name}:`, statusError.message);

  if (!result.error) console.log(`[rss] ${source.name}: ${result.items} items processed`);
  return result;
}

let activeRun = null;

// Shared by the scheduler and the dashboard's "Fetch now", so the two never overlap.
function ingestAll() {
  if (activeRun) return activeRun;
  activeRun = runIngestAll().finally(() => {
    activeRun = null;
  });
  return activeRun;
}

async function runIngestAll() {
  const { data: sources, error } = await supabaseAdmin
    .from("rss_sources")
    .select("id, name, feed_url")
    .eq("active", true);
  if (error) throw error;

  const results = [];
  for (const source of sources) {
    if (!isHttpUrl(source.feed_url)) {
      results.push({ id: source.id, name: source.name, items: 0, error: "Invalid feed URL" });
      continue;
    }
    results.push(await fetchSource(source));
  }

  return {
    sources: results.length,
    items: results.reduce((sum, r) => sum + r.items, 0),
    failed: results.filter(r => r.error).length,
    results
  };
}

export function startRssJob() {
  if (!cron.validate(FETCH_CRON)) {
    console.error(`[rss] ignoring invalid RSS_FETCH_CRON: ${FETCH_CRON}`);
    return;
  }
  ingestAll().catch(err => console.error("[rss] ingestAll error:", err.message));
  cron.schedule(FETCH_CRON, () => {
    ingestAll().catch(err => console.error("[rss] ingestAll error:", err.message));
  });
}

// Keeps the wire table small by dropping items older than the retention window.
export function startCleanupJob(days = RETENTION_DAYS) {
  const cutoff = () => new Date(Date.now() - days * 86400000).toISOString();
  const purge = async () => {
    const { error } = await supabaseAdmin.from("rss_articles").delete().lt("published_at", cutoff());
    if (error) console.error("[rss] cleanup error:", error.message);
  };
  if (!cron.validate("0 3 * * *")) return;
  cron.schedule("0 3 * * *", purge);
}

// ---------- validation ----------

function validateSourcePayload(body, { partial = false }) {
  const errors = [];
  const data = {};

  if (!partial) {
    if (!body?.name || !String(body.name).trim()) errors.push("'name' is required");
    if (!body?.feed_url || !String(body.feed_url).trim()) errors.push("'feed_url' is required");
  }

  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 120) errors.push("'name' must be 1-120 characters");
    else data.name = name;
  }
  if (body?.feed_url !== undefined) {
    const feedUrl = String(body.feed_url).trim();
    if (!isHttpUrl(feedUrl)) errors.push("'feed_url' must start with http:// or https://");
    else data.feed_url = feedUrl;
  }
  if (body?.site_url !== undefined) {
    const siteUrl = String(body.site_url).trim();
    if (siteUrl && !isHttpUrl(siteUrl)) errors.push("'site_url' must start with http:// or https://");
    else data.site_url = siteUrl || null;
  }
  if (body?.category !== undefined) {
    data.category = normalizeCategory(body.category);
  }
  if (body?.active !== undefined) {
    if (typeof body.active !== "boolean") errors.push("'active' must be a boolean");
    else data.active = body.active;
  }

  if (!partial && data.category === undefined) data.category = DEFAULT_WIRE_CATEGORY;
  return { errors, data };
}

// ---------- public routes (mounted at /api/rss) ----------

export const rssRouter = Router();

// GET /api/rss?source=1&category=World&q=election&page=1&limit=12
rssRouter.get("/", async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 12, 1), 50);
  const from = (page - 1) * limit;

  let query = supabaseAdmin
    .from("rss_articles")
    .select(
      "id, title, summary, url, image_url, author, published_at, source_id, rss_sources!inner(id, name, site_url, category)",
      { count: "exact" }
    )
    .order("published_at", { ascending: false })
    .range(from, from + limit - 1);

  const sourceId = Number.parseInt(req.query.source, 10);
  if (Number.isInteger(sourceId)) query = query.eq("source_id", sourceId);

  if (req.query.category) {
    // ilike without wildcards = case-insensitive equality, so feeds registered as
    // "world" still match the site's "World" label.
    query = query.ilike("rss_sources.category", normalizeCategory(req.query.category));
  }

  if (req.query.q) {
    const pattern = toLikePattern(req.query.q);
    if (!pattern) return res.json({ page, limit, total: 0, articles: [] });
    query = query.or(`title.ilike.${pattern},summary.ilike.${pattern}`);
  }

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ page, limit, total: count ?? 0, articles: (data || []).map(presentArticle) });
});

// GET /api/rss/sources — active feeds, used for the homepage source chips
rssRouter.get("/sources", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("rss_sources")
    .select("id, name, site_url, category")
    .eq("active", true)
    .order("name");
  if (error) return res.status(500).json({ error: error.message });

  res.json(
    (data || []).map(s => ({
      id: s.id,
      name: s.name,
      site_url: s.site_url,
      category: normalizeCategory(s.category)
    }))
  );
});

// ---------- admin routes (mounted behind requireAdmin) ----------

export const rssAdminRouter = Router();

// GET /api/admin/rss/sources — every feed, including inactive ones and fetch errors
rssAdminRouter.get("/sources", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("rss_sources")
    .select("id, name, feed_url, site_url, category, active, last_fetched_at, last_error, rss_articles(count)")
    .order("name");
  if (error) return res.status(500).json({ error: error.message });

  res.json(
    (data || []).map(s => ({
      id: s.id,
      name: s.name,
      feed_url: s.feed_url,
      site_url: s.site_url,
      category: normalizeCategory(s.category),
      active: s.active,
      last_fetched_at: s.last_fetched_at,
      last_error: s.last_error,
      article_count: s.rss_articles?.reduce((sum, r) => sum + Number(r.count || 0), 0) ?? 0
    }))
  );
});

// POST /api/admin/rss/sources — register a feed and pull its first batch immediately
rssAdminRouter.post("/sources", async (req, res) => {
  const { errors, data } = validateSourcePayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const { data: source, error } = await supabaseAdmin
    .from("rss_sources")
    .insert(data)
    .select("id, name, feed_url, site_url, category, active")
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: `That feed URL is already added as "${data.feed_url}".` });
    }
    return res.status(500).json({ error: error.message });
  }

  const fetchResult = await fetchSource(source);
  res.status(201).json({ source, fetch: fetchResult });
});

// PUT /api/admin/rss/sources/:id — edit or pause a feed
rssAdminRouter.put("/sources/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid source id" });

  const { errors, data } = validateSourcePayload(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "No fields to update" });

  let query = supabaseAdmin
    .from("rss_sources")
    .update(data)
    .eq("id", id)
    .select("id, name, feed_url, site_url, category, active");

  // Editing a URL can collide with another feed; report the loser rather than both.
  if (data.feed_url) query = query.ne("feed_url", data.feed_url);
  const { data: source, error } = await query.maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!source) {
    return res.status(404).json({ error: "Feed not found (or that URL is already registered)" });
  }
  res.json({ ...source, category: normalizeCategory(source.category) });
});

// POST /api/admin/rss/sources/:id/ingest — fetch one feed on demand
rssAdminRouter.post("/sources/:id/ingest", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid source id" });

  const { data: source, error } = await supabaseAdmin
    .from("rss_sources")
    .select("id, name, feed_url")
    .eq("id", id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!source) return res.status(404).json({ error: "Feed not found" });
  if (!isHttpUrl(source.feed_url)) return res.status(400).json({ error: "Feed URL is not http(s)" });

  res.json(await fetchSource(source));
});

// DELETE /api/admin/rss/sources/:id — drop the feed and its cached articles
rssAdminRouter.delete("/sources/:id", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid source id" });

  const { data, error } = await supabaseAdmin
    .from("rss_sources")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return res.status(500).json({ error: error.message });
  if (!data?.length) return res.status(404).json({ error: "Feed not found" });
  res.json({ ok: true, id });
});

// POST /api/admin/rss/ingest — refresh every active feed now
rssAdminRouter.post("/ingest", async (req, res) => {
  try {
    res.json(await ingestAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
