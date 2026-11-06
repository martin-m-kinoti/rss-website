import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

// Reader accounts are kept in a small local store so signup/login work
// without a database migration. Hashes only ever live on the server.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const USER_COOKIE = "user_session";
const SESSION_HOURS = 24 * 7; // readers stay signed in for a week

// Simple in-memory brute-force throttle: 5 failures per IP+email per 15 minutes.
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${USERS_FILE}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
  fs.renameSync(tmp, USERS_FILE);
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function issueSession(res, user) {
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, type: "user" },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_HOURS}h` }
  );

  res.cookie(USER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: "/"
  });
}

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

// Confirms the session cookie belongs to a user that still exists.
function requireUser(req, res, next) {
  const token = req.cookies?.[USER_COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.clearCookie(USER_COOKIE, { path: "/" });
    return res.status(401).json({ error: "Session expired" });
  }

  if (payload.type !== "user") {
    res.clearCookie(USER_COOKIE, { path: "/" });
    return res.status(401).json({ error: "Invalid session" });
  }

  const user = loadUsers().find((u) => u.id === payload.sub);
  if (!user) {
    res.clearCookie(USER_COOKIE, { path: "/" });
    return res.status(401).json({ error: "Account no longer exists" });
  }

  req.user = publicUser(user);
  next();
}

export const userAuthRouter = Router();

// Create a reader account. Signing up also signs the reader in.
userAuthRouter.post("/signup", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!name || name.length < 2) {
    return res.status(400).json({ error: "Please enter your full name" });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const users = loadUsers();
  if (users.some((u) => u.email === email)) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    password_hash: await bcrypt.hash(password, 12),
    created_at: new Date().toISOString()
  };

  users.push(user);
  saveUsers(users);

  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

userAuthRouter.post("/login", async (req, res) => {
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

  const user = loadUsers().find((u) => u.email === email);
  const valid = user && (await bcrypt.compare(password, user.password_hash));

  if (!valid) {
    recordFailure(throttleKey);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  loginAttempts.delete(throttleKey);
  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

userAuthRouter.get("/me", requireUser, (req, res) => {
  res.json({ user: req.user });
});

userAuthRouter.post("/logout", (req, res) => {
  res.clearCookie(USER_COOKIE, { path: "/" });
  res.json({ ok: true });
});
