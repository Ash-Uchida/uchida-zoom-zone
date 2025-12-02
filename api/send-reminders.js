import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
const {
  GOOGLE_PRIVATE_KEY,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PROJECT_ID,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} = process.env;

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Google Auth setup
const auth = new google.auth.JWT(
  GOOGLE_CLIENT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/calendar"]
);

const calendar = google.calendar({ version: "v3", auth });

export default async function handler(req, res) {
  try {
    console.log("➡️ Starting reminder check...");

    // 1. Get all bookings from Supabase
    const { data: bookings, error } = await supabase
      .from("bookings")
      .select("*");

    if (error) {
      console.error("❌ Supabase fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    console.log(`📌 Found ${bookings.length} bookings`);

    const now = new Date();
    const tenMinutesFromNow = new Date(now.getTime() + 10 * 60000);

    // 2. Filter bookings starting within the next 10 minutes
    const upcoming = bookings.filter((b) => {
      const start = new Date(b.start_time);
      return start > now && start <= tenMinutesFromNow;
    });

    console.log(`⏰ Bookings needing reminders: ${upcoming.length}`);

    let sent = [];
    let failed = [];

    // 3. Send reminder emails through Google Calendar
    for (const booking of upcoming) {
      try {
        const eventId = booking.event_id;

        console.log(`📨 Sending reminder for event: ${eventId}`);

        await calendar.events.patch({
          calendarId: "primary",
          eventId,
          sendUpdates: "all",
          requestBody: {
            reminders: {
              useDefault: false,
              overrides: [{ method: "email", minutes: 5 }]
            }
          }
        });

        sent.push(eventId);
      } catch (err) {
        console.error("❌ Error sending reminder:", err);
        failed.push({ eventId: booking.event_id, error: err.message });
      }
    }

    return res.status(200).json({
      message: "Reminder check complete",
      sent,
      failed
    });
  } catch (e) {
    console.error("🔥 SERVER ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
}
