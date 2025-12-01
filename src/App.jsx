// src/App.jsx
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

  // Generate timeslots from 6am to 10pm
  const generateTimeSlots = (durationMinutes = 15) => {
    const slots = [];
    const now = new Date();
    const start = new Date(selectedDate);
    start.setHours(6, 0, 0, 0); // 6:00 AM
    const end = new Date(selectedDate);
    end.setHours(22, 0, 0, 0); // 10:00 PM

    let slotTime = new Date(start);

    while (slotTime <= end) {
      // skip past times if today
      if (slotTime > now || slotTime.toDateString() !== now.toDateString()) {
        const hh = slotTime.getHours().toString().padStart(2, "0");
        const mm = slotTime.getMinutes().toString().padStart(2, "0");
        slots.push({ time: `${hh}:${mm}`, iso: slotTime.toISOString() });
      }
      slotTime = new Date(slotTime.getTime() + durationMinutes * 60000);
    }

    return slots;
  };

  useEffect(() => {
    if (!selectedDate) return;
    setLoadingSlots(true);

    // simulate fetching available slots
    const slots = generateTimeSlots(duration);
    setAvailableSlots(slots);
    setLoadingSlots(false);
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
            Meeting Time:
            {loadingSlots ? (
              <div>Loading times...</div>
            ) : availableSlots.length === 0 ? (
              <div>No available times for this date.</div>
            ) : (
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                step={900} // 15 minutes
                min="06:00"
                max="22:00"
              />
            )}
          </label>

          <label>
            Duration (minutes):
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[15, 30, 45, 60].map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>

          <button type="submit" className="submit-btn">Book Meeting</button>
        </form>
      )}

      {status && <p className="status">{status}</p>}
    </div>
  );
}
