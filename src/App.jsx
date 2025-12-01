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
    if (!date || isNaN(date)) return;
    const isoDate = date.toISOString().split("T")[0];
    setSelectedDate(date);
    localStorage.setItem("selectedDate", isoDate);
    setTime(""); // reset time when date changes
  };

  // Fetch available timeslots for selected date
  useEffect(() => {
    const fetchSlots = async () => {
      if (!selectedDate) {
        setAvailableSlots([]);
        return;
      }

      setLoadingSlots(true);
      try {
        const dateFormatted = selectedDate.toISOString().split("T")[0];
        const res = await fetch(`/api/calendar/timeslots?date=${dateFormatted}&duration=${duration}`);
        const data = await res.json();

        if (data?.slots) {
          // Filter slots from 6 AM to 10 PM
          const filtered = data.slots.filter(slot => {
            const hour = Number(slot.time.split(":")[0]);
            return hour >= 6 && hour <= 22;
          });
          setAvailableSlots(filtered);
        } else {
          setAvailableSlots([]);
        }
      } catch (err) {
        console.error("Failed to fetch timeslots:", err);
        setAvailableSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [selectedDate, duration]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!(selectedDate instanceof Date) || isNaN(selectedDate)) {
      setStatus("Please select a valid date.");
      return;
    }

    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
      setStatus("Please select a valid time.");
      return;
    }

    if (!name || !email) {
      setStatus("Please fill out all fields.");
      return;
    }

    const dateFormatted = selectedDate.toISOString().split("T")[0];
    const payload = { name, email, date: dateFormatted, time, duration };
    console.log("Booking payload:", payload);

    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        console.error("Booking error:", data);
        setStatus("Error: " + (data.error || "Unknown error"));
      } else {
        setStatus(`Booking successful! Zoom Link: ${data.zoomLink}`);
      }
    } catch (err) {
      console.error(err);
      setStatus("Something went wrong.");
    }
  };

  const isPast = (iso) => {
    try {
      return new Date(iso) < new Date();
    } catch {
      return false;
    }
  };

  return (
    <div className="app-container">
      <h1>Book a Meeting</h1>
      <h2 className="subheading">Please press a day to book a meeting</h2>

      <BookingCalendar selectedDate={selectedDate} onSelectDate={handleSelectDate} />

      {selectedDate && (
        <form onSubmit={handleSubmit} className="form-container">
          <h2>Selected: {selectedDate.toDateString()}</h2>

          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <input
            type="email"
            placeholder="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label>
            Meeting Time:
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
                    disabled={s.busy || isPast(s.iso)}
                  >
                    {s.time} {s.busy || isPast(s.iso) ? " (unavailable)" : ""}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label>
            Duration (minutes):
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={45}>45</option>
              <option value={60}>60</option>
            </select>
          </label>

          <button type="submit" className="submit-btn">Book Meeting</button>
        </form>
      )}

      {status && <p className="status">{status}</p>}
    </div>
  );
}
