import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "./supabase.js";
import { rssRouter, rssAdminRouter, startRssJob, startCleanupJob } from "./rss-ingest.js";
import { userAuthRouter } from "./user-auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const SESSION_COOKIE = "admin_session";
const SESSION_HOURS = 8;

// Simple in-memory brute-force throttle: 5 failures per IP+email per 15 minutes.
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function isLockedOut(key) {
  const rec = loginAttempts.get(key);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) {
    loginAttempts.delete(key);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const rec = loginAttempts.get(key);
  if (!rec || Date.now() > rec.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
  } else {
    rec.count++;
  }
}

// Verifies the session cookie and confirms the admin account still exists.
async function requireAdmin(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.clearCookie(SESSION_COOKIE);
    return res.status(401).json({ error: "Session expired" });
  }

  const { data: admin, error } = await supabaseAdmin
    .from("admins")
    .select("id, email, name")
    .eq("id", Number(payload.sub))
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!admin) {
    res.clearCookie(SESSION_COOKIE);
    return res.status(401).json({ error: "Account no longer has admin access" });
  }

  req.admin = admin;
  next();
}

function validateArticlePayload(body, { partial = false } = {}) {
  const errors = [];
  const fields = ["title", "category", "author", "summary", "content", "image_url"];

  if (!partial) {
    for (const required of ["title", "category", "summary", "content"]) {
      if (!body[required] || String(body[required]).trim() === "") {
        errors.push(`'${required}' is required`);
      }
    }
  }

  const data = {};
  for (const field of fields) {
    if (body[field] === undefined) continue;
    if (body[field] === null && field === "image_url") {
      data[field] = null;
      continue;
    }
    if (typeof body[field] === "string") {
      data[field] = body[field].trim();
    } else {
      errors.push(`'${field}' must be a string`);
    }
  }
  if (data.image_url && !/^https?:\/\//i.test(data.image_url)) {
    errors.push("'image_url' must start with http:// or https://");
  }
  for (const field of ["lead", "featured"]) {
    if (body[field] !== undefined) {
      if (typeof body[field] === "boolean") {
        data[field] = body[field];
      } else {
        errors.push(`'${field}' must be a boolean`);
      }
    }
  }
  return { errors, data };
}

const ARTICLE_COLUMNS =
  "id, title, category, author, summary, content, image_url, lead, featured, created_at";

// ---------- Public endpoints ----------

app.get("/api/articles", async (req, res) => {
  const { category } = req.query;

  let query = supabaseAdmin
    .from("articles")
    .select(ARTICLE_COLUMNS)
    .order("created_at", { ascending: false });

  if (category && category !== "Home") {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/articles/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid article id" });
  }

  const { data, error } = await supabaseAdmin
    .from("articles")
    .select(ARTICLE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Article not found" });
  res.json(data);
});

// ---------- Admin auth endpoints ----------

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const throttleKey = `${req.ip}:${email}`;
  if (isLockedOut(throttleKey)) {
    return res.status(429).json({
      error: "Too many failed attempts. Try again in 15 minutes."
    });
  }

  const { data: admin, error } = await supabaseAdmin
    .from("admins")
    .select("id, email, name, password_hash")
    .eq("email", email)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  const valid = admin && (await bcrypt.compare(password, admin.password_hash));
  if (!valid) {
    recordFailure(throttleKey);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  loginAttempts.delete(throttleKey);

  const token = jwt.sign(
    { sub: String(admin.id), email: admin.email },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_HOURS}h` }
  );

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: "/"
  });

  res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
});

app.get("/api/auth/me", requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

// ---------- Reader auth (login / signup) ----------

app.use("/api/user", userAuthRouter);

// ---------- Admin endpoints ----------

app.post("/api/articles", requireAdmin, async (req, res) => {
  const { errors, data } = validateArticlePayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const { data: article, error } = await supabaseAdmin
    .from("articles")
    .insert(data)
    .select(ARTICLE_COLUMNS)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(article);
});

app.put("/api/articles/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid article id" });
  }

  const { errors, data } = validateArticlePayload(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const { data: article, error } = await supabaseAdmin
    .from("articles")
    .update(data)
    .eq("id", id)
    .select(ARTICLE_COLUMNS)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json(article);
});

app.delete("/api/articles/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid article id" });
  }

  const { data: article, error } = await supabaseAdmin
    .from("articles")
    .delete()
    .eq("id", id)
    .select("id")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json({ ok: true, id });
});

// ---------- Wire (RSS) endpoints ----------

// Public: aggregated partner headlines + the active feed list for the homepage chips.
app.use("/api/rss", rssRouter);

// Admin: manage feeds and trigger fetches from the dashboard.
app.use("/api/admin/rss", requireAdmin, rssAdminRouter);

// ---------- Static frontend ----------

app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "admin.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Marial-LouNews server running on http://localhost:${PORT}`);
  startRssJob();
  startCleanupJob();
});
