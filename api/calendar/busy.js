// api/calendar/busy.js
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
    // Validate token
    await oauth2Client.getAccessToken();
    return oauth2Client.credentials.access_token;
  } catch {
    // Refresh token if expired
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

  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Missing date parameter" });

  try {
    const accessToken = await getGoogleAccessToken();
    const calendar = google.calendar({ version: "v3", auth: accessToken });

    const startOfDay = new Date(`${date}T00:00:00`).toISOString();
    const endOfDay = new Date(`${date}T23:59:59`).toISOString();

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfDay,
      timeMax: endOfDay,
      singleEvents: true,
      orderBy: "startTime",
    });

    const busyTimes =
      response.data.items?.map((event) => ({
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
      })) || [];

    res.status(200).json({ busyTimes });
  } catch (err) {
    console.error("Error fetching busy times:", err);
    res.status(500).json({ error: "Server error", details: String(err) });
  }
}
