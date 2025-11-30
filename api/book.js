// /api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---- Email helper ----
async function sendBookingEmails({ name, email, dateTime, zoomLink }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const formatted = new Date(dateTime).toLocaleString();

  // Email to participant
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Your Zoom Zone Meeting - ${formatted}`,
    html: `<p>Hi ${name},</p>
           <p>Your meeting is scheduled for <strong>${formatted}</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Zoom Zone</p>`,
  });

  // Email to yourself
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${formatted}`,
    html: `<p>New meeting booked by <strong>${name}</strong> (${email})</p>
           <p>Scheduled for <strong>${formatted}</strong>.</p>
           <p>Zoom link: <a href="${zoomLink}">${zoomLink}</a></p>`,
  });
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

    // Combine date + time into ISO timestamp
    const dateTime = new Date(`${date}T${time}:00`).toISOString();

    // ---- Fetch tokens from Supabase ----
    const { data: tokensData, error: tokensError } = await supabase
      .from("integrations")
      .select("*");

    if (tokensError) {
      console.error("Error fetching tokens:", tokensError);
      return res.status(500).json({ error: "Failed to fetch tokens" });
    }

    const google = tokensData.find((t) => t.id === "google");
    const zoom = tokensData.find((t) => t.id === "zoom");

    if (!google || !zoom) {
      return res.status(500).json({ error: "Missing Google or Zoom tokens" });
    }

    // ---- Automatic Zoom token refresh ----
    const { ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;

    const refreshZoomToken = async (refreshToken) => {
      const tokenRes = await fetch(
        `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${refreshToken}`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString(
                "base64"
              ),
          },
        }
      );

      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(JSON.stringify(tokenData));

      // Update Supabase
      await supabase.from("integrations").upsert({
        id: "zoom",
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        updated_at: new Date(),
      });

      return tokenData.access_token;
    };

    // ---- Create Zoom meeting ----
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

    if (!zoomData.join_url) {
      return res.status(500).json({ error: "Zoom meeting creation failed", details: zoomData });
    }

    // ---- Create Google Calendar event ----
    const googleRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${google.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: `Meeting with ${name}`,
          start: { dateTime },
          end: { dateTime: new Date(new Date(dateTime).getTime() + 30 * 60000).toISOString() },
          attendees: [{ email }],
          description: `Zoom Link: ${zoomData.join_url}`,
        }),
      }
    );

    const googleData = await googleRes.json();

    // ---- Save booking to Supabase ----
    const { data: bookingData, error: bookingError } = await supabase.from("bookings").insert([
      {
        name,
        email,
        time: dateTime,
        zoom_link: zoomData.join_url,
      },
    ]);

    if (bookingError) {
      console.error("Supabase insert error:", bookingError);
      return res.status(500).json({ error: "Failed to save booking", details: bookingError });
    }

    // ---- Send emails ----
    await sendBookingEmails({ name, email, dateTime, zoomLink: zoomData.join_url });

    return res.status(200).json({
      message: "Booking successful!",
      zoomLink: zoomData.join_url,
      googleEventId: googleData.id,
    });

  } catch (err) {
    console.error("Unexpected /api/book error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
