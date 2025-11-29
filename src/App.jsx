import { useState, useEffect } from "react";
import "./App.css";
import BookingCalendar from "./BookingCalendar";

export default function App() {
  // Initialize selectedDate safely from localStorage
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = localStorage.getItem("selectedDate");
    if (saved) {
      const d = new Date(saved);
      return isNaN(d.getTime()) ? null : d; // ensure valid Date
    }
    return null;
  });

  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null);

  // Handle date selection from calendar
  const handleSelectDate = (date) => {
    if (!date) return;
    const isoDate = date.toISOString().split("T")[0]; // YYYY-MM-DD
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
        body: JSON.stringify({ name, email, date: dateFormatted, time }),
      });

      const data = await res.json();
      if (data.error) setStatus("Error: " + data.error);
      else setStatus("Booking successful! Zoom Link: " + data.zoomLink);
    } catch (err) {
      console.error(err);
      setStatus("Something went wrong.");
    }
  };

  return (
    <div className="app-container">
      <h1>Book a Meeting</h1>
      <h2 className="subheading">Please press a day to book a meeting</h2>

      {/* Calendar */}
      <BookingCalendar selectedDate={selectedDate} onSelectDate={handleSelectDate} />

      {/* Show form only if a valid date is selected */}
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

          <select value={time} onChange={(e) => setTime(e.target.value)}>
            <option value="">Select a time</option>
            <option value="09:00">9:00 AM</option>
            <option value="10:00">10:00 AM</option>
            <option value="11:00">11:00 AM</option>
            <option value="12:00">12:00 PM</option>
            <option value="13:00">1:00 PM</option>
            <option value="14:00">2:00 PM</option>
            <option value="15:00">3:00 PM</option>
          </select>

          <button type="submit" className="submit-btn">Book Meeting</button>
        </form>
      )}

      {status && <p className="status">{status}</p>}
    </div>
  );
}
