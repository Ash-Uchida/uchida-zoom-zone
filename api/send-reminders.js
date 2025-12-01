import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 1. Verify CRON_SECRET to prevent public access
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2. Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 3. Connect to Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 4. Find bookings happening 15 minutes from now
  const fifteenMinutesFromNow = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("start_time", fifteenMinutesFromNow);

  if (error) {
    console.error("Database error:", error);
    return res.status(500).json({ error: "Supabase error" });
  }

  if (!bookings || bookings.length === 0) {
    return res.status(200).json({ message: "No reminders to send" });
  }

  // 5. Send emails using Resend
  const resendKey = process.env.RESEND_API_KEY;

  for (const booking of bookings) {
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
        `
      })
    });
  }

  return res.status(200).json({ sent: bookings.length });
}
