// api/calendar/timeslots.js
import { getCalendar } from "./calendar.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Generate time slots
function generateSlots(date, duration) {
  const startHour = 9;
  const endHour = 17;

  const out = [];
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  const startDay = new Date(y, m, d, startHour, 0, 0);
  const endDay = new Date(y, m, d, endHour, 0, 0);

  for (let t = new Date(startDay); t < endDay; t = new Date(t.getTime() + duration * 60000)) {
    const iso = t.toISOString();
    const time = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    out.push({ iso, time, busy: false });
  }

  return out;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { date, duration } = req.query;

    if (!date) return res.status(400).json({ error: "Missing date" });

    const d = new Date(date + "T00:00:00");
    const dur = Number(duration) || 15;

    let slots = generateSlots(d, dur);

    // 1. Get busy times from Google Calendar
    const calendar = await getCalendar();
    const gcal = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).toISOString(),
        timeMax: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0).toISOString(),
        items: [{ id: "primary" }],
      },
    });

    const busyBlocks = gcal.data.calendars.primary.busy || [];

    // Mark Google busy slots
    slots = slots.map((s) => {
      for (const block of busyBlocks) {
        if (new Date(s.iso) >= new Date(block.start) && new Date(s.iso) < new Date(block.end)) {
          return { ...s, busy: true };
        }
      }
      return s;
    });

    // 2. Get booked slots from Supabase
    const { data: bookings } = await supabase
      .from("bookings")
      .select("*")
      .eq("date", date);

    if (bookings) {
      for (const booking of bookings) {
        const bookedISO = new Date(`${booking.date}T${booking.time}`);
        slots = slots.map((s) =>
          Math.abs(new Date(s.iso) - bookedISO) < dur * 60000
            ? { ...s, busy: true }
            : s
        );
      }
    }

    return res.status(200).json({ slots });
  } catch (err) {
    console.error("Timeslot API error:", err);
    res.status(500).json({ error: "Failed to load time slots", details: String(err) });
  }
}
