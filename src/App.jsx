// src/App.jsx
import { useState, useEffect } from "react";
import "./App.css";
import BookingCalendar from "./BookingCalendar";

// helper: format ISO slot into local HH:MM (24-hour) for sending to backend
function isoToLocalHHMM(iso) {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

// helper: display time nicely in user's locale (e.g., 2:00 PM)
function displayFromISO(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

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
  const [duration, setDuration] = useState(15); // default duration
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null);

  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const handleSelectDate = (date) => {
    if (!date) return;
    const isoDate = date.toISOString().split("T")[0];
    setSelectedDate(date);
    localStorage.setItem("selectedDate", isoDate);
    // clear previous time selection whenever date changes
    setTime("");
  };

  // Fetch available timeslots when selectedDate or duration changes
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
          // ensure slots array contains { iso, busy } and we keep iso
          setAvailableSlots(data.slots);
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

    if (!selectedDate || !time || !name || !email) {
      setStatus("Please fill out all fields.");
      return;
    }

    // time now contains HH:MM (24-hour) as we set option value to iso->local HH:MM
    const dateFormatted = selectedDate.toISOString().split("T")[0];

    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, date: dateFormatted, time, duration }),
      });

      const data = await res.json();
      if (data.error) setStatus("Error: " + data.error);
      else setStatus(`Booking successful! Zoom Link: ${data.zoomLink}`);
    } catch (err) {
      console.error(err);
      setStatus("Something went wrong.");
    }
  };

  // helper to determine if a slot is in the past (based on iso)
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

      {selectedDate instanceof Date && !isNaN(selectedDate) && (
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

          {/* Time Dropdown (generated from API) */}
          <label>
            Meeting Time:
            {loadingSlots ? (
              <div>Loading times...</div>
            ) : availableSlots.length === 0 ? (
              <div>No available times for this date.</div>
            ) : (
              <select value={time} onChange={(e) => setTime(e.target.value)} required>
                <option value="">Select a time</option>
                {availableSlots.map((s) => {
                  // send HH:MM in user's local time to backend
                  const hhmm = isoToLocalHHMM(s.iso); // "14:00"
                  const disabled = s.busy || isPast(s.iso);
                  return (
                    <option key={s.iso} value={hhmm} disabled={disabled}>
                      {displayFromISO(s.iso)} {disabled ? " (unavailable)" : ""}
                    </option>
                  );
                })}
              </select>
            )}
          </label>

          {/* Duration Input */}
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
