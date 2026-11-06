import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "./supabase.js";
import { rssRouter, rssAdminRouter, startRssJob, startCleanupJob } from "./rss-ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const SESSION_COOKIE = "mln_session";
const SESSION_HOURS = { admin: 8, user: 24 * 7 };
const ACCOUNT_TABLES = { admin: "admins", user: "users" };
const ACCOUNT_COLUMNS = "id, email, name";
const AUTH_COLUMNS = "id, email, name, password_hash";
const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMING_HASH = bcrypt.hashSync("mln-placeholder", BCRYPT_ROUNDS);

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

function signSession(res, account, role) {
  const hours = SESSION_HOURS[role];
  const token = jwt.sign(
    { sub: String(account.id), email: account.email, role },
    process.env.JWT_SECRET,
    { expiresIn: `${hours}h` }
  );

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: hours * 60 * 60 * 1000,
    path: "/"
  });
}

function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

async function readSession(req, allowedRoles) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return { status: 401, error: "Not signed in" };

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { status: 401, error: "Session expired", clear: true };
  }

  if (!ACCOUNT_TABLES[payload.role]) {
    return { status: 401, error: "Session is not valid", clear: true };
  }

  if (!allowedRoles.includes(payload.role)) {
    return { status: 403, error: "Your account cannot access this area" };
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id)) {
    return { status: 401, error: "Session is not valid", clear: true };
  }

  const { data: account, error } = await supabaseAdmin
    .from(ACCOUNT_TABLES[payload.role])
    .select(ACCOUNT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) return { status: 500, error: error.message };
  if (!account) {
    return { status: 401, error: "Account no longer has access", clear: true };
  }

  return { role: payload.role, account };
}

function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    const session = await readSession(req, allowedRoles);

    if (session.status) {
      if (session.clear) clearSession(res);
      return res.status(session.status).json({ error: session.error });
    }

    req.role = session.role;
    req.account = session.account;
    req.admin = session.role === "admin" ? session.account : undefined;
    req.user = session.role === "user" ? session.account : undefined;
    next();
  };
}

const requireAdmin = requireRole("admin");
const requireSignedIn = requireRole("admin", "user");

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

function authPayload(role, account) {
  const publicAccount = { id: account.id, email: account.email, name: account.name };
  return {
    role,
    admin: role === "admin" ? publicAccount : null,
    user: role === "user" ? publicAccount : null
  };
}

app.post("/api/auth/signup", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (name.length < 2) {
    return res.status(400).json({ error: "Please enter your full name" });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const [{ data: editor, error: editorError }, { data: reader, error: readerError }] =
    await Promise.all([
      supabaseAdmin.from("admins").select("id").eq("email", email).maybeSingle(),
      supabaseAdmin.from("users").select("id").eq("email", email).maybeSingle()
    ]);

  if (editorError || readerError) {
    return res.status(500).json({ error: editorError?.message || readerError?.message });
  }
  if (editor) {
    return res.status(409).json({ error: "That email belongs to an editor account" });
  }
  if (reader) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { data: account, error } = await supabaseAdmin
    .from("users")
    .insert({ email, name, password_hash })
    .select(ACCOUNT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    return res.status(500).json({ error: error.message });
  }

  signSession(res, account, "user");
  res.status(201).json(authPayload("user", account));
});

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

  const { data: editor, error: editorError } = await supabaseAdmin
    .from("admins")
    .select(AUTH_COLUMNS)
    .eq("email", email)
    .maybeSingle();

  if (editorError) return res.status(500).json({ error: editorError.message });

  let account = editor;
  let role = "admin";

  if (!account) {
    const { data: reader, error: readerError } = await supabaseAdmin
      .from("users")
      .select(AUTH_COLUMNS)
      .eq("email", email)
      .maybeSingle();

    if (readerError) return res.status(500).json({ error: readerError.message });
    account = reader;
    role = "user";
  }

  const valid = !!account && (await bcrypt.compare(password, account.password_hash || TIMING_HASH));

  if (!valid) {
    recordFailure(throttleKey);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  loginAttempts.delete(throttleKey);
  signSession(res, account, role);
  res.json(authPayload(role, account));
});

app.get("/api/auth/me", requireSignedIn, (req, res) => {
  res.json(authPayload(req.role, req.account));
});

app.post("/api/auth/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

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

app.use("/api/rss", rssRouter);
app.use("/api/admin/rss", requireAdmin, rssAdminRouter);

app.use(express.static(path.join(__dirname, "..", "frontend")));

function sendAdminConsole(res) {
  res.sendFile(path.join(__dirname, "..", "frontend", "admin.html"));
}

app.get("/admin", async (req, res) => {
  const session = await readSession(req, ["admin", "user"]);
  if (session.role === "admin") return sendAdminConsole(res);
  if (session.role === "user") return res.redirect("/?access=editors-only");
  sendAdminConsole(res);
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
