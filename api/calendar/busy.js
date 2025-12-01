import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Missing date parameter" });

  try {
    const { data: tokens } = await supabase.from("integrations").select("*").eq("id", "google").single();
    if (!tokens?.access_token) return res.status(500).json({ error: "No Google token found" });

    const startOfDay = new Date(`${date}T00:00:00Z`).toISOString();
    const endOfDay = new Date(`${date}T23:59:59Z`).toISOString();

    const calendarRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startOfDay}&timeMax=${endOfDay}&singleEvents=true&orderBy=startTime`,
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    );

    const data = await calendarRes.json();
    const busyTimes = data.items?.map((event) => ({
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
    })) || [];

    res.status(200).json({ busyTimes });
  } catch (err) {
    console.error("Error fetching busy times:", err);
    res.status(500).json({ error: "Server error", details: String(err) });
  }
}
