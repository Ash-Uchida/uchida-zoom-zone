// api/send-reminders.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---- Email helper ----
async function sendReminderEmail({ name, email, time, zoomLink }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  const timeStr = new Date(time).toLocaleString(); // server/local timezone

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: `Meeting Reminder - ${timeStr}`,
    html: `<p>Hi ${name},</p>
           <p>This is a friendly reminder for your meeting scheduled at <strong>${timeStr}</strong> with Ash.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Ash Uchida</p>`,
  });
}

// ---- Main handler ----
export default async function handler(req, res) {
  try {
    console.log("➡️ Starting reminder check...");

    // 1. Get all bookings from Supabase
    const { data: bookings, error } = await supabase.from("bookings").select("*");

    if (error) {
      console.error("❌ Supabase fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    console.log(`📌 Found ${bookings.length} bookings`);

    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60000);

    console.log(`🕒 Current time: ${now.toISOString()}`);
    console.log(`🕒 Reminder window ends at: ${oneHourFromNow.toISOString()}`);

    // 2. Filter bookings starting within the next 1 hour and not yet reminded
    const upcoming = bookings.filter((b) => {
      const start = new Date(b.time); // parse as local time

      console.log(`Booking ID ${b.id}: stored time = ${b.time}, parsed start = ${start.toISOString()}, reminder_sent = ${b.reminder_sent}`);

      return start > now && start <= oneHourFromNow && !b.reminder_sent;
    });

    console.log(`⏰ Bookings needing reminders: ${upcoming.length}`);

    let sent = [];
    let failed = [];

    // 3. Send reminder emails
    for (const booking of upcoming) {
      try {
        console.log(`📨 Sending reminder for booking ID ${booking.id} at ${booking.time}`);

        await sendReminderEmail({
          name: booking.name,
          email: booking.email,
          time: booking.time,
          zoomLink: booking.zoom_link,
        });

        // Mark reminder as sent in Supabase
        await supabase.from("bookings").update({ reminder_sent: true }).eq("id", booking.id);

        sent.push(booking.id);
      } catch (err) {
        console.error("❌ Error sending reminder:", err);
        failed.push({ bookingId: booking.id, error: err.message });
      }
    }

    return res.status(200).json({
      message: "Reminder check complete",
      sent,
      failed,
      debugNow: now.toISOString(),
      debugWindowEnd: oneHourFromNow.toISOString(),
      debugUpcomingBookings: upcoming.map((b) => ({
        id: b.id,
        time: b.time,
        parsedStart: new Date(b.time).toISOString(),
        reminder_sent: b.reminder_sent,
      })),
    });
  } catch (e) {
    console.error("🔥 SERVER ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
}
