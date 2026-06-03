/**
 * Writes public/deploy.json so the UI knows the Render (or other) backend URL.
 * Set BOT_API_URL in Vercel → Settings → Environment Variables.
 */
const fs = require("fs");
const path = require("path");

const apiBase = (process.env.BOT_API_URL || "").replace(/\/$/, "");
const out = path.join(__dirname, "..", "public", "deploy.json");

fs.writeFileSync(
  out,
  JSON.stringify(
    {
      apiBase,
      mode: apiBase ? "remote" : "unconfigured",
      hint: apiBase
        ? null
        : "Set BOT_API_URL to https://ap-survey-bot.onrender.com in Vercel env vars.",
    },
    null,
    2
  )
);

console.log(
  apiBase
    ? `Vercel build: backend → ${apiBase}`
    : "Vercel build: BOT_API_URL not set (camera/OCR only until configured)"
);
