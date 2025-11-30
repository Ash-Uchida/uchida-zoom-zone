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

  // Update Supabase
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

  // Update Supabase
  await supabase.from("integrations").upsert({
    id: "zoom",
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    updated_at: new Date().toISOString(),
  });

  return tokenData.access_token;
}

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

    // Basic presence validation
    if (!name || !email || !date || !time)
      return res.status(400).json({ error: "Missing required fields (name, email, date, time)" });

    // Validate duration
    const dur = Number(duration) || 15;
    if (!Number.isFinite(dur) || dur <= 0) return res.status(400).json({ error: "Invalid duration" });

    // Validate date (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }

    // Validate time (HH:MM 24-hour)
    if (!isValidHHMM(time)) {
      return res.status(400).json({ error: "Invalid time format. Use 24-hour HH:MM" });
    }

    // Construct a Date from the date and time parts and ensure it's valid
    const [hourStr, minStr] = time.split(":");
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7)) - 1; // JS months 0-11
    const day = Number(date.slice(8, 10));
    const hour = Number(hourStr);
    const minute = Number(minStr);

    const startDate = new Date(year, month, day, hour, minute, 0, 0);
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Invalid date or time values" });
    }

    const dateTimeISO = startDate.toISOString();
    const endDateISO = new Date(startDate.getTime() + dur * 60000).toISOString();

    // ---------------------------
    // 2️⃣ Fetch tokens from Supabase
    // ---------------------------
    const { data: tokensData, error: tokensError } = await supabase.from("integrations").select("*");
    if (tokensError) throw new Error("Failed to fetch integrations: " + JSON.stringify(tokensError));

    let zoom = tokensData.find((t) => t.id === "zoom");
    let google = tokensData.find((t) => t.id === "google");
    if (!zoom || !google) return res.status(500).json({ error: "Missing Zoom or Google tokens" });

    // ---------------------------
    // 3️⃣ Create Zoom meeting (with requested duration)
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
          type: 2, // scheduled meeting
          start_time: dateTimeISO,
          duration: dur,
        }),
      });
      return await zoomRes.json();
    };

    let zoomData = await createZoomMeeting(zoomAccessToken);

    // If Zoom token expired or invalid, try refresh
    if ((!zoomData.join_url && zoomData.code) || (zoomData.code === 124 || zoomData.code === 1241)) {
      zoomAccessToken = await refreshZoomToken(zoom.refresh_token);
      zoomData = await createZoomMeeting(zoomAccessToken);
    }

    if (!zoomData.join_url)
      return res.status(500).json({ error: "Zoom meeting creation failed", details: zoomData });

    // ---------------------------
    // 4️⃣ Create Google Calendar event (with endTime)
    // ---------------------------
    let googleAccessToken = google.access_token;
    let googleRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `Zoom Meeting with ${name}`,
        start: { dateTime: dateTimeISO },
        end: { dateTime: endDateISO },
        attendees: [{ email }],
        description: `Join Zoom: ${zoomData.join_url}`,
      }),
    });

    if (!googleRes.ok) {
      // Refresh Google token if needed
      googleAccessToken = await refreshGoogleToken(google.refresh_token);
      googleRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json",
        },
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
    if (!googleData.id)
      return res.status(500).json({ error: "Google Calendar event failed", details: googleData });

    // ---------------------------
    // 5️⃣ Save booking to Supabase
    // ---------------------------
    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .insert([
        {
          name,
          email,
          time: dateTimeISO,
          end_time: endDateISO,
          duration: dur,
          zoom_link: zoomData.join_url,
          created_at: new Date().toISOString(),
        },
      ])
      .select(); // return inserted row

    if (bookingError)
      return res.status(500).json({ error: "Failed to save booking", details: bookingError });

    // ---------------------------
    // 6️⃣ Send emails
    // ---------------------------
    await sendBookingEmails({
      name,
      email,
      dateTimeISO,
      zoomLink: zoomData.join_url,
      duration: dur,
    });

    // ---------------------------
    // 7️⃣ Respond
    // ---------------------------
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
