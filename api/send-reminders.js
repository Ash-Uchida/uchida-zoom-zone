// api/send-reminders.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { DateTime } from "luxon";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,
  TIME_ZONE = "America/Boise", // Idaho default
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---- Email helper ----
async function sendReminderEmail({ name, email, utcTime, zoomLink }) {
  // Convert UTC → Local (MST/MDT automatically)
  const local = DateTime.fromISO(utcTime, { zone: "utc" })
    .setZone(TIME_ZONE)
    .toLocaleString(DateTime.DATETIME_SHORT);

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: `Meeting Reminder - ${local}`,
    html: `<p>Hi ${name},</p>
           <p>This is a reminder for your meeting at <strong>${local}</strong>.</p>
           <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>- Ash Uchida</p>`,
  });
}

// ---- Main handler ----
export default async function handler(req, res) {
  try {
    console.log("➡️ Checking reminders...");

    // 1. Get bookings
    const { data: bookings, error } = await supabase.from("bookings").select("*");

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    console.log(`📌 Total bookings: ${bookings.length}`);

    // Current time in UTC
    const nowUTC = DateTime.utc();
    const windowEnd = nowUTC.plus({ minutes: 60 });

    console.log("🕒 Now (UTC):", nowUTC.toISO());
    console.log("🕒 Window end (UTC):", windowEnd.toISO());

    // 2. Filter bookings happening within 60 minutes
    const upcoming = bookings.filter((b) => {
      const startUTC = DateTime.fromISO(b.time, { zone: "utc" });

      console.log(
        `Booking ${b.id}: stored=${b.time}, asUTC=${startUTC.toISO()}, reminder_sent=${b.reminder_sent}`
      );

      return (
        startUTC > nowUTC &&
        startUTC <= windowEnd &&
        b.reminder_sent === false
      );
    });

    console.log(`⏰ Number needing reminders: ${upcoming.length}`);

    const sent = [];
    const failed = [];

    // 3. Send emails + update DB
    for (const b of upcoming) {
      try {
        await sendReminderEmail({
          name: b.name,
          email: b.email,
          utcTime: b.time,
          zoomLink: b.zoom_link,
        });

        await supabase
          .from("bookings")
          .update({ reminder_sent: true })
          .eq("id", b.id);

        sent.push(b.id);
      } catch (err) {
        console.error("❌ Email send error:", err);
        failed.push({ id: b.id, error: err.message });
      }
    }

    return res.status(200).json({
      message: "Reminder check complete",
      sent,
      failed,
      nowUTC: nowUTC.toISO(),
      windowEnd: windowEnd.toISO(),
      upcoming,
    });
  } catch (err) {
    console.error("🔥 Server error:", err);
    return res.status(500).json({ error: err.message });
  }
}
