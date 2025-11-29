import { getCalendar } from "./calendar.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const calendar = await getCalendar();

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date().toISOString(),
        timeMax: new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        items: [{ id: "primary" }],
      },
    });

    res.status(200).json(response.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch free/busy", details: String(err) });
  }
}
