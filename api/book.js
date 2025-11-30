// /api/book.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
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

  const dateTime = `${date} at ${time}`;

  // Email to participant
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Your Zoom Zone Meeting - ${dateTime}`,
    html: `<p>Hi ${name},</p>
           <p>Your meeting is scheduled for <strong>${dateTime}</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Zoom Zone</p>`,
  });

  // Email to yourself
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `New Booking - ${dateTime}`,
    html: `<p>New meeting booked by <strong>${name}</strong> (${email})</p>
           <p>Scheduled for <strong>${dateTime}</strong>.</p>
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

    // Fetch tokens from Supabase
    const { data: tokensData, error: tokensError } = await supabase
      .from("integrations")
      .select("*");

    if (tokensError) {
      console.error("Error fetching tokens:", tokensError);
      return res.status(500).json({ error: "Failed to fetch tokens" });
    }

    let google = tokensData.find((t) => t.id === "google");
    let zoom = tokensData.find((t) => t.id === "zoom");

    if (!google || !zoom) {
      return res.status(500).json({ error: "Missing Google or Zoom tokens" });
    }

    // ---- Automatic Zoom token refresh ----
    const { ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
    if (!ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
      return res.status(500).json({ error: "Missing Zoom client credentials" });
    }

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

      if (tokenData.error) {
        throw new Error(
          "Failed to refresh Zoom token: " + JSON.stringify(tokenData)
        );
      }

      // Update Supabase with new tokens
      const { error: upsertError } = await supabase.from("integrations").upsert({
        id: "zoom",
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        updated_at: new Date(),
      });

      if (upsertError) {
        console.error("Supabase upsert error:", upsertError);
        throw new Error("Failed to save refreshed Zoom tokens");
      }

      return tokenData.access_token;
    };

    // Try to create Zoom meeting, refresh if fails
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
          start_time: `${date}T${time}:00`,
          duration: 30,
        }),
      });

      return await zoomRes.json();
    };

    let zoomData = await createZoomMeeting(zoomAccessToken);

    // If token expired, refresh and try again
    if (!zoomData.join_url && zoomData.code === 124) {
      zoomAccessToken = await refreshZoomToken(zoom.refresh_token);
      zoomData = await createZoomMeeting(zoomAccessToken);
    }

    if (!zoomData.join_url) {
      return res.status(500).json({
        error: "Zoom meeting creation failed",
        details: zoomData,
      });
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
          start: { dateTime: `${date}T${time}:00` },
          end: { dateTime: `${date}T${time}:30` },
          attendees: [{ email }],
          description: `Zoom Link: ${zoomData.join_url}`,
        }),
      }
    );

    const googleData = await googleRes.json();

    // ---- Send Emails ----
    await sendBookingEmails({ name, email, date, time, zoomLink: zoomData.join_url });

    // ---- Respond to frontend ----
    return res.status(200).json({
      message: "Booking successful!",
      zoomLink: zoomData.join_url,
      googleEventId: googleData.id,
    });
  } catch (err) {
    console.error("Unexpected error in /api/book:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
