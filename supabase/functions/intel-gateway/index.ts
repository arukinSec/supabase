import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0"

// CORS headers to allow browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Initialize Supabase Client with the user's Auth JWT from the request header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // 2. Cryptographically verify the user's session
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    // 3. Fetch the user's exact tier and encrypted OAuth token from the database
    // This bypasses the client completely, preventing manipulation!
    const { data: profile, error: dbError } = await supabaseClient
      .from('profiles')
      .select('tier, access_token')
      .eq('id', user.id)
      .single()

    if (dbError) throw new Error('Failed to retrieve user profile')

    const tier = profile?.tier || 'FREE'
    const googleToken = profile?.access_token

    if (!googleToken) {
       return new Response(JSON.stringify({ error: 'Google Account not connected.' }), {
         status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
       })
    }

    // 4. Parse the requested intelligence scan
    const { scanType, query } = await req.json()

    // 5. ENFORCE STRICT ROLE-BASED ACCESS CONTROL (RBAC)
    if (scanType === 'financial' && tier !== 'PRO') {
      return new Response(
        JSON.stringify({ error: 'Financial footprints are locked behind the PRO tier.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (scanType === 'drive' && tier !== 'PRO') {
      return new Response(
        JSON.stringify({ error: 'Drive intelligence is locked behind the PRO tier.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Execute the Google API Call Server-Side
    const googleRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`, {
      headers: { Authorization: `Bearer ${googleToken}` }
    })

    if (!googleRes.ok) throw new Error('Failed to query Google API')
    
    const data = await googleRes.json()
    const estimate = data.resultSizeEstimate || 0

    // 7. Payload Stripping: Only return high-fidelity data to PRO users
    const responsePayload = {
      detected: estimate > 0,
      details: tier === 'PRO' ? `~${estimate} traces` : (estimate > 0 ? 'Present' : 'Not Found')
    }

    return new Response(
      JSON.stringify(responsePayload),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
