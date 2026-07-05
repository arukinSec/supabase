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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify the caller's JWT (The connected member)
    const jwt = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt);
    if (userError || !user) throw new Error('Unauthorized');

    const { providerToken, providerRefreshToken } = await req.json();

    if (!providerToken) throw new Error("Missing providerToken");

    // Update tokens in public.members using service_role authority
    const { data: updatedMember, error: updateError } = await supabaseAdmin
      .from('members')
      .update({
        access_token: providerToken,
        google_refresh_token: providerRefreshToken || null,
        updated_at: new Date().toISOString()
      })
      .eq('email', user.email.toLowerCase())
      .select()
      .maybeSingle();

    if (updateError) {
      console.error("Token save failed:", updateError);
      throw new Error("Failed to save tokens in database.");
    }

    if (!updatedMember) {
      throw new Error("Member record not found in database.");
    }

    return new Response(JSON.stringify({ success: true, message: "OAuth tokens saved successfully." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Save tokens error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
