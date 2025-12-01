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

// ---- Google token refresh ----
async function refreshGoogleToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error("Google token refresh failed: " + JSON.stringify(data));

  await supabase.from("integrations").upsert({
    id: "google",
    access_token: data.access_token,
    refresh_token: refreshToken,
    updated_at: new Date().toISOString(),
  });

  return data.access_token;
}

// ---- Zoom token refresh ----
async function refreshZoomToken(refreshToken) {
  const tokenRes = await fetch(
    `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${refreshToken}`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString(
            "base64"
          ),
      },
    }
  );

  const tokenData = await tokenRes.json();
  if (tokenData.error) throw new Error("Zoom token refresh failed: " + JSON.stringify(tokenData));

  await supabase.from("integrations").upsert({
    id: "zoom",
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    updated_at: new Date().toISOString(),
  });

  return tokenData.access_token;
}

// ---- API handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, date, time, duration = 15 } = req.body;

    if (!name || !email || !date || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // --- Build start/end times ---
    const [hours, minutes] = time.split(":").map(Number);
    const startTime = new Date(date);
    startTime.setHours(hours, minutes, 0, 0);

    if (isNaN(startTime.getTime())) {
      return res.status(400).json({ error: "Invalid date or time" });
    }

    const endTime = new Date(startTime.getTime() + duration * 60000).toISOString();

    // --- Fetch integration tokens ---
    const { data: tokensData } = await supabase.from("integrations").select("*");
    let zoom = tokensData.find((t) => t.id === "zoom");
    let google = tokensData.find((t) => t.id === "google");

    if (!zoom || !google) return res.status(500).json({ error: "Missing Zoom or Google tokens" });

    // --- Create Zoom meeting ---
    let zoomAccessToken = zoom.access_token;
    const createZoomMeeting = async (token) => {
      const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `Meeting with ${name}`,
          type: 2,
          start_time: startTime.toISOString(),
          duration: Number(duration),
        }),
      });
      return await zoomRes.json();
    };

    let zoomData = await createZoomMeeting(zoomAccessToken);
    if (!zoomData.join_url) {
      zoomAccessToken = await refreshZoomToken(zoom.refresh_token);
      zoomData = await createZoomMeeting(zoomAccessToken);
    }
    if (!zoomData.join_url) return res.status(500).json({ error: "Zoom meeting creation failed" });

    // --- Create Google Calendar event ---
    let googleAccessToken = google.access_token;
    let googleRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${googleAccessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: `Zoom Meeting with ${name}`,
        start: { dateTime: startTime.toISOString() },
        end: { dateTime: endTime },
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
          start: { dateTime: startTime.toISOString() },
          end: { dateTime: endTime },
          attendees: [{ email }],
          description: `Join Zoom: ${zoomData.join_url}`,
        }),
      });
    }

    const googleData = await googleRes.json();
    if (!googleData.id) return res.status(500).json({ error: "Google Calendar event failed" });

    // --- Save booking to Supabase ---
    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .insert([
        {
          name,
          email,
          time: startTime.toISOString(),
          end_time: endTime,
          duration: Number(duration),
          zoom_link: zoomData.join_url,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (bookingError) return res.status(500).json({ error: "Failed to save booking" });

    // --- Send emails ---
    await sendBookingEmails({
      name,
      email,
      dateTime: startTime.toISOString(),
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
