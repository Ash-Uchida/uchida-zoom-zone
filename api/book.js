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

  const dateTimeStr = new Date(dateTime).toLocaleString("en-US", {
    timeZone: "America/Denver",
    dateStyle: "short",
    timeStyle: "short",
  });

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

  // Email to owner
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${dateTimeStr}`,
    html: `<p>New meeting booked by <strong>${name}</strong> (${email})</p>
           <p>Scheduled for <strong>${dateTimeStr}</strong> for <strong>${duration} minutes</strong>.</p>
           <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>`,
  });
}

// ---- Helper to convert Date to local ISO without Z ----
function toLocalISOString(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 19);
}

// ---- API handler ----
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, date, time, duration = 15 } = req.body;
    if (!name || !email || !date || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [hour, minute] = time.split(":").map(Number);
    const dateTime = new Date(date);
    dateTime.setHours(hour, minute, 0, 0);
    const endTime = new Date(dateTime.getTime() + Number(duration) * 60000);

    // ---- Fetch Google & Zoom tokens ----
    const { data: tokensData } = await supabase.from("integrations").select("*");
    const zoom = tokensData.find((t) => t.id === "zoom");
    const google = tokensData.find((t) => t.id === "google");
    if (!zoom || !google)
      return res.status(500).json({ error: "Missing Zoom or Google tokens" });

    let googleAccessToken = google.access_token;
    let zoomAccessToken = zoom.access_token;

    // ---- Create Zoom meeting ----
    const createZoomMeeting = async (token) => {
      const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `Meeting with ${name}`,
          type: 2,
          start_time: dateTime.toISOString(),
          duration: Number(duration),
        }),
      });
      return await zoomRes.json();
    };

    let zoomData = await createZoomMeeting(zoomAccessToken);
    if (!zoomData.join_url) {
      // optionally refresh token here if expired
      return res.status(500).json({ error: "Zoom meeting creation failed", details: zoomData });
    }

    // ---- Create Google Calendar event ----
    const timezone = "America/Denver";
    const googleRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: `Zoom Meeting with ${name}`,
          start: { dateTime: toLocalISOString(dateTime), timeZone: timezone },
          end: { dateTime: toLocalISOString(endTime), timeZone: timezone },
          attendees: [{ email }],
          description: `Join Zoom: ${zoomData.join_url}`,
        }),
      }
    );
    const googleData = await googleRes.json();
    if (!googleData.id)
      return res.status(500).json({ error: "Google Calendar event failed", details: googleData });

    // ---- Save booking to Supabase ----
    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .insert([
        {
          name,
          email,
          time: dateTime.toISOString(),
          end_time: endTime.toISOString(),
          duration: Number(duration),
          zoom_link: zoomData.join_url,
          created_at: new Date().toISOString(),
          reminder_sent: false,
        },
      ])
      .select();

    if (bookingError)
      return res.status(500).json({ error: "Failed to save booking", details: bookingError });

    // ---- Send confirmation emails ----
    await sendBookingEmails({
      name,
      email,
      dateTime: dateTime.toISOString(),
      zoomLink: zoomData.join_url,
      duration: Number(duration),
    });

    return res.status(200).json({
      message: "Booking successful!",
      zoomLink: zoomData.join_url,
      googleEventId: googleData.id,
      supabaseBookingId: bookingData[0].id,
    });
  } catch (err) {
    console.error("Unexpected /api/book error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
