// api/send-reminders.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function sendReminderEmail({ name, email, dateTime, zoomLink, duration }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const dateTimeStr = new Date(dateTime).toLocaleString();

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Reminder: Zoom Zone Meeting in 15 minutes`,
    html: `<p>Hi ${name},</p>
           <p>This is a reminder that your meeting starts at <strong>${dateTimeStr}</strong> and lasts <strong>${duration} minutes</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Zoom Zone</p>`,
  });
}

export default async function handler(req, res) {
  // Check cron secret
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const now = new Date();
    const reminderWindowStart = new Date(now.getTime() + 14 * 60 * 1000); // 14 minutes from now
    const reminderWindowEnd = new Date(now.getTime() + 16 * 60 * 1000); // 16 minutes from now

    // Fetch bookings happening in ~15 minutes
    const { data: bookings, error } = await supabase
      .from("bookings")
      .select("*")
      .gte("time", reminderWindowStart.toISOString())
      .lte("time", reminderWindowEnd.toISOString());

    if (error) throw error;

    // Send reminders
    for (const booking of bookings) {
      await sendReminderEmail({
        name: booking.name,
        email: booking.email,
        dateTime: booking.time,
        zoomLink: booking.zoom_link,
        duration: booking.duration,
      });
    }

    return new Response(JSON.stringify({ message: "Reminders sent", count: bookings.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error sending reminders:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
