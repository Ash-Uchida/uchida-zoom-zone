// /api/send-reminders.js
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// ---- Supabase client ----
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Email helper ----
async function sendReminderEmail({ name, email, time, zoomLink }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const timeStr = new Date(time).toLocaleString();

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Reminder: Your Zoom Meeting in 15 minutes`,
    html: `
      <p>Hi ${name},</p>
      <p>This is a friendly reminder that your meeting starts at <strong>${timeStr}</strong>.</p>
      <p>Join Zoom: <a href="${zoomLink}">${zoomLink}</a></p>
      <p>Thanks,<br/>Zoom Zone</p>
    `,
  });
}

// ---- Extract a Zoom link from event description ----
function extractZoomLink(event) {
  if (!event.description) return null;

  // Matches ENTIRE Zoom URL with query params
  const regex = /https:\/\/us\d*\.zoom\.us\/\S+/i;
  const match = event.description.match(regex);

  return match ? match[0] : null;
}

// ---- Fetch Google Calendar events ----
async function getUpcomingEvents(oAuth2Client) {
  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60000);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: inOneHour.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return res.data.items || [];
}

// ---- Main handler ----
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Fetch Google tokens from Supabase
    const { data: integrationData, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", "google")
      .single();

    if (integrationError || !integrationData) {
      throw new Error("Failed to fetch Google integration tokens");
    }

    const { access_token, refresh_token } = integrationData;

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oAuth2Client.setCredentials({ access_token, refresh_token });

    // Get upcoming events
    const events = await getUpcomingEvents(oAuth2Client);
    const now = new Date();

    for (const event of events) {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const minutesUntilStart = (eventStart - now) / 60000;

      // Only send a reminder 0–15 minutes before
      if (minutesUntilStart <= 15 && minutesUntilStart >= 0) {
        const zoomLink = extractZoomLink(event);
        if (!zoomLink) continue;

        // Match booking in Supabase
        const { data: booking, error: bookingErr } = await supabase
          .from("bookings")
          .select("*")
          .eq("zoom_link", zoomLink)
          .eq("reminder_sent", false)
          .single();

        if (bookingErr || !booking) continue;

        // Send reminder email
        await sendReminderEmail({
          name: booking.name,
          email: booking.email,
          time: booking.time,
          zoomLink: booking.zoom_link,
        });

        // Mark reminder as sent
        await supabase
          .from("bookings")
          .update({ reminder_sent: true })
          .eq("id", booking.id);
      }
    }

    return res.status(200).json({
      message: "Reminders checked and sent where needed.",
    });
  } catch (err) {
    console.error("Error in send-reminders:", err);
    return res.status(500).json({ error: err.message });
  }
}
