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
const ROLES = ["user", "editor", "administrator"];
const SESSION_HOURS = { user: 24 * 7, editor: 8, administrator: 8 };
const ACCOUNT_TABLES = { user: "users", editor: "admins", administrator: "admins" };
const READER_COLUMNS = "id, email, name, created_at";
const STAFF_COLUMNS = "id, email, name, created_at, role";
const READER_AUTH_COLUMNS = "id, email, name, password_hash";
const STAFF_AUTH_COLUMNS = "id, email, name, password_hash, role";
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

function publicAccount(account, role) {
  return { id: account.id, email: account.email, name: account.name, role };
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

  const table = ACCOUNT_TABLES[payload.role];
  if (!table) return { status: 401, error: "Session is not valid", clear: true };

  const id = Number(payload.sub);
  if (!Number.isInteger(id)) {
    return { status: 401, error: "Session is not valid", clear: true };
  }

  const { data: account, error } = await supabaseAdmin
    .from(table)
    .select(table === "admins" ? STAFF_COLUMNS : READER_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) return { status: 500, error: error.message };
  if (!account) {
    return { status: 401, error: "Account no longer has access", clear: true };
  }

  const role = table === "admins" ? account.role : "user";
  if (!ROLES.includes(role)) {
    return { status: 401, error: "Session is not valid", clear: true };
  }
  if (!allowedRoles.includes(role)) {
    return { status: 403, error: "Your account cannot access this area" };
  }

  return { role, account };
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
    next();
  };
}

const requireAdministrator = requireRole("administrator");
const requireStaff = requireRole("editor", "administrator");
const requireSignedIn = requireRole(...ROLES);

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
  for (const field of ["lead", "featured", "published"]) {
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
const STAFF_ARTICLE_COLUMNS = `${ARTICLE_COLUMNS}, published, created_by`;

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

  const { conflict, error: conflictError } = await findEmailConflict(email);
  if (conflictError) return res.status(500).json({ error: conflictError });
  if (conflict) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { data: account, error } = await supabaseAdmin
    .from("users")
    .insert({ email, name, password_hash })
    .select(READER_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    return res.status(500).json({ error: error.message });
  }

  signSession(res, account, "user");
  res.status(201).json({ role: "user", account: publicAccount(account, "user") });
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

  const { data: staff, error: staffError } = await supabaseAdmin
    .from("admins")
    .select(STAFF_AUTH_COLUMNS)
    .eq("email", email)
    .maybeSingle();

  if (staffError) return res.status(500).json({ error: staffError.message });

  let account = staff;
  let role = staff?.role;

  if (!account) {
    const { data: reader, error: readerError } = await supabaseAdmin
      .from("users")
      .select(READER_AUTH_COLUMNS)
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
  res.json({ role, account: publicAccount(account, role) });
});

app.get("/api/auth/me", requireSignedIn, (req, res) => {
  res.json({ role: req.role, account: publicAccount(req.account, req.role) });
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
    .eq("published", true)
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
    .eq("published", true)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Article not found" });
  res.json(data);
});

app.get("/api/staff/articles", requireStaff, async (req, res) => {
  let query = supabaseAdmin
    .from("articles")
    .select(STAFF_ARTICLE_COLUMNS)
    .order("created_at", { ascending: false });

  if (req.role === "editor") query = query.eq("created_by", req.account.id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/articles", requireStaff, async (req, res) => {
  const { errors, data } = validateArticlePayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const { data: article, error } = await supabaseAdmin
    .from("articles")
    .insert({ ...data, created_by: req.account.id })
    .select(STAFF_ARTICLE_COLUMNS)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(article);
});

app.put("/api/articles/:id", requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid article id" });
  }

  const { errors, data } = validateArticlePayload(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("articles")
    .select("id, created_by")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) return res.status(500).json({ error: lookupError.message });
  if (!existing) return res.status(404).json({ error: "Article not found" });
  if (req.role === "editor" && existing.created_by !== req.account.id) {
    return res.status(403).json({ error: "Editors can only change their own articles" });
  }

  const { data: article, error } = await supabaseAdmin
    .from("articles")
    .update(data)
    .eq("id", id)
    .select(STAFF_ARTICLE_COLUMNS)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json(article);
});

app.delete("/api/articles/:id", requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid article id" });
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("articles")
    .select("id, created_by")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) return res.status(500).json({ error: lookupError.message });
  if (!existing) return res.status(404).json({ error: "Article not found" });
  if (req.role === "editor" && existing.created_by !== req.account.id) {
    return res.status(403).json({ error: "Editors can only delete their own articles" });
  }

  const { error } = await supabaseAdmin.from("articles").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, id });
});

function validateAccountPayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2 || name.length > 120) errors.push("'name' must be 2-120 characters");
    else data.name = name;
  } else if (!partial) {
    errors.push("'name' is required");
  }

  if (body?.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) errors.push("'email' must be a valid address");
    else data.email = email;
  } else if (!partial) {
    errors.push("'email' is required");
  }

  if (body?.password !== undefined && body.password !== "") {
    const password = String(body.password);
    if (password.length < 8) errors.push("'password' must be at least 8 characters");
    else data.password = password;
  } else if (!partial) {
    errors.push("'password' is required");
  }

  if (body?.role !== undefined) {
    if (!ROLES.includes(body.role)) errors.push(`'role' must be one of: ${ROLES.join(", ")}`);
    else data.role = body.role;
  } else if (!partial) {
    errors.push("'role' is required");
  }

  return { errors, data };
}

async function findEmailConflict(email) {
  const [{ data: staff, error: staffError }, { data: reader, error: readerError }] =
    await Promise.all([
      supabaseAdmin.from("admins").select("id").eq("email", email).maybeSingle(),
      supabaseAdmin.from("users").select("id").eq("email", email).maybeSingle()
    ]);

  if (staffError || readerError) {
    return { error: staffError?.message || readerError?.message };
  }
  return { conflict: staff || reader || null };
}

function isSameAccount(req, role, id) {
  return role !== "user" && id === req.account.id;
}

app.get("/api/admin/users", requireAdministrator, async (req, res) => {
  const [{ data: staff, error: staffError }, { data: readers, error: readerError }] =
    await Promise.all([
      supabaseAdmin.from("admins").select(STAFF_COLUMNS).order("created_at", { ascending: false }),
      supabaseAdmin.from("users").select(READER_COLUMNS).order("created_at", { ascending: false })
    ]);

  if (staffError || readerError) {
    return res.status(500).json({ error: staffError?.message || readerError?.message });
  }

  const accounts = [...(staff || []), ...(readers || []).map((r) => ({ ...r, role: "user" }))];
  accounts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(accounts);
});

app.post("/api/admin/users", requireAdministrator, async (req, res) => {
  const { errors, data } = validateAccountPayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const { conflict, error: conflictError } = await findEmailConflict(data.email);
  if (conflictError) return res.status(500).json({ error: conflictError });
  if (conflict) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const row = {
    email: data.email,
    name: data.name,
    password_hash: await bcrypt.hash(data.password, BCRYPT_ROUNDS)
  };
  if (data.role !== "user") row.role = data.role;

  const { data: account, error } = await supabaseAdmin
    .from(ACCOUNT_TABLES[data.role])
    .insert(row)
    .select(data.role === "user" ? READER_COLUMNS : STAFF_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(publicAccount(account, data.role));
});

app.put("/api/admin/users/:id", requireAdministrator, async (req, res) => {
  const id = Number(req.params.id);
  const currentRole = String(req.query.role || "");
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid account id" });
  if (!ROLES.includes(currentRole)) {
    return res.status(400).json({ error: "The account's current role is required" });
  }

  const { errors, data } = validateAccountPayload(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const nextRole = data.role || currentRole;
  if (isSameAccount(req, currentRole, id) && nextRole !== "administrator") {
    return res.status(400).json({ error: "You cannot remove your own administrator access" });
  }

  const table = ACCOUNT_TABLES[currentRole];
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from(table)
    .select(currentRole === "user" ? READER_AUTH_COLUMNS : STAFF_AUTH_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (lookupError) return res.status(500).json({ error: lookupError.message });
  if (!existing) return res.status(404).json({ error: "Account not found" });

  if (data.email && data.email !== existing.email) {
    const { conflict, error: conflictError } = await findEmailConflict(data.email);
    if (conflictError) return res.status(500).json({ error: conflictError });
    if (conflict) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
  }

  const changes = {};
  if (data.name !== undefined) changes.name = data.name;
  if (data.email !== undefined) changes.email = data.email;
  if (data.password !== undefined) {
    changes.password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  }

  const nextTable = ACCOUNT_TABLES[nextRole];
  const columns = nextRole === "user" ? READER_COLUMNS : STAFF_COLUMNS;

  if (nextTable === table) {
    if (nextRole !== "user") changes.role = nextRole;
    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data: account, error } = await supabaseAdmin
      .from(table)
      .update(changes)
      .eq("id", id)
      .select(columns)
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "An account with that email already exists" });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.json(publicAccount(account, nextRole));
  }

  const { data: created, error } = await supabaseAdmin
    .from(nextTable)
    .insert({
      email: changes.email ?? existing.email,
      name: changes.name ?? existing.name,
      password_hash: changes.password_hash ?? existing.password_hash,
      ...(nextRole === "user" ? {} : { role: nextRole })
    })
    .select(columns)
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    return res.status(500).json({ error: error.message });
  }

  const { error: removeError } = await supabaseAdmin.from(table).delete().eq("id", id);
  if (removeError) {
    await supabaseAdmin.from(nextTable).delete().eq("id", created.id);
    return res.status(500).json({ error: removeError.message });
  }

  res.json(publicAccount(created, nextRole));
});

app.delete("/api/admin/users/:id", requireAdministrator, async (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.query.role || "");
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid account id" });
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: "The account's current role is required" });
  }
  if (isSameAccount(req, role, id)) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }

  const { data, error } = await supabaseAdmin
    .from(ACCOUNT_TABLES[role])
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return res.status(500).json({ error: error.message });
  if (!data?.length) return res.status(404).json({ error: "Account not found" });
  res.json({ ok: true, id, role });
});

app.use("/api/rss", rssRouter);
app.use("/api/admin/rss", requireAdministrator, rssAdminRouter);

const CONSOLE_FILES = {
  editor: path.join(__dirname, "..", "frontend", "admin.html"),
  administrator: path.join(__dirname, "..", "frontend", "administrator", "administrator.html")
};

async function consoleGate(req, res, area) {
  const session = await readSession(req, ROLES);
  if (session.clear) clearSession(res);

  if (session.role === "user") return res.redirect("/?access=staff-only");

  if (area === "administrator") {
    if (session.role === "administrator") return res.sendFile(CONSOLE_FILES.administrator);
    if (session.role === "editor") return res.redirect("/editor?access=administrators-only");
    return res.redirect("/editor");
  }

  if (!session.role && session.status === 500) {
    return res.status(500).json({ error: session.error });
  }
  res.sendFile(CONSOLE_FILES.editor);
}

app.get("/admin", (req, res) => res.redirect("/editor"));
app.get("/admin.html", (req, res) => res.redirect("/editor"));
app.get("/editor", (req, res) => consoleGate(req, res, "editor"));
app.get("/administrator", (req, res) => consoleGate(req, res, "administrator"));
app.get("/administrator/administrator.html", (req, res) => res.redirect("/administrator"));

app.use(express.static(path.join(__dirname, "..", "frontend")));

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Marial-LouNews server running on http://localhost:${PORT}`);
  startRssJob();
  startCleanupJob();
});