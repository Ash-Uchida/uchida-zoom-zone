// src/BookingCalendar.jsx
import React from "react";

export default function BookingCalendar({ selectedDate, onSelectDate }) {
  const today = new Date();
  const days = Array.from({ length: 30 }).map((_, i) => {
    const day = new Date();
    day.setDate(today.getDate() + i);
    return day;
  });

  return (
    <div className="calendar">
      {days.map((day) => (
        <button
          key={day.toISOString()}
          className={`day-button ${
            selectedDate && day.toDateString() === selectedDate.toDateString()
              ? "selected"
              : ""
          }`}
          onClick={() => onSelectDate(day)}
        >
          {day.getDate()}/{day.getMonth() + 1}
          {/* Removed busy text entirely */}
        </button>
      ))}
    </div>
  );
}
