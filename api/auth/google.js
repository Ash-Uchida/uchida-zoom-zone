console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_KEY:", !!process.env.SUPABASE_SERVICE_KEY);
console.log("GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID);

// api/auth/google.js
// import fetch from "node-fetch"; // safe for Vercel serverless
import { createClient } from "@supabase/supabase-js";

// Use server-side environment variables (no VITE_ prefix)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  try {
    const code = req.query?.code;

    // Step 1: If no code, redirect user to Google OAuth consent screen
    if (!code) {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        response_type: "code",
        scope: [
          "https://www.googleapis.com/auth/calendar",
          "https://www.googleapis.com/auth/calendar.events",
          "openid",
          "email",
          "profile",
        ].join(" "),
        access_type: "offline",
        prompt: "consent",
      });

      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      return res.writeHead(302, { Location: googleAuthUrl }).end();
    }

    // Step 2: Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      console.error("Google token error:", tokens);
      return res.status(500).json({
        error: "Failed to exchange code for tokens",
        details: tokens,
      });
    }

    // Step 3: Save tokens to Supabase table "integrations"
    const upsert = {
      id: "google",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      expires_at: tokens.expires_in
        ? Math.floor(Date.now() / 1000) + Number(tokens.expires_in)
        : null,
    };

    const { error } = await supabase.from("integrations").upsert(upsert);
    if (error) {
      console.error("Supabase upsert error:", error);
      return res.status(500).json({
        error: "Failed to save tokens to Supabase",
        details: error,
      });
    }

    // Step 4: Success page
    return res
      .status(200)
      .send(
        "<h2>Google connected ✅</h2><p>You can close this window and return to the app.</p>"
      );
  } catch (err) {
    console.error("Unexpected error in /api/auth/google:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: String(err) });
  }
}
