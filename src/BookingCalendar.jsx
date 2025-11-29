import React from "react";

export default function BookingCalendar({ selectedDate, onSelectDate }) {
  const [currentMonth, setCurrentMonth] = React.useState(new Date());

  const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const daysInMonth = Array.from({ length: endOfMonth.getDate() }, (_, i) =>
    new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i + 1)
  );

  const handlePrevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <button onClick={handlePrevMonth}>◀</button>
        <h3>{currentMonth.toLocaleString("default", { month: "long", year: "numeric" })}</h3>
        <button onClick={handleNextMonth}>▶</button>
      </div>

      <div className="calendar-grid">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
          <div key={d} className="calendar-day-label">{d}</div>
        ))}

        {daysInMonth.map(date => {
          const isSelected = selectedDate && date.toISOString().split("T")[0] === selectedDate.toISOString().split("T")[0];

          return (
            <div
              key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`}
              className={`calendar-day ${isSelected ? "selected" : ""}`}
              onClick={() => onSelectDate(date)}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
