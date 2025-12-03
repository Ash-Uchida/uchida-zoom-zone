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
    subject: `Your Zoom Zone Meeting - ${dateTimeStr} (MST/MDT)`,
    html: `<p>Hi ${name},</p>
           <p>Your meeting is scheduled for <strong>${dateTimeStr}</strong> (MST/MDT) and will last <strong>${duration} minutes</strong>.</p>
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

// ---- Helper to convert Date to local ISO without Z ----
function toLocalISOString(date) {
  const tzOffset = date.getTimezoneOffset() * 60000; // in ms
  const localISO = new Date(date.getTime() - tzOffset).toISOString().slice(0, 19);
  return localISO;
}

// ---- Check for double booking in Google Calendar ----
async function isSlotBusy(googleAccessToken, dateTime, endTime) {
  const startISO = dateTime.toISOString();
  const endISO = endTime.toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startISO}&timeMax=${endISO}&singleEvents=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${googleAccessToken}` },
  });
  const data = await res.json();
  return data.items && data.items.length > 0;
}

// ---- API handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, date, time, duration = 15 } = req.body;
    if (!name || !email || !date || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [hour, minute] = time.split(":").map(Number);
    const dateTime = new Date(date);
    dateTime.setHours(hour, minute, 0, 0);
    const endTime = new Date(dateTime.getTime() + Number(duration) * 60000);

    // Fetch tokens
    const { data: tokensData, error: tokensError } = await supabase.from("integrations").select("*");
    if (tokensError) throw new Error("Failed to fetch integrations: " + JSON.stringify(tokensError));

    const zoom = tokensData.find((t) => t.id === "zoom");
    const google = tokensData.find((t) => t.id === "google");
    if (!zoom || !google) return res.status(500).json({ error: "Missing Zoom or Google tokens" });

    // ---- Check Google Calendar for conflicts ----
    let googleAccessToken = google.access_token;
    let busy = await isSlotBusy(googleAccessToken, dateTime, endTime);
    if (busy) {
      googleAccessToken = await refreshGoogleToken(google.refresh_token);
      busy = await isSlotBusy(googleAccessToken, dateTime, endTime);
    }
    if (busy) {
      return res.status(409).json({ error: "Time slot is already booked in Google Calendar" });
    }

    // ---- Create Zoom meeting ----
    let zoomAccessToken = zoom.access_token;
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
    if ((!zoomData.join_url && zoomData.code) || [124, 1241].includes(zoomData.code)) {
      zoomAccessToken = await refreshZoomToken(zoom.refresh_token);
      zoomData = await createZoomMeeting(zoomAccessToken);
    }
    if (!zoomData.join_url)
      return res.status(500).json({ error: "Zoom meeting creation failed", details: zoomData });

    // ---- Create Google Calendar event ----
    const timezone = "America/Denver"; // replace with your local timezone
    let googleRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${googleAccessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: `Zoom Meeting with ${name}`,
        start: { dateTime: toLocalISOString(dateTime), timeZone: timezone },
        end: { dateTime: toLocalISOString(endTime), timeZone: timezone },
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
          start: { dateTime: toLocalISOString(dateTime), timeZone: timezone },
          end: { dateTime: toLocalISOString(endTime), timeZone: timezone },
          attendees: [{ email }],
          description: `Join Zoom: ${zoomData.join_url}`,
        }),
      });
    }

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
        },
      ])
      .select();

    if (bookingError)
      return res.status(500).json({ error: "Failed to save booking", details: bookingError });

    // ---- Send emails ----
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
