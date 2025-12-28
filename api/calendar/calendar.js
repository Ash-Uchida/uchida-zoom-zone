import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Fetch Google OAuth tokens from Supabase
export async function getOAuthClient() {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("id", "google")
    .single();

  if (error || !data) throw new Error("No Google integration found");

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  return oauth2Client;
}

// Google Calendar instance
export async function getCalendar() {
  const auth = await getOAuthClient();
  return google.calendar({ version: "v3", auth });
}
