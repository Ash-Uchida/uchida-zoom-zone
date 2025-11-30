import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getValidGoogleAccessToken() {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", "google")
    .single();

  if (error || !data) {
    throw new Error("Google integration not found in Supabase");
  }

  const now = Math.floor(Date.now() / 1000);

  // Token still valid → return it
  if (data.expires_at && data.expires_at > now + 60) {
    return data.access_token;
  }

  // Otherwise refresh token
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const newTokens = await refreshRes.json();

  if (!refreshRes.ok) {
    console.error("Google refresh error:", newTokens);
    throw new Error("Failed to refresh Google access token");
  }

  // Save refreshed token back to Supabase
  await supabase.from("integrations").update({
    access_token: newTokens.access_token,
    expires_at: Math.floor(Date.now() / 1000) + newTokens.expires_in,
  }).eq("id", "google");

  return newTokens.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, time } = req.body;

    if (!name || !email || !time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    //
    // 1️⃣ Save booking to Supabase
    //
    const { data: newBooking, error } = await supabase.from("bookings").insert([
      { name, email, time }
    ]);

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to save booking" });
    }

    //
    // 2️⃣ Get a valid Google access token
    //
    const accessToken = await getValidGoogleAccessToken();

    //
    // 3️⃣ Create Google Calendar event
    //
    const eventRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: `Zoom Meeting with ${name}`,
          start: { dateTime: time },
          end: {
            dateTime: new Date(new Date(time).getTime() + 30 * 60000).toISOString(),
          },
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
      booking: newBooking,
      calendarEvent: eventData,
    });

  } catch (err) {
    console.error("Unexpected /api/book error:", err);
    return res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
}
