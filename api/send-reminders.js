// /api/send-reminders.js
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

// 15-minute reminder window
const REMINDER_MINUTES = 15;

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
    const reminderWindowEnd = new Date(now.getTime() + REMINDER_MINUTES * 60000);

    // 2. Filter bookings starting within the next REMINDER_MINUTES
    const upcoming = bookings.filter((b) => {
      const start = new Date(b.start_time);
      return start > now && start <= reminderWindowEnd && !b.reminder_sent;
    });

    console.log(`⏰ Bookings needing reminders: ${upcoming.length}`);

    let sent = [];
    let failed = [];

    for (const booking of upcoming) {
      try {
        console.log(`📨 Processing booking: ${booking.id}, time: ${booking.start_time}`);

        // Fetch the corresponding Google Calendar event
        const event = await calendar.events.get({
          calendarId: "primary",
          eventId: booking.event_id
        });

        if (!event.data) {
          console.warn(`⚠️ Event not found on Google Calendar: ${booking.event_id}`);
          failed.push({ bookingId: booking.id, reason: "Event not found" });
          continue;
        }

        // Send reminder via Google Calendar
        await calendar.events.patch({
          calendarId: "primary",
          eventId: booking.event_id,
          sendUpdates: "all",
          requestBody: {
            reminders: {
              useDefault: false,
              overrides: [{ method: "email", minutes: REMINDER_MINUTES }]
            }
          }
        });

        console.log(`✅ Reminder sent for booking: ${booking.id}`);
        sent.push(booking.id);

        // Mark reminder as sent in Supabase
        await supabase
          .from("bookings")
          .update({ reminder_sent: true })
          .eq("id", booking.id);

      } catch (err) {
        console.error(`❌ Error processing booking ${booking.id}:`, err.message);
        failed.push({ bookingId: booking.id, error: err.message });
      }
    }

    return res.status(200).json({
      message: "Reminder check complete",
      sent,
      failed,
      debugNow: now.toISOString(),
      debugWindowEnd: reminderWindowEnd.toISOString()
    });

  } catch (e) {
    console.error("🔥 SERVER ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
}
