import express from "express";
import { createEvent } from "./calendar/calendar.js";
import { createZoomMeeting } from "./zoom.js";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// Load Supabase keys
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

router.post("/", async (req, res) => {
  try {
    const { name, email, time } = req.body;

    if (!name || !email || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log("📅 Creating Google event…");

    // 1. Create Google Calendar event
    const googleEvent = await createEvent({
      summary: `Meeting with ${name}`,
      description: `Booking from ${email}`,
      start: {
        dateTime: time,
        timeZone: "America/Phoenix",
      },
      end: {
        dateTime: new Date(new Date(time).getTime() + 30 * 60 * 1000).toISOString(),
        timeZone: "America/Phoenix",
      },
    });

    console.log("📹 Creating Zoom meeting…");

    // 2. Create Zoom meeting
    const zoomMeeting = await createZoomMeeting({
      topic: `Meeting with ${name}`,
      start_time: time,
    });

    const zoom_link = zoomMeeting.join_url;

    console.log("💾 Saving to Supabase…");

    // 3. Save to Supabase
    const { data, error } = await supabase
      .from("bookings")
      .insert({
        name,
        email,
        time,
        zoom_link
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to save booking in Supabase" });
    }

    console.log("✅ Booking saved:", data);

    res.json({
      success: true,
      google_event: googleEvent,
      zoom_link,
      supabase_record: data,
    });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
