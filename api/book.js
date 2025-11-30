// /api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Gmail Email Helper ----
async function sendBookingEmails({ name, email, dateTime, zoomLink }) {
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
  if (data.error) throw new Error("Failed to refresh Google token: " + JSON.stringify(data));

  // Save new access token in Supabase
  await supabase.from("integrations").upsert({
    id: "google",
    access_token: data.access_token,
    refresh_token: refreshToken, // usually doesn't change
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  });

  return data.access_token;
}

// ---- Zoom Token Refresh ----
async function refreshZoomToken(refreshToken) {
  const res = await fetch(
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

  const data = await res.json();
  if (data.error) throw new Error("Failed to refresh Zoom token: " + JSON.stringify(data));

  await supabase.from("integrations").upsert({
    id: "zoom",
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    updated_at: new Date(),
  });

  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, date, time } = req.body;

    if (!name || !email || !date || !time)
      return res.status(400).json({ error: "Missing required fields" });

    const dateTime = new Date(`${date}T${time}:00`).toISOString();

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

    let google = integrations.find((i) => i.id === "google");
    let zoom = integrations.find((i) => i.id === "zoom");

    if (!google || !zoom) return res.status(500).json({ error: "Missing Google or Zoom tokens" });

    // ---------------------------
    // 2️⃣ Refresh tokens if expired
    // ---------------------------
    const now = Math.floor(Date.now() / 1000);
    let googleAccessToken = google.access_token;
    if (!google.expires_at || google.expires_at < now) {
      googleAccessToken = await refreshGoogleToken(google.refresh_token);
    }

    let zoomAccessToken = zoom.access_token;

    // ---------------------------
    // 3️⃣ Create Zoom meeting
    // ---------------------------
    const createZoomMeeting = async (token) => {
      const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: `Meeting with ${name}`,
          type: 2,
          start_time: dateTime,
          duration: 30,
        }),
      });
      return await res.json();
    };

    let zoomData = await createZoomMeeting(zoomAccessToken);
    if (!zoomData.join_url && zoomData.code === 124) {
      zoomAccessToken = await refreshZoomToken(zoom.refresh_token);
      zoomData = await createZoomMeeting(zoomAccessToken);
    }

    if (!zoomData.join_url)
      return res.status(500).json({ error: "Zoom meeting creation failed", details: zoomData });

    // ---------------------------
    // 4️⃣ Create Google Calendar event (keeps working style)
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
          start: { dateTime, timeZone: "America/Boise" },
          end: {
            dateTime: new Date(new Date(dateTime).getTime() + 30 * 60000).toISOString(),
            timeZone: "America/Boise",
          },
          attendees: [{ email }],
        }),
      }
    );

    const googleData = await googleRes.json();

    if (!googleData.id) {
      console.error("Google event error:", googleData);
      return res.status(500).json({ error: "Google Calendar event failed", googleData });
    }

    // ---------------------------
    // 5️⃣ Save booking to Supabase
    // ---------------------------
    const { data: bookingData, error: bookingError } = await supabase.from("bookings").insert(
      [
        {
          name,
          email,
          time: dateTime,
          zoom_link: zoomData.join_url,
          created_at: new Date().toISOString(),
        },
      ],
      { returning: "representation" } // ensures bookingData[0] exists
    );

    if (bookingError) {
      console.error("Supabase insert error:", bookingError);
      return res.status(500).json({ error: "Failed to save booking", details: bookingError });
    }

    const supabaseBookingId = bookingData && bookingData[0] ? bookingData[0].id : null;

    // ---------------------------
    // 6️⃣ Send emails
    // ---------------------------
    await sendBookingEmails({ name, email, dateTime, zoomLink: zoomData.join_url });

    // ---------------------------
    // 7️⃣ Respond
    // ---------------------------
    return res.status(200).json({
      message: "Booking successful!",
      zoomLink: zoomData.join_url,
      googleEventId: googleData.id,
      supabaseBookingId,
    });
  } catch (err) {
    console.error("Unexpected /api/book error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
