import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, time } = JSON.parse(req.body);

    if (!name || !email || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    //
    // 1️⃣ Save booking to Supabase
    //
    const { data, error } = await supabase.from("bookings").insert([
      {
        name,
        email,
        time,
      },
    ]);

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to save booking" });
    }

    //
    // 2️⃣ Create Google Calendar Event
    //
    const eventRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: `Zoom Meeting with ${name}`,
          start: { dateTime: time },
          end: { dateTime: new Date(new Date(time).getTime() + 30 * 60000) }, // +30 min
        }),
      }
    );

    const eventData = await eventRes.json();

    if (!eventRes.ok) {
      console.error("Google Calendar error:", eventData);
      return res.status(500).json({
        error: "Failed to create Google Calendar event",
        details: eventData,
      });
    }

    return res.status(200).json({
      success: true,
      booking: data,
      calendarEvent: eventData,
    });
  } catch (err) {
    console.error("Unexpected /api/book error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
