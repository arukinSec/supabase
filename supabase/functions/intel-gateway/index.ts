import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0"

// CORS headers to allow browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Cryptographically verify the logged-in auditor's session
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    // 3. Fetch the auditor's exact tier to prevent UI spoofing
    const { data: auditor, error: dbError } = await supabaseAdmin
      .from('auditors')
      .select('tier')
      .eq('email', user.email)
      .single()

    if (dbError) throw new Error('Failed to retrieve auditor profile')

    const tier = auditor?.tier || 'FREE'

    // 4. Parse the requested intelligence scan
    const { scanType, query, memberId } = await req.json()

    if (!memberId) throw new Error('Missing memberId parameter')

    // 5. Fetch the target member's access token from the DB using Admin to bypass RLS
    const { data: member, error: memberError } = await supabaseAdmin
      .from('members')
      .select('access_token')
      .eq('id', memberId)
      .single()
    
    if (memberError || !member?.access_token) {
       return new Response(JSON.stringify({ error: 'Google Account not connected.' }), {
         status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
       })
    }
    
    const googleToken = member.access_token

    // 6. ENFORCE STRICT ROLE-BASED ACCESS CONTROL (RBAC)
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

    // 7. Execute the Google API Call Server-Side
    const googleRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`, {
      headers: { Authorization: `Bearer ${googleToken}` }
    })

    if (!googleRes.ok) {
       const text = await googleRes.text()
       throw new Error(`Gmail API Error: ${text}`)
    }

    const data = await googleRes.json()
    const detected = data.resultSizeEstimate > 0 || (data.messages && data.messages.length > 0)
    
    return new Response(
      JSON.stringify({ 
        detected, 
        details: detected ? `Detected artifacts in communication history.` : 'No footprint detected.' 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
