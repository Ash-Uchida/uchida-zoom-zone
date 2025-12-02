// /api/calendar/busy.js
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Refresh Google access token if expired
async function refreshGoogleToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error("Google token refresh failed: " + JSON.stringify(data));

  await supabase.from("integrations").upsert({
    id: "google",
    access_token: data.access_token,
    refresh_token: refreshToken,
    updated_at: new Date().toISOString(),
  });

  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0"); // prevent 304 caching

  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Missing 'date' query parameter" });

    const selectedDate = new Date(date);
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Fetch Google integration token
    const { data: integration, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", "google")
      .single();

    if (error || !integration) throw new Error("No Google integration found");

    let { access_token, refresh_token } = integration;

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ access_token, refresh_token });

    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

    let events;
    try {
      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });
      events = response.data.items || [];
    } catch (err) {
      if (err.code === 401) {
        // token expired, refresh
        access_token = await refreshGoogleToken(refresh_token);
        oAuth2Client.setCredentials({ access_token, refresh_token });

        const response = await calendar.events.list({
          calendarId: "primary",
          timeMin: dayStart.toISOString(),
          timeMax: dayEnd.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
        });
        events = response.data.items || [];
      } else {
        throw err;
      }
    }

    const busyTimes = events.map((event) => ({
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
    }));

    return res.status(200).json({ busyTimes });
  } catch (err) {
    console.error("Error fetching busy times:", err);
    return res.status(500).json({ error: err.message });
  }
}
