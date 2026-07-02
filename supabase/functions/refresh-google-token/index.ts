import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { member_id } = await req.json();
    if (!member_id) throw new Error("Missing member_id");

    // Initialize Supabase Client with Service Role (Bypasses RLS to read refresh token)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get the Google Refresh Token from the DB
    const { data: member, error } = await supabase
      .from('members')
      .select('google_refresh_token')
      .eq('id', member_id)
      .single();

    if (error || !member?.google_refresh_token) {
      throw new Error("No google_refresh_token found for this member.");
    }

    // 2. Fetch new access token from Google
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
        throw new Error("Google Client ID or Secret missing in Edge Function secrets.");
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: member.google_refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || "Failed to refresh token from Google.");

    const newAccessToken = tokenData.access_token;

    // 3. Save the new token back to the database
    await supabase
      .from('members')
      .update({ access_token: newAccessToken })
      .eq('id', member_id);

    // 4. Return it to the caller
    return new Response(JSON.stringify({ access_token: newAccessToken }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
