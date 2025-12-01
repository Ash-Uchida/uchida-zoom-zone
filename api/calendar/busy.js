// /api/calendar/busy.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: "Missing date query parameter" });
    }

    // Construct start and end timestamps for that day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("bookings")
      .select("time")
      .gte("time", startOfDay.toISOString())
      .lte("time", endOfDay.toISOString());

    if (error) throw error;

    const busyTimes = data.map((booking) => booking.time);

    return res.status(200).json({ busyTimes });
  } catch (err) {
    console.error("Error fetching busy times:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
