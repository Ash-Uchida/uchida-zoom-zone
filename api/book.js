// api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Email helper ----
async function sendBookingEmails({ name, email, dateTime, zoomLink, duration }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const dateTimeStr = new Date(dateTime).toLocaleString();

  // Email to participant
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Your Zoom Zone Meeting - ${dateTimeStr}`,
    html: `<p>Hi ${name},</p>
           <p>Your meeting is scheduled for <strong>${dateTimeStr}</strong> and will last <strong>${duration} minutes</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Zoom Zone</p>`,
  });

  // Email to yourself (owner)
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${dateTimeStr}`,
    html: `<p>New meeting booked by <strong>${name}</strong> (${email})</p>
           <p>Scheduled for <strong>${dateTimeStr}</strong> for <strong>${duration} minutes</strong>.</p>
           <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>`,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, date, time, duration = 15 } = req.body;

    if (!name || !email || !date || !time)
      return res.status(400).json({ error: "Missing required fields" });

    // Validate date/time
    const dateTime = new Date(`${date}T${time}`);
    if (isNaN(dateTime)) return res.status(400).json({ error: "Invalid date or time" });

    const endTime = new Date(dateTime.getTime() + Number(duration) * 60000);

    // Save booking to Supabase
    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .insert([
        {
          name,
          email,
          time: dateTime.toISOString(),
          end_time: endTime.toISOString(),
          duration: Number(duration),
          created_at: new Date().toISOString(),
        },
      ])
      .select(); // return inserted row

    if (bookingError)
      return res.status(500).json({ error: "Failed to save booking", details: bookingError });

    // Send emails
    await sendBookingEmails({
      name,
      email,
      dateTime,
      zoomLink: `https://zoom.us/j/${Math.floor(Math.random() * 1000000000)}`, // placeholder
      duration: Number(duration),
    });

    return res.status(200).json({
      message: "Booking successful!",
      supabaseBookingId: bookingData[0].id,
    });
  } catch (err) {
    console.error("Booking error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
