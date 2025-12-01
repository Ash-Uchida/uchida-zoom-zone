import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 1. Verify CRON_SECRET to prevent public access
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2. Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 3. Connect to Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY // make sure this matches your Vercel env variable
  );

  // 4. Calculate 15 minutes from now
  const now = new Date();
  const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);

  // Optional ±30 seconds window
  const windowStart = new Date(fifteenMinutesFromNow.getTime() - 30000).toISOString();
  const windowEnd = new Date(fifteenMinutesFromNow.getTime() + 30000).toISOString();

  // 5. Query bookings happening 15 minutes from now
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .gte("time", windowStart)
    .lte("time", windowEnd);

  if (error) {
    console.error("Database error:", error);
    return res.status(500).json({ error: "Supabase error" });
  }

  console.log("Bookings found:", bookings?.length || 0);

  if (!bookings || bookings.length === 0) {
    return res.status(200).json({ message: "No reminders to send" });
  }

  // 6. Send emails using Resend
  const resendKey = process.env.RESEND_API_KEY;

  for (const booking of bookings) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Ash’s Zoom Zone <no-reply@yourdomain.com>",
          to: booking.email,
          subject: "Upcoming Zoom Meeting Reminder",
          html: `
            <p>Hi ${booking.name},</p>
            <p>This is a reminder that your Zoom call is in <strong>15 minutes</strong>.</p>
            <p><a href="${booking.zoom_link}">Join Zoom Meeting</a></p>
          `
        })
      });
      console.log(`Reminder sent for booking ${booking.id} to ${booking.email}`);
    } catch (err) {
      console.error("Error sending email for booking:", booking.id, err);
    }
  }

  return res.status(200).json({ sent: bookings.length });
}
