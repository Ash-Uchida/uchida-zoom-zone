import React, { useEffect, useState } from "react";

export default function BookingCalendar({ selectedDate, onSelectDate }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const daysInMonth = Array.from({ length: endOfMonth.getDate() }, (_, i) =>
    new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i + 1)
  );

  const handlePrevMonth = () =>
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const handleNextMonth = () =>
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const handleSelectDate = (date) => {
    if (!date) return;
    onSelectDate(date);
  };

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <button onClick={handlePrevMonth}>◀</button>
        <h3>{currentMonth.toLocaleString("default", { month: "long", year: "numeric" })}</h3>
        <button onClick={handleNextMonth}>▶</button>
      </div>

      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="calendar-day-label">
            {d}
          </div>
        ))}

        {daysInMonth.map((date) => {
          const isoDate = date.toISOString().split("T")[0];
          const isSelected = selectedDate && isoDate === selectedDate.toISOString().split("T")[0];

          return (
            <div
              key={isoDate}
              className={`calendar-day ${isSelected ? "selected" : ""}`}
              onClick={() => handleSelectDate(date)}
              style={{ cursor: "pointer" }}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
