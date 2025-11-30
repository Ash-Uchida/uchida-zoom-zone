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
  const [duration, setDuration] = useState(15); // default duration
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null);

  const handleSelectDate = (date) => {
    if (!date) return;
    const isoDate = date.toISOString().split("T")[0];
    setSelectedDate(date);
    localStorage.setItem("selectedDate", isoDate);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedDate || !time || !name || !email) {
      setStatus("Please fill out all fields.");
      return;
    }

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

          {/* Time Input */}
          <label>
            Meeting Time:
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
            />
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
