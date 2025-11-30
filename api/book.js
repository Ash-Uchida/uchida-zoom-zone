// api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Email helper ----
async function sendBookingEmails({ name, email, dateTimeISO, zoomLink, duration }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const dateTimeStr = new Date(dateTimeISO).toLocaleString();

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Your Zoom Zone Meeting - ${dateTimeStr}`,
    html: `<p>Hi ${name},</p>
           <p>Your meeting is scheduled for <strong>${dateTimeStr}</strong> and will last <strong>${duration} minutes</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Zoom Zone</p>`,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${dateTimeStr}`,
    html: `<p>New meeting booked by <strong>${name}</strong> (${email})</p>
           <p>Scheduled for <strong>${dateTimeStr}</strong> for <strong>${duration} minutes</strong>.</p>
           <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>`,
  });
}

// ---- Token refresh functions (unchanged) ----
async function refreshGoogleToken(refreshToken) { /* unchanged */ }
async function refreshZoomToken(refreshToken) { /* unchanged */ }

// Validate HH:MM 24-hour string
function isValidHHMM(t) {
  if (typeof t !== "string") return false;
  const m = t.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return !!m;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, date, time, duration = 15 } = req.body;

    if (!name || !email || !date || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }

    if (!isValidHHMM(time)) {
      return res.status(400).json({ error: "Invalid time format. Use HH:MM (24-hour)" });
    }

    const [hourStr, minStr] = time.split(":");
    const hour = Number(hourStr);
    const minute = Number(minStr);

    // Only allow meetings from 6 AM to 10 PM
    if (hour < 6 || hour > 22) {
      return res.status(400).json({ error: "Time must be between 06:00 and 22:00" });
    }

    const startDate = new Date(`${date}T${time}:00`);
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Invalid date or time" });
    }

    const dur = Number(duration) || 15;
    const dateTimeISO = startDate.toISOString();
    const endDateISO = new Date(startDate.getTime() + dur * 60000).toISOString();

    // ---------------------------
    // Fetch Zoom & Google tokens
    // ---------------------------
    const { data: tokensData, error: tokensError } = await supabase.from("integrations").select("*");
    if (tokensError) throw new Error("Failed to fetch integrations: " + JSON.stringify(tokensError));

    let zoom = tokensData.find((t) => t.id === "zoom");
    let google = tokensData.find((t) => t.id === "google");
    if (!zoom || !google) return res.status(500).json({ error: "Missing Zoom or Google tokens" });

    // ---------------------------
    // Create Zoom meeting
    // ---------------------------
    let zoomAccessToken = zoom.access_token;

    const createZoomMeeting = async (token) => {
      const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: `Meeting with ${name}`,
          type: 2,
          start_time: dateTimeISO,
          duration: dur,
        }),
      });
      const data = await zoomRes.json();
      console.log("Zoom API response:", data);
      return data;
    };

    let zoomData = await createZoomMeeting(zoomAccessToken);

    if ((!zoomData.join_url && zoomData.code) || (zoomData.code === 124 || zoomData.code === 1241)) {
      zoomAccessToken = await refreshZoomToken(zoom.refresh_token);
      zoomData = await createZoomMeeting(zoomAccessToken);
    }

    if (!zoomData.join_url) return res.status(500).json({ error: "Zoom meeting creation failed", details: zoomData });

    // ---------------------------
    // Create Google Calendar event
    // ---------------------------
    let googleAccessToken = google.access_token;
    let googleRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${googleAccessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: `Zoom Meeting with ${name}`,
        start: { dateTime: dateTimeISO },
        end: { dateTime: endDateISO },
        attendees: [{ email }],
        description: `Join Zoom: ${zoomData.join_url}`,
      }),
    });

    if (!googleRes.ok) {
      googleAccessToken = await refreshGoogleToken(google.refresh_token);
      googleRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${googleAccessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: `Zoom Meeting with ${name}`,
          start: { dateTime: dateTimeISO },
          end: { dateTime: endDateISO },
          attendees: [{ email }],
          description: `Join Zoom: ${zoomData.join_url}`,
        }),
      });
    }

    const googleData = await googleRes.json();
    if (!googleData.id) return res.status(500).json({ error: "Google Calendar event failed", details: googleData });

    // ---------------------------
    // Save booking in Supabase
    // ---------------------------
    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .insert([{ name, email, time: dateTimeISO, end_time: endDateISO, duration: dur, zoom_link: zoomData.join_url, created_at: new Date().toISOString() }])
      .select();

    if (bookingError) return res.status(500).json({ error: "Failed to save booking", details: bookingError });

    // ---------------------------
    // Send emails
    // ---------------------------
    await sendBookingEmails({ name, email, dateTimeISO, zoomLink: zoomData.join_url, duration: dur });

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
