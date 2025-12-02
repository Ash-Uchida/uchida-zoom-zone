// api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TIME_ZONE = process.env.TIME_ZONE || "America/Denver"; // set your local time zone

// ---- Email helper ----
async function sendBookingEmails({ name, email, dateTime, zoomLink, duration }) {
  const dateTimeStr = new Date(dateTime).toLocaleString("en-US", {
    timeZone: TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  // Email to participant
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Your Zoom Zone Meeting - ${dateTimeStr}`,
    html: `<p>Hi ${name},</p>
           <p>Your meeting is scheduled for <strong>${dateTimeStr}</strong> and will last <strong>${duration} minutes</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Ash Uchida</p>`,
  });

  // Email to owner
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${dateTimeStr}`,
    html: `<p>New meeting booked by <strong>${name}</strong> (${email})</p>
           <p>Scheduled for <strong>${dateTimeStr}</strong> for <strong>${duration} minutes</strong>.</p>
           <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Ash Uchida</p>`,
  });
}

// ---- Convert Date to local ISO for Google Calendar ----
function toLocalISOString(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 19);
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
  return tokenData;
}

// ---- Create Zoom meeting ----
async function createZoomMeeting(token, name, dateTime, duration) {
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: `Meeting with ${name}`,
      type: 2,
      start_time: dateTime.toISOString(), // Zoom uses UTC
      duration,
    }),
  });
  const data = await res.json();
  if (!data.join_url) throw new Error("Zoom meeting creation failed: " + JSON.stringify(data));
  return data.join_url;
}

// ---- Create Google Calendar event ----
async function createGoogleEvent(token, name, email, start, end, zoomLink) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: `Zoom Meeting with ${name}`,
      start: { dateTime: toLocalISOString(start), timeZone: TIME_ZONE },
      end: { dateTime: toLocalISOString(end), timeZone: TIME_ZONE },
      attendees: [{ email }],
      description: `Join Zoom: ${zoomLink}`,
    }),
  });
  const data = await res.json();
  if (!data.id) throw new Error("Google Calendar event creation failed: " + JSON.stringify(data));
  return data.id;
}

// ---- API handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, date, time, duration = 15 } = req.body;
    if (!name || !email || !date || !time)
      return res.status(400).json({ error: "Missing required fields" });

    const [hour, minute] = time.split(":").map(Number);
    const dateTime = new Date(date);
    dateTime.setHours(hour, minute, 0, 0);
    const endTime = new Date(dateTime.getTime() + Number(duration) * 60000);

    // ---- Fetch integration tokens from Supabase ----
    const { data: tokensData, error: tokensError } = await supabase.from("integrations").select("*");
    if (tokensError) throw new Error("Failed to fetch integrations: " + JSON.stringify(tokensError));

    const zoomTokenObj = tokensData.find((t) => t.id === "zoom");
    const googleTokenObj = tokensData.find((t) => t.id === "google");
    if (!zoomTokenObj || !googleTokenObj)
      return res.status(500).json({ error: "Missing Zoom or Google tokens" });

    let zoomAccessToken = zoomTokenObj.access_token;
    let googleAccessToken = googleTokenObj.access_token;

    // ---- Create Zoom meeting ----
    try {
      await createZoomMeeting(zoomAccessToken, name, dateTime, Number(duration));
    } catch (err) {
      zoomAccessToken = (await refreshZoomToken(zoomTokenObj.refresh_token)).access_token;
    }
    const zoomLink = await createZoomMeeting(zoomAccessToken, name, dateTime, Number(duration));

    // ---- Create Google Calendar event ----
    try {
      await createGoogleEvent(googleAccessToken, name, email, dateTime, endTime, zoomLink);
    } catch (err) {
      googleAccessToken = await refreshGoogleToken(googleTokenObj.refresh_token);
      await createGoogleEvent(googleAccessToken, name, email, dateTime, endTime, zoomLink);
    }

    // ---- Save booking in Supabase ----
    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .insert([
        {
          name,
          email,
          time: dateTime.toISOString(), // store UTC
          end_time: endTime.toISOString(),
          duration: Number(duration),
          zoom_link: zoomLink,
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
      zoomLink,
      duration: Number(duration),
    });

    return res.status(200).json({
      message: "Booking successful!",
      zoomLink,
      supabaseBookingId: bookingData[0].id,
    });
  } catch (err) {
    console.error("Unexpected /api/book error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
