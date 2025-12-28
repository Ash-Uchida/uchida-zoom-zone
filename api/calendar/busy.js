// /api/calendar/busy.js
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Missing 'date' query parameter" });

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Fetch Google integration tokens
    const { data: integration, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", "google")
      .single();

    if (error || !integration) throw new Error("No Google integration found");

    const { access_token, refresh_token } = integration;

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ access_token, refresh_token });

    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

    // Fetch all events for the day
    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];

    // Normalize all events to full ISO strings in local time
    const busyTimes = events.map(event => {
      const startISO =
        event.start.dateTime || event.start.date + "T00:00:00";
      const endISO =
        event.end.dateTime || event.end.date + "T23:59:59";

      return {
        start: new Date(startISO),
        end: new Date(endISO),
      };
    });

    return res.status(200).json({ busyTimes });
  } catch (err) {
    console.error("Error fetching busy times:", err);
    return res.status(500).json({ error: err.message, busyTimes: [] });
  }
}
