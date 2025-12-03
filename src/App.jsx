import { useState, useEffect } from "react";
import "./App.css";
import BookingCalendar from "./BookingCalendar";

export default function App() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = localStorage.getItem("selectedDate");
    if (saved) {
      const d = new Date(saved);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  });

  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(15);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const handleSelectDate = (date) => {
    if (!date) return;
    setSelectedDate(date);
    localStorage.setItem("selectedDate", date.toISOString());
    setTime("");
  };

  const generateTimeSlots = (durationMinutes = 15) => {
    if (!selectedDate) return [];
    const slots = [];
    const start = new Date(selectedDate);
    start.setHours(6, 0, 0, 0);
    const end = new Date(selectedDate);
    end.setHours(22, 0, 0, 0);
    const now = new Date();

    let slotTime = new Date(start);
    while (slotTime <= end) {
      if (slotTime > now || slotTime.toDateString() !== now.toDateString()) {
        const hh = slotTime.getHours().toString().padStart(2, "0");
        const mm = slotTime.getMinutes().toString().padStart(2, "0");
        slots.push({ time: `${hh}:${mm}`, iso: slotTime.toISOString() });
      }
      slotTime = new Date(slotTime.getTime() + durationMinutes * 60000);
    }

    return slots;
  };

  const fetchBusyTimes = async () => {
    if (!selectedDate) return [];
    try {
      const dateFormatted = selectedDate.toISOString().split("T")[0];
      const res = await fetch(`/api/calendar/busy?date=${dateFormatted}`);
      if (!res.ok) throw new Error("Failed to fetch busy times");
      const data = await res.json();

      // DEBUG LOG
      console.log("Busy times fetched for", dateFormatted, data.busyTimes);

      // Convert each busy time to a Date object for comparison
      return (data.busyTimes || []).map((bt) => ({
        start: new Date(bt.start),
        end: new Date(bt.end),
      }));
    } catch (err) {
      console.error("Error fetching busy times:", err);
      return [];
    }
  };

  useEffect(() => {
    if (!selectedDate) return;
    setLoadingSlots(true);

    const updateSlots = async () => {
      const busyTimes = await fetchBusyTimes();
      const slots = generateTimeSlots(duration);

      const freeSlots = slots.map((slot) => {
        const [hour, minute] = slot.time.split(":").map(Number);
        const slotStart = new Date(selectedDate);
        slotStart.setHours(hour, minute, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

        // Check if this slot overlaps any busy time
        const isBusy = busyTimes.some((bt) => {
          return slotStart < bt.end && slotEnd > bt.start;
        });

        // DEBUG LOG
        console.log(
          `Slot ${slot.time}: start=${slotStart.toISOString()} end=${slotEnd.toISOString()} busy=${isBusy}`
        );

        return { ...slot, busy: isBusy };
      });

      setAvailableSlots(freeSlots);
      setLoadingSlots(false);
    };

    updateSlots();
    const intervalId = setInterval(updateSlots, 10000); // refresh every 10s
    return () => clearInterval(intervalId);
  }, [selectedDate, duration]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedDate || !time || !name || !email) {
      setStatus("Please fill out all fields.");
      return;
    }

    try {
      const dateFormatted = selectedDate.toISOString().split("T")[0];
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, date: dateFormatted, time, duration }),
      });

      const data = await res.json();
      if (res.status !== 200) setStatus("Error: " + data.error);
      else setStatus(`Booking successful! ID: ${data.supabaseBookingId}`);
    } catch (err) {
      console.error(err);
      setStatus("Something went wrong.");
    }
  };

  return (
    <div className="app-container">
      <h1>Book a Meeting</h1>
      <h2 className="subheading">Select a day to book a meeting</h2>

      <BookingCalendar selectedDate={selectedDate} onSelectDate={handleSelectDate} />

      {selectedDate && (
        <form onSubmit={handleSubmit} className="form-container">
          <h2>Selected: {selectedDate.toDateString()}</h2>

          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            placeholder="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label>
            Meeting Time (MST):
            {loadingSlots ? (
              <div>Loading times...</div>
            ) : availableSlots.length === 0 ? (
              <div>No available times for this date.</div>
            ) : (
              <select value={time} onChange={(e) => setTime(e.target.value)} required>
                <option value="">Select a time</option>
                {availableSlots.map((s) => (
                  <option
                    key={s.iso}
                    value={s.time}
                    disabled={s.busy}
                    style={{ color: s.busy ? "#aaa" : "#000" }}
                  >
                    {s.time} {s.busy ? "(unavailable)" : ""}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label>
            Duration (minutes):
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[15, 30, 45, 60].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="submit-btn">
            Book Meeting
          </button>
        </form>
      )}

      {status && <p className="status">{status}</p>}
    </div>
  );
}
