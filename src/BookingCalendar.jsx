import React, { useEffect, useState } from "react";

export default function BookingCalendar({ selectedDate, onSelectDate }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [busyDates, setBusyDates] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch busy dates from Google Calendar
  useEffect(() => {
    const fetchBusyDates = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/calendar/freebusy");
        const data = await res.json();

        // Extract busy dates as array of ISO strings
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

  const handlePrevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const handleSelectDate = async (date) => {
    const isoDate = date.toISOString().split("T")[0];
    if (busyDates.includes(isoDate)) {
      alert("This date is unavailable!");
      return;
    }

    onSelectDate(date);

    // Automatically create an event in Google Calendar
    try {
      const startDateTime = new Date(date);
      startDateTime.setHours(15, 0, 0); // 3:00 PM default
      const endDateTime = new Date(date);
      endDateTime.setHours(15, 30, 0); // 30-min meeting

      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: "Meeting with Zoom Zone",
          start: startDateTime.toISOString(),
          end: endDateTime.toISOString(),
        }),
      });

      const result = await res.json();
      console.log("Event created:", result);
      alert("Meeting booked successfully!");
    } catch (err) {
      console.error("Failed to create event:", err);
      alert("Failed to book meeting.");
    }
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
              onClick={() => !isBusy && handleSelectDate(date)}
              style={{ cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.5 : 1 }}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
