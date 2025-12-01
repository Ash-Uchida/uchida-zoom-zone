import React, { useEffect, useState } from "react";

export default function BookingCalendar({ selectedDate, onSelectDate }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [busyDates, setBusyDates] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchBusyDates = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/calendar/freebusy");
        const data = await res.json();

        const busy = [];
        if (data.calendars && data.calendars.primary?.busy) {
          data.calendars.primary.busy.forEach(slot => {
            const start = new Date(slot.start);
            busy.push(start.toISOString().split("T")[0]);
          });
        }
        setBusyDates(busy);
      } catch (err) {
        console.error("Failed to fetch busy dates:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchBusyDates();
  }, [currentMonth]);

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

      {loading && <p>Loading availability...</p>}

      <div className="calendar-grid">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
          <div key={d} className="calendar-day-label">{d}</div>
        ))}

        {daysInMonth.map(date => {
          const isoDate = date.toISOString().split("T")[0];
          const isSelected = selectedDate && isoDate === selectedDate.toISOString().split("T")[0];
          const isBusy = busyDates.includes(isoDate);

          return (
            <div
              key={isoDate}
              className={`calendar-day ${isSelected ? "selected" : ""} ${isBusy ? "busy" : ""}`}
              onClick={() => handleSelectDate(date)}
              style={{ cursor: "pointer", opacity: isBusy ? 0.9 : 1 }}
            >
              {date.getDate()}
              {isBusy && <div style={{ fontSize: 10, marginTop: 6 }}>busy</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
