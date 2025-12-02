// /api/send-reminders.js
import { google } from "googleapis";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

// --- Supabase setup ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// --- Nodemailer setup ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// --- Helper to convert Date to local ISO without Z ---
function toLocalISOString(date) {
  const tzOffset = date.getTimezoneOffset() * 60000; // in ms
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 19);
}

// --- Fetch Google token from Supabase ---
async function getGoogleAccessToken() {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", "google")
    .single();

  if (error || !data) throw new Error(error?.message || "No Google integration found");

  // Check token expiration and refresh if needed
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oAuth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  // Force refresh to make sure token is valid
  const { credentials } = await oAuth2Client.refreshAccessToken();
  await supabase.from("integrations").upsert({
    id: "google",
    access_token: credentials.access_token,
    refresh_token: data.refresh_token,
    updated_at: new Date().toISOString(),
  });

  return credentials.access_token;
}

// --- Send reminder email ---
async function sendReminderEmail({ to, meeting }) {
  const startTime = new Date(meeting.start.dateTime || meeting.start.date);
  const startStr = startTime.toLocaleString();

  const html = `<p>Hi,</p>
    <p>This is a reminder that your meeting "<strong>${meeting.summary}</strong>" starts at <strong>${startStr}</strong>.</p>
    <p>Zoom link: <a href="${meeting.description}">${meeting.description}</a></p>
    <p>Thanks,<br/>Zoom Zone</p>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: `Reminder: ${meeting.summary} at ${startStr}`,
    html,
  });
}

// --- Main API handler ---
export default async function handler(req, res) {
  try {
    // Get Google access token
    const accessToken = await getGoogleAccessToken();
    const oAuth2Client = new google.auth.OAuth2();
    oAuth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

    const now = new Date();
    const fifteenMinutesLater = new Date(now.getTime() + 15 * 60 * 1000);

    // Fetch events in the next 15 minutes
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: fifteenMinutesLater.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];

    // Loop through events and send reminders
    for (const event of events) {
      // Only send reminder if we haven't sent it yet (optional: track in Supabase)
      const attendees = event.attendees || [];
      for (const attendee of attendees) {
        // Skip yourself
        if (attendee.email === process.env.EMAIL_FROM) continue;
        await sendReminderEmail({ to: attendee.email, meeting: event });
      }
    }

    return res.status(200).json({ message: "Reminders sent", sentCount: events.length });
  } catch (err) {
    console.error("Error sending reminders:", err);
    return res.status(500).json({ error: err.message });
  }
}
