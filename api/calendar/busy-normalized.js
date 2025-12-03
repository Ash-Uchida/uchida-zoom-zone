// /api/calendar/busy-normalized.js
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Get Google OAuth tokens from Supabase
    const { data: integration } = await supbase
      .from("integrations")
      .select("*")
      .eq("id", "google")
      .single();

    if (!integration) {
      return res.status(400).json({ error: "No Google token found" });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: integration.access_token,
      refresh_token: integration.refresh_token,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Look 7 days ahead
    const resEvents = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
    });

    const events = resEvents.data.items || [];

    // Normalize EVERYTHING to UTC
    const busyUTC = events.map((event) => {
      const start = new Date(event.start.dateTime || event.start.date).toISOString();
      const end = new Date(event.end.dateTime || event.end.date).toISOString();
      return { start, end, summary: event.summary };
    });

    return res.status(200).json(busyUTC);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
