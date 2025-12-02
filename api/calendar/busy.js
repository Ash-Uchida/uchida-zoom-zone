// /api/calendar/busy.js
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // frontend-safe anon key
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Missing 'date' query parameter" });

    const selectedDate = new Date(date);
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Fetch Google integration tokens from Supabase
    const { data, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('id', 'google')
      .single();

    if (error || !data) throw new Error(error?.message || 'No Google integration found');

    const { access_token, refresh_token } = data;

    // Set up OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ access_token, refresh_token });

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // Fetch busy events for the selected date
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    // Map events to busy times format expected by frontend
    const busyTimes = events.map(event => ({
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
    }));

    // Return as an object so frontend can do `data.busyTimes`
    return res.status(200).json({ busyTimes });

  } catch (err) {
    console.error('Error fetching busy times:', err);
    return res.status(500).json({ error: err.message });
  }
}
