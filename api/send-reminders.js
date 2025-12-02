// /api/send-reminders.js
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Email helper ----
async function sendReminderEmail({ name, email, time, zoomLink }) {
  try {
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
      html: `<p>Hi ${name},</p>
             <p>This is a friendly reminder that your meeting is starting at <strong>${timeStr}</strong>.</p>
             <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
             <p>Thanks,<br/>Zoom Zone</p>`,
    });

    console.log(`✅ Reminder sent to ${email} for meeting at ${timeStr}`);
  } catch (err) {
    console.error(`❌ Failed to send reminder to ${email}:`, err.message);
  }
}

// ---- Fetch Google Calendar events ----
async function getUpcomingEvents(oAuth2Client) {
  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: inOneHour.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return res.data.items || [];
}

// ---- API handler ----
export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    // Fetch Google integration tokens
    const { data: integrationData, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", "google")
      .single();

    if (integrationError || !integrationData)
      throw new Error("Failed to fetch Google integration tokens");

    const { access_token, refresh_token } = integrationData;

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ access_token, refresh_token });

    // Fetch upcoming Google events
    const events = await getUpcomingEvents(oAuth2Client);

    console.log(`Found ${events.length} upcoming event(s)`);

    const now = new Date();

    for (const event of events) {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const minutesUntilStart = (eventStart - now) / 60000;

      console.log(
        `Event: "${event.summary}" starts in ${minutesUntilStart.toFixed(
          1
        )} minutes`
      );

      // Send reminders for events starting in the next 15 minutes (allowing 1 min buffer)
      if (minutesUntilStart <= 15 && minutesUntilStart >= -1) {
        const zoomLink = event.description?.match(/https:\/\/[\w.-]+/)?.[0];

        if (!zoomLink) {
          console.log(`⚠️ No Zoom link found for event: "${event.summary}"`);
          continue;
        }

        const { data: bookingData } = await supabase
          .from("bookings")
          .select("*")
          .eq("zoom_link", zoomLink)
          .eq("reminder_sent", false)
          .maybeSingle();

        if (!bookingData) {
          console.log(`⚠️ No booking found for Zoom link: ${zoomLink}`);
          continue;
        }

        await sendReminderEmail({
          name: bookingData.name,
          email: bookingData.email,
          time: bookingData.time,
          zoomLink: bookingData.zoom_link,
        });

        // Mark reminder as sent
        await supabase
          .from("bookings")
          .update({ reminder_sent: true })
          .eq("id", bookingData.id);

        console.log(`✅ Reminder marked as sent for booking ID ${bookingData.id}`);
      }
    }

    return res.status(200).json({ message: "Reminders checked and sent where needed." });
  } catch (err) {
    console.error("Error in send-reminders:", err);
    return res.status(500).json({ error: err.message });
  }
}
