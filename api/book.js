// api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { DateTime } from "luxon";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Idaho / Mountain Time
const TIME_ZONE = process.env.TIME_ZONE || "America/Boise";

// ---- Email helper ----
async function sendBookingEmails({ name, email, localTime, zoomLink, duration }) {
  const dateTimeStr = localTime.toLocaleString(DateTime.DATETIME_SHORT);

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  // To participant
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Your Zoom Zone Meeting - ${dateTimeStr}`,
    html: `<p>Hi ${name},</p>
           <p>Your meeting is scheduled for <strong>${dateTimeStr}</strong> and will last <strong>${duration} minutes</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Ash Uchida</p>`,
  });

  // Copy to you
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${dateTimeStr}`,
    html: `<p>New meeting booked by <strong>${name}</strong> (${email})</p>
           <p>Time: <strong>${dateTimeStr}</strong>, duration <strong>${duration} minutes</strong>.</p>
           <p>Zoom: <a href="${zoomLink}">${zoomLink}</a></p>`,
  });
}

// ---- Create Google Calendar event ----
async function createGoogleEvent(token, name, email, startLocal, endLocal, zoomLink) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: `Zoom Meeting with ${name}`,
      start: { dateTime: startLocal.toISO(), timeZone: TIME_ZONE },
      end: { dateTime: endLocal.toISO(), timeZone: TIME_ZONE },
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
      return res.status(400).json({ error: "Missing fields" });

    // Parse time in YOUR time zone
    const [hour, minute] = time.split(":").map(Number);

    const localStart = DateTime.fromISO(date, { zone: TIME_ZONE })
      .set({ hour, minute, second: 0, millisecond: 0 });

    const localEnd = localStart.plus({ minutes: Number(duration) });

    // Convert local → UTC for database + Zoom
    const utcStart = localStart.toUTC();
    const utcEnd = localEnd.toUTC();

    // ---- Fetch tokens ----
    const { data: tokensData, error: tokensError } =
      await supabase.from("integrations").select("*");
    if (tokensError) throw new Error("Failed to fetch integrations");

    const zoomTokenObj = tokensData.find((t) => t.id === "zoom");
    const googleTokenObj = tokensData.find((t) => t.id === "google");

    if (!zoomTokenObj || !googleTokenObj)
      return res.status(500).json({ error: "Missing Zoom or Google tokens" });

    let zoomAccessToken = zoomTokenObj.access_token;
    let googleAccessToken = googleTokenObj.access_token;

    // ---- Create Zoom meeting ----
    async function createZoom() {
      const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${zoomAccessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `Meeting with ${name}`,
          type: 2,
          start_time: utcStart.toISO(), // UTC REQUIRED
          duration,
        }),
      });
      const data = await res.json();
      if (!data.join_url) throw new Error(JSON.stringify(data));
      return data.join_url;
    }

    let zoomLink;
    try {
      zoomLink = await createZoom();
    } catch {
      zoomAccessToken = (await refreshZoomToken(zoomTokenObj.refresh_token)).access_token;
      zoomLink = await createZoom();
    }

    // ---- Google Calendar event ----
    try {
      await createGoogleEvent(googleAccessToken, name, email, localStart, localEnd, zoomLink);
    } catch {
      googleAccessToken = await refreshGoogleToken(googleTokenObj.refresh_token);
      await createGoogleEvent(googleAccessToken, name, email, localStart, localEnd, zoomLink);
    }

    // ---- Save to Supabase (UTC only!) ----
    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .insert([
        {
          name,
          email,
          time: utcStart.toISO(),
          end_time: utcEnd.toISO(),
          duration,
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
      localTime: localStart,
      zoomLink,
      duration,
    });

    return res.status(200).json({
      message: "Booking successful!",
      zoomLink,
      id: bookingData[0].id,
    });
  } catch (err) {
    console.error("BOOK ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
