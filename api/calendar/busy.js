// /api/calendar/busy.js
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Missing 'date' query parameter" });

    const selectedDate = new Date(date);
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
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

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];

    const busyTimes = events.map((event) => {
      let start, end;

      if (event.start.dateTime && event.end.dateTime) {
        // normal event with times
        start = new Date(event.start.dateTime).toISOString();
        end = new Date(event.end.dateTime).toISOString();
      } else if (event.start.date && event.end.date) {
        // all-day event: treat as full day
        start = new Date(event.start.date).setHours(0, 0, 0, 0);
        end = new Date(event.end.date).setHours(23, 59, 59, 999);
        start = new Date(start).toISOString();
        end = new Date(end).toISOString();
      }

      return { start, end };
    });

    return res.status(200).json({ busyTimes });
  } catch (err) {
    console.error("Error fetching busy times:", err);
    return res.status(500).json({ error: err.message, busyTimes: [] });
  }
}
