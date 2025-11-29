// /api/auth/zoom.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  try {
    const code = req.query.code;

    // Validate required env vars
    const { ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI } = process.env;
    if (!ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET || !ZOOM_REDIRECT_URI) {
      return res.status(500).json({
        error: "Missing Zoom environment variables",
        details: { ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI }
      });
    }

    // Step 1: Redirect to Zoom OAuth if no code
    if (!code) {
      const redirect = `https://zoom.us/oauth/authorize?response_type=code&client_id=${ZOOM_CLIENT_ID}&redirect_uri=${encodeURIComponent(ZOOM_REDIRECT_URI)}`;
      return res.redirect(redirect);
    }

    // Step 2: Exchange code for tokens
    const tokenRes = await fetch(`https://zoom.us/oauth/token?grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(ZOOM_REDIRECT_URI)}`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64"),
      },
    });

    const tokens = await tokenRes.json();

    // If Zoom returns an error
    if (tokens.error) {
      console.error("Zoom token error:", tokens);
      return res.status(500).json({
        error: "Failed to exchange code for tokens",
        details: tokens
      });
    }

    // Step 3: Store tokens in Supabase
    const { error: upsertError } = await supabase.from("integrations").upsert({
      id: "zoom",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      updated_at: new Date()
    });

    if (upsertError) {
      console.error("Supabase upsert error:", upsertError);
      return res.status(500).json({
        error: "Failed to save tokens to Supabase",
        details: upsertError
      });
    }

    // Success
    return res.send("<h2>Zoom connected ✅</h2><p>You can close this window and return to the app.</p>");

  } catch (err) {
    console.error("Unexpected error in /api/auth/zoom:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
