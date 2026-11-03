// Usage (from the backend directory):
//   npm run add-admin -- editor@insightnews.co.ke 'YourStrongPass123' "Editor Name"
//
// Creates the admin if the email is new, or updates the password/name if it exists.

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const [emailArg, password, ...nameParts] = process.argv.slice(2);
const email = (emailArg || "").trim().toLowerCase();
const name = nameParts.join(" ").trim() || "Editor";

function fail(message) {
  console.error(`\nError: ${message}\n`);
  console.error("Usage: npm run add-admin -- <email> <password> [name]");
  console.error('Example: npm run add-admin -- editor@insightnews.co.ke "StrongPass123" "Jane Doe"\n');
  process.exit(1);
}

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail("a valid email address is required.");
}
if (!password || password.length < 8) {
  fail("password must be at least 8 characters.");
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  fail("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing from backend/.env");
}

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const password_hash = await bcrypt.hash(password, 12);

const { data: existing, error: lookupError } = await admin
  .from("admins")
  .select("id")
  .eq("email", email)
  .maybeSingle();

if (lookupError) {
  console.error(`\nError: ${lookupError.message}`);
  console.error("Have you run supabase/schema.sql in the Supabase SQL Editor yet?\n");
  process.exit(1);
}

if (existing) {
  const { error } = await admin
    .from("admins")
    .update({ password_hash, name })
    .eq("id", existing.id);
  if (error) {
    console.error(`\nError: ${error.message}\n`);
    process.exit(1);
  }
  console.log(`\nUpdated admin ${email} (id ${existing.id}).\n`);
} else {
  const { data: created, error } = await admin
    .from("admins")
    .insert({ email, password_hash, name })
    .select("id")
    .single();
  if (error) {
    console.error(`\nError: ${error.message}\n`);
    process.exit(1);
  }
  console.log(`\nCreated admin ${email} (id ${created.id}).\n`);
}

console.log("Sign in at http://localhost:3000/admin\n");
