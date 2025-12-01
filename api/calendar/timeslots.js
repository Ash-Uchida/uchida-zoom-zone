// api/calendar/timeslots.js
export default async function handler(req, res) {
    try {
      const { date, duration = 15 } = req.query;
  
      if (!date) {
        return res.status(400).json({ error: "Missing date parameter" });
      }
  
      const selectedDate = new Date(date);
      if (isNaN(selectedDate)) {
        return res.status(400).json({ error: "Invalid date" });
      }
  
      const slots = [];
      const startHour = 6;  // 6 AM
      const endHour = 22;   // 10 PM
  
      for (let hour = startHour; hour < endHour; hour++) {
        for (let min = 0; min < 60; min += Number(duration)) {
          const slotDate = new Date(selectedDate);
          slotDate.setHours(hour, min, 0, 0);
  
          slots.push({
            iso: slotDate.toISOString(),
            time: slotDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            busy: false, // We'll mark busy dynamically if needed
          });
        }
      }
  
      return res.status(200).json({ slots });
    } catch (err) {
      console.error("Timeslots error:", err);
      return res.status(500).json({ error: "Server error", details: String(err) });
    }
  }
  