console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_KEY:", !!process.env.SUPABASE_SERVICE_KEY);
console.log("GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID);

// api/auth/google.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  try {
    const code = req.query?.code;

    //
    // ---------------------------
    // 1️⃣ STEP 1 — Redirect user to Google OAuth Screen
    // ---------------------------
    //
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

      const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      return res.writeHead(302, { Location: url }).end();
    }

    //
    // ---------------------------
    // 2️⃣ STEP 2 — Exchange authorization code for access + refresh token
    // ---------------------------
    //
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
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

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error("❌ Token exchange error:", tokens);
      return res.status(500).json({
        error: "Failed to exchange OAuth code for tokens",
        details: tokens,
      });
    }

    //
    // ---------------------------
    // 3️⃣ STEP 3 — Save tokens to Supabase
    // ---------------------------
    //
    const expires_at = tokens.expires_in
      ? Math.floor(Date.now() / 1000) + tokens.expires_in
      : null;

    const saveData = {
      id: "google",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      scope: tokens.scope ?? null,
      expires_at,
    };

    console.log("Saving Google tokens:", saveData);

    const { error } = await supabase.from("integrations").upsert(saveData);

    if (error) {
      console.error("❌ Supabase upsert error:", error);
      return res.status(500).json({
        error: "Failed to save tokens to Supabase",
        details: error,
      });
    }

    //
    // ---------------------------
    // 4️⃣ STEP 4 — Show success confirmation page
    // ---------------------------
    //
    return res
      .status(200)
      .send(
        `<h2>Google connected ✅</h2>
         <p>You can close this window and return to ZoomZone.</p>`
      );

  } catch (err) {
    console.error("❌ Unexpected error in /api/auth/google:", err);
    return res.status(500).json({
      error: "Unexpected server error",
      details: String(err),
    });
  }
}
