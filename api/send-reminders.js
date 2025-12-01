import { google } from "googleapis";

export default async function handler(req, res) {
  console.log("🔔 send-reminders triggered");

  try {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (!email || !key) {
      console.log("❌ Missing Google credentials");
      return res.status(500).json({ error: "Missing Google credentials" });
    }

    const jwtClient = new google.auth.JWT(
      email,
      null,
      key,
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );

    const calendar = google.calendar({ version: "v3", auth: jwtClient });

    const now = new Date();
    const in15 = new Date(now.getTime() + 15 * 60 * 1000);

    console.log("⏱ Now:", now.toISOString());
    console.log("⏱ 15 minutes from now:", in15.toISOString());

    const events = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: in15.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    console.log("📅 Google events pulled:", events.data.items.length);

    const reminders = events.data.items.filter((e) => {
      if (!e.start?.dateTime) return false;

      const eventStart = new Date(e.start.dateTime);
      const diffMs = eventStart - now;
      const diffMin = Math.round(diffMs / 60000);

      console.log(
        `Event: ${e.summary} — starts in ${diffMin} minutes`
      );

      return diffMin === 15;
    });

    console.log("🔎 Events needing reminders:", reminders.length);

    if (reminders.length === 0) {
      return res.status(200).json({ message: "No reminders due" });
    }

    for (const event of reminders) {
      console.log("📧 Would send reminder for:", event.summary);
      // Insert your real email code here (Resend, SendGrid, Gmail API, etc.)
    }

    res.status(200).json({ sent: reminders.length });
  } catch (err) {
    console.error("❌ send-reminders failed:", err);
    res.status(500).json({ error: err.message });
  }
}
