// /api/book.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

    const google = tokensData.find(t => t.id === "google");
    const zoom = tokensData.find(t => t.id === "zoom");

    if (!google || !zoom) {
      return res.status(500).json({ error: "Missing Google or Zoom tokens" });
    }

    // 1️⃣ Create Zoom Meeting
    const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${zoom.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        topic: `Meeting with ${name}`,
        type: 2, // scheduled meeting
        start_time: `${date}T${time}:00`,
        duration: 30
      })
    });

    const zoomData = await zoomRes.json();
    console.log("Zoom API response:", zoomData);

    if (!zoomData.join_url) {
      return res.status(500).json({ error: "Zoom meeting creation failed", details: zoomData });
    }

    // 2️⃣ Create Google Calendar event
    const googleRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${google.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          summary: `Meeting with ${name}`,
          start: { dateTime: `${date}T${time}:00` },
          end: { dateTime: `${date}T${time}:30` },
          attendees: [{ email }],
          description: `Zoom Link: ${zoomData.join_url}`
        })
      }
    );

    const googleData = await googleRes.json();
    console.log("Google Calendar API response:", googleData);

    return res.status(200).json({
      message: "Booking successful!",
      zoomLink: zoomData.join_url,
      googleEventId: googleData.id
    });
  } catch (err) {
    console.error("Unexpected error in /api/book:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
