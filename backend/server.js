const express = require("express");
import { supabaseAdmin, supabaseForUser } from "./supabase";

const app = express()
app.use(express.json());