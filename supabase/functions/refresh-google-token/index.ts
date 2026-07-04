import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { refreshGoogleToken } from "../_shared/google-token.ts";

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

    // 2. Cryptographically verify the logged-in manager's session
    const jwt = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt)
    if (userError || !user) throw new Error('Unauthorized')

    // 3. Verify the manager exists
    const { data: manager, error: dbError } = await supabaseAdmin
      .from('managers')
      .select('id')
      .eq('email', user.email)
      .single()

    if (dbError) throw new Error('Failed to retrieve manager profile')

    const { member_id } = await req.json();
    if (!member_id) throw new Error("Missing member_id");

    // 4. Verify the member belongs to this manager (Security check)
    const { data: memberCheck, error: memberCheckError } = await supabaseAdmin
      .from('members')
      .select('manager_id, google_refresh_token')
      .eq('id', member_id)
      .single();

    if (memberCheckError || !memberCheck) {
      throw new Error("Member not found.");
    }
    
    // STRICT CHECK: the manager can only refresh tokens for their own members
    if (memberCheck.manager_id !== manager.id) {
      throw new Error("Unauthorized to access this member.");
    }

    if (!memberCheck.google_refresh_token) {
      throw new Error("No google_refresh_token found for this member.");
    }

    // 5. Refresh token via shared utility
    await refreshGoogleToken(supabaseAdmin, member_id, memberCheck.google_refresh_token);

    return new Response(JSON.stringify({ success: true, message: "Token refreshed securely." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
