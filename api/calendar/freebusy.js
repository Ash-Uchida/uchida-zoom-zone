// api/calendar/freebusy.js
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Helper to get a valid Google OAuth access token
async function getGoogleAccessToken() {
  const { data: tokenData, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", "google")
    .single();

  if (error || !tokenData) {
    throw new Error("No Google integration found in Supabase");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
  });

  try {
    // Check if token is valid
    await oauth2Client.getAccessToken();
    return oauth2Client.credentials.access_token;
  } catch {
    // Refresh token
    const newToken = await oauth2Client.refreshAccessToken();
    const access_token = newToken.credentials.access_token;

    // Save new token to Supabase
    await supabase
      .from("integrations")
      .upsert({
        id: "google",
        access_token,
        refresh_token: tokenData.refresh_token,
        updated_at: new Date().toISOString(),
      });

    return access_token;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const accessToken = await getGoogleAccessToken();
    const calendar = google.calendar({ version: "v3", auth: accessToken });

    const now = new Date();
    const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: oneWeekLater.toISOString(),
        items: [{ id: "primary" }],
      },
    });

    res.status(200).json(response.data);
  } catch (err) {
    console.error("Error fetching free/busy times:", err);
    res.status(500).json({ error: "Server error", details: String(err) });
  }
}
