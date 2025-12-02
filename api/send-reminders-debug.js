import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  try {
    console.log("DEBUG: Handler started");

    const { data: integrationData } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", "google")
      .single();

    const { access_token, refresh_token } = integrationData;

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oAuth2Client.setCredentials({ access_token, refresh_token });

    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60000);

    const result = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: inOneHour.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = result.data.items || [];
    const details = [];

    for (const event of events) {
      const zoomFromDescription = event.description?.match(/https:\/\/\S+/)?.[0] || null;

      // NEW: Find Zoom link in conferenceData
      let zoomFromConference = null;
      if (event.conferenceData?.entryPoints) {
        const zoomPoint = event.conferenceData.entryPoints.find(
          (p) => p.entryPointType === "video" && p.uri.includes("zoom")
        );
        if (zoomPoint) zoomFromConference = zoomPoint.uri;
      }

      details.push({
        summary: event.summary,
        start: event.start,
        zoomFromDescription,
        zoomFromConference,
      });
    }

    return res.status(200).json({
      message: "Debug data",
      eventsFound: events.length,
      events: details,
    });
  } catch (err) {
    console.error("DEBUG ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
