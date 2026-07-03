import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Initialize Supabase Client with the user's Auth JWT from the request header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } })

    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Cryptographically verify the logged-in auditor's session
    const jwt = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt)
    if (userError || !user) throw new Error('Unauthorized')

    // 3. Verify the auditor exists
    const { data: auditor, error: dbError } = await supabaseAdmin
      .from('auditors')
      .select('id')
      .eq('email', user.email)
      .single()

    if (dbError) throw new Error('Failed to retrieve auditor profile')

    const { member_id } = await req.json();
    if (!member_id) throw new Error("Missing member_id");

    // 4. Verify the member belongs to this auditor (Security check)
    const { data: memberCheck, error: memberCheckError } = await supabaseAdmin
      .from('members')
      .select('auditor_id, google_refresh_token')
      .eq('id', member_id)
      .single();

    if (memberCheckError || !memberCheck) {
      throw new Error("Member not found.");
    }
    
    // STRICT CHECK: the auditor can only refresh tokens for their own members
    if (memberCheck.auditor_id !== auditor.id) {
      throw new Error("Unauthorized to access this member.");
    }

    if (!memberCheck.google_refresh_token) {
      throw new Error("No google_refresh_token found for this member.");
    }

    // 5. Fetch new access token from Google
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
        refresh_token: memberCheck.google_refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || "Failed to refresh token from Google.");

    const newAccessToken = tokenData.access_token;

    // 6. Save the new token back to the database
    await supabaseAdmin
      .from('members')
      .update({ 
        access_token: newAccessToken,
        updated_at: new Date().toISOString()
      })
      .eq('id', member_id);

    return new Response(JSON.stringify({ access_token: newAccessToken }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
