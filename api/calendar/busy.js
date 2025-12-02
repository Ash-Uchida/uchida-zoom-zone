import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    // 1. Fetch your Google integration from Supabase
    const { data: integration, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", "google") // or the actual ID you used
      .single();

    if (error || !integration) {
      return res.status(500).json({ error: "Failed to fetch integration" });
    }

    let { access_token, refresh_token, expires_at } = integration;

    // 2. Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token,
      refresh_token,
    });

    // 3. Refresh token if expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (expires_at <= currentTime) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      access_token = credentials.access_token;
      expires_at = Math.floor(credentials.expiry_date / 1000);

      // Save updated token back to Supabase
      await supabase
        .from("integrations")
        .update({ access_token, expires_at })
        .eq("id", "google");
      
      oauth2Client.setCredentials({
        access_token,
        refresh_token,
      });
    }

    // 4. Use OAuth2 client with Google Calendar
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // 5. Fetch busy times (example: today)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];
    res.status(200).json({ busy: events });

  } catch (err) {
    console.error("Error fetching busy times:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
}
