// api/send-reminders.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function sendReminderEmail({ name, email, dateTime, zoomLink }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const dateTimeStr = new Date(dateTime).toLocaleString();

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Reminder: Zoom Meeting at ${dateTimeStr}`,
    html: `<p>Hi ${name},</p>
           <p>This is a reminder for your Zoom meeting at <strong>${dateTimeStr}</strong>.</p>
           <p>Join Zoom meeting: <a href="${zoomLink}">${zoomLink}</a></p>
           <p>Thanks,<br/>Zoom Zone</p>`,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { data: reminders, error } = await supabase
      .from("reminders")
      .select("*")
      .lte("reminder_time", new Date().toISOString())
      .eq("sent", false);

    if (error) throw error;

    for (let r of reminders) {
      await sendReminderEmail({
        name: r.name,
        email: r.email,
        dateTime: r.meeting_time,
        zoomLink: r.zoom_link,
      });

      await supabase
        .from("reminders")
        .update({ sent: true })
        .eq("id", r.id);
    }

    return res.status(200).json({ message: `Sent ${reminders.length} reminders` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send reminders", details: String(err) });
  }
}
