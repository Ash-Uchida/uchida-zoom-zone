// api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Gmail Email Helper ----
async function sendBookingEmails({ name, email, date, time, zoomLink }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const dateTime = `${date} at ${time}`;

  // Email to participant
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Your Zoom Zone Meeting - ${dateTime}`,
    html: `
      <p>Hi ${name},</p>
      <p>Your meeting is scheduled for <strong>${dateTime}</strong>.</p>
      <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
      <p>Thanks,<br/>Zoom Zone</p>
    `,
  });

  // Email to yourself
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${dateTime}`,
    html: `
      <p>New meeting booked by <strong>${name}</strong> (${email})</p>
      <p>Scheduled for <strong>${dateTime}</strong>.</p>
      <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>
    `,
  });
}

// ---- Google Token Refresh ----
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

  if (data.error) {
    console.error("Google refresh error:", data);
    throw new Error("Failed to refresh Google token");
  }

  // Save new tokens
  await supabase.from("integrations").upsert({
    id: "google",
    access_token: data.access_token,
    refresh_token: refreshToken, // Google rarely sends a new refresh token
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  });

  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, date, time } = req.body;

    if (!name || !email || !date || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ---------------------------
    // 1️⃣ Fetch tokens
    // ---------------------------
    const { data: integrations, error: fetchError } = await supabase
      .from("integrations")
      .select("*");

    if (fetchError) {
      console.error("Supabase fetch error:", fetchError);
      return res.status(500).json({ error: "Failed to fetch tokens" });
    }

    const google = integrations.find((i) => i.id === "google");
    const zoom = integrations.find((i) => i.id === "zoom");

    if (!google || !zoom) {
      return res.status(500).json({ error: "Missing Google or Zoom tokens" });
    }

    let googleAccessToken = google.access_token;

    // ---------------------------
    // 2️⃣ Refresh Google token if expired
    // ---------------------------
    const now = Math.floor(Date.now() / 1000);
    if (!google.expires_at || google.expires_at < now) {
      googleAccessToken = await refreshGoogleToken(google.refresh_token);
      console.log("Google token refreshed!");
    }

    // ---------------------------
    // 3️⃣ Create Zoom meeting
    // ---------------------------
    const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${zoom.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: `Meeting with ${name}`,
        type: 2,
        start_time: `${date}T${time}:00`,
        duration: 30,
      }),
    });

    const zoomData = await zoomRes.json();

    if (!zoomData.join_url) {
      return res.status(500).json({ error: "Zoom meeting failed", zoomData });
    }

    // ---------------------------
    // 4️⃣ Create Google Calendar event
    // ---------------------------
    const googleRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: `Meeting with ${name}`,
          description: `Zoom link: ${zoomData.join_url}`,
          start: {
            dateTime: `${date}T${time}:00`,
            timeZone: "America/Boise",
          },
          end: {
            dateTime: `${date}T${time}:30`,
            timeZone: "America/Boise",
          },
          attendees: [{ email }],
        }),
      }
    );

    const googleData = await googleRes.json();

    if (!googleData.id) {
      console.error("Google event error:", googleData);
      return res.status(500).json({
        error: "Google Calendar event failed",
        googleData,
      });
    }

    // ---------------------------
    // 5️⃣ Send emails
    // ---------------------------
    await sendBookingEmails({
      name,
      email,
      date,
      time,
      zoomLink: zoomData.join_url,
    });

    return res.status(200).json({
      message: "Booking successful!",
      zoomLink: zoomData.join_url,
      googleEventId: googleData.id,
    });
  } catch (err) {
    console.error("Unexpected error in /api/book:", err);
    return res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
}
