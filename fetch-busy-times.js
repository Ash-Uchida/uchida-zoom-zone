import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchBusyTimes() {
  // Fetch Google token from Supabase
  const { data } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", "google")
    .single();

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  // Fetch events
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const events = res.data.items;

  // Normalize all events to UTC for consistency
  const busySlots = events.map(event => {
    const startUTC = new Date(event.start.dateTime || event.start.date).toISOString();
    const endUTC = new Date(event.end.dateTime || event.end.date).toISOString();
    return { start: startUTC, end: endUTC, summary: event.summary };
  });

  console.log("Normalized busy slots:", busySlots);
  return busySlots;
}

fetchBusyTimes();
