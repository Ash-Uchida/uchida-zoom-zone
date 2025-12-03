// /src/BookingCalendar.jsx

import { useEffect, useState } from "react";

export default function BookingCalendar() {
  const [busySlots, setBusySlots] = useState([]);
  const [selected, setSelected] = useState(null);

  // Fetch busy times (UTC normalized)
  useEffect(() => {
    async function loadBusy() {
      const res = await fetch("/api/calendar/busy-normalized");
      const data = await res.json();

      // Convert UTC to local timezone for the UI
      const local = data.map((slot) => {
        return {
          start: new Date(slot.start), // JS auto converts from UTC → local
          end: new Date(slot.end),
        };
      });

      setBusySlots(local);
    }

    loadBusy();
  }, []);

  // Check if a slot overlaps with busy times
  function isBusySlot(slotStart, slotEnd) {
    return busySlots.some((busy) => {
      return (
        slotStart < busy.end &&
        slotEnd > busy.start
      );
    });
  }

  // Generate time slots (example: every 30 min)
  function generateSlots() {
    const slots = [];
    const base = new Date();
    base.setHours(8, 0, 0, 0); // 8 AM

    for (let i = 0; i < 20; i++) {
      let start = new Date(base.getTime() + i * 30 * 60000);
      let end = new Date(start.getTime() + 30 * 60000);
      slots.push({ start, end });
    }

    return slots;
  }

  const slots = generateSlots();

  return (
    <div style={{ padding: 20 }}>
      <h2>Booking Calendar</h2>

      <div style={{ display: "grid", gap: "10px" }}>
        {slots.map((slot, i) => {
          const busy = isBusySlot(slot.start, slot.end);

          return (
            <button
              key={i}
              disabled={busy}
              onClick={() => setSelected(slot)}
              style={{
                padding: "10px",
                background: busy ? "#ccc" : "#4caf50",
                cursor: busy ? "not-allowed" : "pointer",
                color: "#fff",
                borderRadius: "6px",
              }}
            >
              {slot.start.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </button>
          );
        })}
      </div>

      {selected && (
        <p style={{ marginTop: 20 }}>
          Selected: {selected.start.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
