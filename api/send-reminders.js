import { google } from "googleapis";
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const secret = req.headers.get("authorization");

    if (!secret || secret !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log("❌ Invalid cron secret");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("🔄 Cron job triggered at:", new Date().toISOString());

    // Authenticate service account
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/calendar.readonly"]
    );

    const calendar = google.calendar({ version: "v3", auth });

    // Calculate the time window
    const now = new Date();
    const in15 = new Date(now.getTime() + 15 * 60 * 1000);

    console.log("🔍 Searching Google Calendar for events:");
    console.log("   👉 TimeMin:", now.toISOString());
    console.log("   👉 TimeMax:", in15.toISOString());

    // Query Google Calendar
    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: in15.toISOString(),
      singleEvents: true,
      orderBy: "startTime"
    });

    const events = response.data.items || [];
    console.log(`📅 Found ${events.length} events in next 15 minutes`);

    if (events.length === 0) {
      return NextResponse.json({ message: "No events to notify" });
    }

    const emailsSent = [];

    for (const event of events) {
      console.log("📌 Event:", {
        summary: event.summary,
        start: event.start?.dateTime,
        attendees: event.attendees
      });

      if (!event.attendees || event.attendees.length === 0) {
        console.log("⚠️ No attendees for event, skipping");
        continue;
      }

      // Send a reminder email to each attendee
      for (const attendee of event.attendees) {
        if (!attendee.email) continue;

        const email = attendee.email;
        console.log(`📨 Sending reminder email to: ${email}`);

        const sendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: email,
            subject: `Upcoming Meeting: ${event.summary}`,
            html: `
              <p>Hi there!</p>
              <p>This is a reminder that your Zoom meeting <strong>${event.summary}</strong> starts in 15 minutes.</p>
              <p>See you soon!</p>
              <hr />
              <p>Sent automatically by Ash's Zoom Zone 🔔</p>
            `
          })
        });

        const sendJson = await sendRes.json();
        console.log("📧 Resend API response:", sendJson);

        emailsSent.push(email);
      }
    }

    return NextResponse.json({
      message: "Done",
      emailsSent
    });

  } catch (err) {
    console.error("🔥 ERROR in send-reminders:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
