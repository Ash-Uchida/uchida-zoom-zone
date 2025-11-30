// api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Email helper ----
async function sendBookingEmails({ name, email, date, time, zoomLink }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const dateTimeStr = `${date} at ${time}`;

  // Email to participant
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Your Zoom Zone Meeting - ${dateTimeStr}`,
    html: `<p>Hi ${name},</p>
           <p>Your meeting is scheduled for <strong>${dateTimeStr}</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Zoom Zone</p>`,
  });

  // Email to yourself
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${dateTimeStr}`,
    html: `<p>New meeting booked by <strong>${name}</strong> (${email})</p>
           <p>Scheduled for <strong>${dateTimeStr}</strong>.</p>
           <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>`,
  });
}

// ---- Google token refresh helper ----
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
    refresh_token: refreshToken, // Google rarely sends a new refresh token
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  });

  return data.access_token;
}

// ---- Zoom token refresh helper ----
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
    updated_at: new Date(),
  });

  return tokenData.access_token;
}

// ---- Main handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, date, time } = req.body;

    if (!name || !email || !date || !time)
      return res.status(400).json({ error: "Missing required fields" });

    // Combine date and time for ISO format
    const dateTime = `${date}T${time}:00`;

    // Fetch tokens from Supabase
    const { data: integrations } = await supabase.from("integrations").select("*");
    const google = integrations.find((i) => i.id === "google");
    const zoom = integrations.find((i) => i.id === "zoom");

    if (!google || !zoom) return res.status(500).json({ error: "Missing Google or Zoom tokens" });

    // ---- Zoom meeting creation ----
    let zoomAccessToken = zoom.access_token;

    const createZoomMeeting = async (token) => {
      const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `Meeting with ${name}`,
          type: 2,
          start_time: dateTime,
          duration: 30,
        }),
      });
      return await zoomRes.json();
    };

    let zoomData = await createZoomMeeting(zoomAccessToken);

    if (!zoomData.join_url && zoomData.code === 124) {
      zoomAccessToken = await refreshZoomToken(zoom.refresh_token);
      zoomData = await createZoomMeeting(zoomAccessToken);
    }

    if (!zoomData.join_url)
      return res.status(500).json({ error: "Zoom meeting creation failed", details: zoomData });

    // ---- Google Calendar creation ----
    let googleAccessToken = google.access_token;
    const googleEventBody = {
      summary: `Zoom Meeting with ${name}`,
      description: `Join Zoom: ${zoomData.join_url}`,
      start: { dateTime, timeZone: "America/Boise" },
      end: { dateTime: `${date}T${time}:30`, timeZone: "America/Boise" },
      attendees: [{ email }],
    };

    let googleRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(googleEventBody),
      }
    );

    if (!googleRes.ok) {
      googleAccessToken = await refreshGoogleToken(google.refresh_token);
      googleRes = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${googleAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(googleEventBody),
        }
      );
    }

    const googleData = await googleRes.json();
    if (!googleData.id)
      return res.status(500).json({ error: "Google Calendar event failed", googleData });

    // ---- Save booking to Supabase ----
    const { data: bookingData, error: bookingError } = await supabase.from("bookings").insert([
      {
        name,
        email,
        time: dateTime,
        zoom_link: zoomData.join_url,
        created_at: new Date(),
      },
    ]);

    if (bookingError) {
      console.error("Supabase insert error:", bookingError);
      return res.status(500).json({ error: "Failed to save booking", details: bookingError });
    }

    // ---- Send emails ----
    await sendBookingEmails({ name, email, date, time, zoomLink: zoomData.join_url });

    // ---- Success response ----
    return res.status(200).json({
      message: "Booking successful!",
      zoomLink: zoomData.join_url,
      googleEventId: googleData.id,
      supabaseBookingId: bookingData[0]?.id,
    });
  } catch (err) {
    console.error("Unexpected /api/book error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
