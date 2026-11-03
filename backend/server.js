import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "./supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

// Simple shared-secret auth for admin dashboard requests.
// Header: x-admin-token
function requireAdmin(req, res, next) {
  const token = req.header("x-admin-token");
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized: invalid admin token" });
  }
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
    if (body[field] !== undefined) {
      if (typeof body[field] === "string") {
        data[field] = body[field].trim();
      } else {
        errors.push(`'${field}' must be a string`);
      }
    }
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

// ---------- Admin endpoints ----------

app.post("/api/admin/verify", requireAdmin, (req, res) => {
  res.json({ ok: true });
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
  console.log(`InsightNews server running on http://localhost:${PORT}`);
});
