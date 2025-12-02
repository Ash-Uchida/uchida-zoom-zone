// /api/send-reminders.js
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function sendEmail({ to, subject, html }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, html });
}

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
  try {
    // 1. Fetch Google integration
    const { data: googleData, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", "google")
      .single();

    if (error || !googleData) throw new Error("Google integration not found");

    let accessToken = googleData.access_token;

    // 2. Set up Google OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ access_token: accessToken, refresh_token: googleData.refresh_token });

    // 3. Get current time and 15 minutes ahead
    const now = new Date();
    const fifteenMinLater = new Date(now.getTime() + 15 * 60000);

    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

    // 4. Fetch events starting in the next 15 minutes
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: fifteenMinLater.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];

    for (const event of events) {
      const startTime = new Date(event.start.dateTime || event.start.date);
      const attendee = (event.attendees && event.attendees[0]?.email) || null;

      if (!attendee) continue; // Skip if no attendee email

      // 5. Find corresponding booking in Supabase
      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select("*")
        .eq("email", attendee)
        .eq("time", startTime.toISOString())
        .single();

      if (bookingError || !booking) continue; // Skip if no matching booking

      if (booking.reminder_sent) continue; // Skip if reminder already sent

      // 6. Send reminder email
      const subject = `Reminder: Your Zoom Zone Meeting at ${startTime.toLocaleTimeString()}`;
      const html = `<p>Hi ${booking.name},</p>
        <p>This is a reminder for your meeting at <strong>${startTime.toLocaleString()}</strong>.</p>
        <p>Join Zoom: <a href="${booking.zoom_link}">${booking.zoom_link}</a></p>
        <p>Thanks,<br/>Zoom Zone</p>`;

      await sendEmail({ to: booking.email, subject, html });

      // 7. Mark reminder as sent
      await supabase
        .from("bookings")
        .update({ reminder_sent: true })
        .eq("id", booking.id);
    }

    res.status(200).json({ message: "Reminders processed successfully", sentCount: events.length });
  } catch (err) {
    console.error("Error in /api/send-reminders:", err);
    res.status(500).json({ error: err.message });
  }
}
