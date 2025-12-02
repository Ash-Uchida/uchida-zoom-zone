// api/send-reminders.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,

  // 🔥 Correct Idaho timezone (MST/MDT automatically handled)
  TIME_ZONE = "America/Boise",
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---- Email helper ----
async function sendReminderEmail({ name, email, time, zoomLink }) {
  // Format the time in local Idaho time for the email
  const timeStr = new Date(time).toLocaleString("en-US", {
    timeZone: TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: `Meeting Reminder - ${timeStr}`,
    html: `<p>Hi ${name},</p>
           <p>This is a reminder for your meeting at <strong>${timeStr}</strong> with Ash.</p>
           <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Ash Uchida</p>`,
  });
}

// ---- Main handler ----
export default async function handler(req, res) {
  try {
    console.log("➡️ Starting reminder check...");

    // 1. Fetch all bookings
    const { data: bookings, error } = await supabase.from("bookings").select("*");

    if (error) {
      console.error("❌ Supabase fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    console.log(`📌 Found ${bookings.length} bookings`);

    // 2. Calculate now and 1-hour window in UTC
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60000);

    console.log(`🕒 Current UTC time: ${now.toISOString()}`);
    console.log(`🕒 Reminder window ends at: ${oneHourFromNow.toISOString()}`);

    // 3. Filter bookings whose UTC start time is within the next hour
    const upcoming = bookings.filter((b) => {
      const startUTC = new Date(b.time).getTime();
      const nowUTC = now.getTime();
      const inWindow = startUTC > nowUTC && startUTC <= nowUTC + 60 * 60000;

      console.log(
        `Booking ID ${b.id}: stored UTC=${b.time}, ` +
        `startUTC=${startUTC}, inWindow=${inWindow}, reminder_sent=${b.reminder_sent}`
      );

      return inWindow && !b.reminder_sent;
    });

    console.log(`⏰ Bookings needing reminders: ${upcoming.length}`);

    const sent = [];
    const failed = [];

    // 4. Send reminders
    for (const booking of upcoming) {
      try {
        console.log(`📨 Sending reminder for booking ID ${booking.id}`);

        await sendReminderEmail({
          name: booking.name,
          email: booking.email,
          time: booking.time,
          zoomLink: booking.zoom_link,
        });

        // Mark as sent
        await supabase
          .from("bookings")
          .update({ reminder_sent: true })
          .eq("id", booking.id);

        sent.push(booking.id);
      } catch (err) {
        console.error("❌ Error sending reminder:", err);
        failed.push({ bookingId: booking.id, error: err.message });
      }
    }

    // Response
    return res.status(200).json({
      message: "Reminder check complete",
      sent,
      failed,
      debugNow: now.toISOString(),
      debugWindowEnd: oneHourFromNow.toISOString(),
      debugUpcomingBookings: upcoming.map((b) => ({
        id: b.id,
        time: b.time,
        reminder_sent: b.reminder_sent,
      })),
    });
  } catch (e) {
    console.error("🔥 SERVER ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
}
