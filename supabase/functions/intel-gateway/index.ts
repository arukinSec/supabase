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
    const jwt = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt)
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
    const { scanType, query, memberId, deepScan } = await req.json()

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
    let activeToken = googleToken;
    let googleRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`, {
      headers: { Authorization: `Bearer ${activeToken}` }
    })

    // Token Expired Auto-Refresh Logic
    if (googleRes.status === 401) {
       const { data: memberFull } = await supabaseAdmin
         .from('members')
         .select('google_refresh_token')
         .eq('id', memberId)
         .single()
         
       if (memberFull?.google_refresh_token) {
          const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
          const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
          
          if (clientId && clientSecret) {
             const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
               method: 'POST',
               headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
               body: new URLSearchParams({
                 client_id: clientId,
                 client_secret: clientSecret,
                 refresh_token: memberFull.google_refresh_token,
                 grant_type: 'refresh_token',
               }),
             });
             
             if (tokenRes.ok) {
                const tokenData = await tokenRes.json();
                activeToken = tokenData.access_token;
                
                // Save new token
                await supabaseAdmin
                  .from('members')
                  .update({ access_token: activeToken, updated_at: new Date().toISOString() })
                  .eq('id', memberId);
                  
                // Retry request
                googleRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`, {
                  headers: { Authorization: `Bearer ${activeToken}` }
                })
             }
          }
       }
    }

    if (!googleRes.ok) {
       const text = await googleRes.text()
       throw new Error(`Gmail API Error: ${text}`)
    }

    const data = await googleRes.json()
    const detected = data.resultSizeEstimate > 0 || (data.messages && data.messages.length > 0)
    const volume = data.resultSizeEstimate || 0;

    // --- DEEP SCAN LOGIC ---
    if (deepScan && detected) {
      if (tier !== 'PRO') {
         return new Response(JSON.stringify({
            detected,
            volume,
            locked: true,
            details: 'Deep scan locked behind PRO tier.'
         }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // PRO deep scan
      let latestSubject = 'No subject';
      let lastActive = 'Unknown';
      let securityFlags = [];

      // 1. Fetch latest message metadata
      if (data.messages && data.messages.length > 0) {
         const msgId = data.messages[0].id;
         const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`, {
           headers: { Authorization: `Bearer ${activeToken}` }
         });
         if (msgRes.ok) {
            const msgData = await msgRes.json();
            const headers = msgData.payload?.headers || [];
            latestSubject = headers.find((h: {name: string, value: string}) => h.name.toLowerCase() === 'subject')?.value || latestSubject;
            lastActive = headers.find((h: {name: string, value: string}) => h.name.toLowerCase() === 'date')?.value || lastActive;
         }
      }

      // 2. Check for security flags (Password resets, alerts)
      const secQuery = `(${query}) AND (subject:password OR subject:reset OR subject:alert OR subject:login OR subject:verification OR subject:security)`;
      const secRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(secQuery)}&maxResults=1`, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      if (secRes.ok) {
         const secData = await secRes.json();
         if (secData.resultSizeEstimate > 0) {
            securityFlags.push("Recent security or login alerts detected");
         }
      }
      
      // 3. Check for billing (invoices, receipts)
      const billingQuery = `(${query}) AND (subject:receipt OR subject:invoice OR subject:payment OR subject:subscription OR subject:order)`;
      const billingRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(billingQuery)}&maxResults=1`, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      if (billingRes.ok) {
         const billData = await billingRes.json();
         if (billData.resultSizeEstimate > 0) {
            securityFlags.push("Billing or subscription records found");
         }
      }

      return new Response(JSON.stringify({
         detected,
         volume,
         locked: false,
         latestSubject,
         lastActive,
         securityFlags,
         details: 'Deep scan complete.'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(
      JSON.stringify({ 
        detected, 
        volume,
        details: detected ? `Detected artifacts in communication history.` : 'No footprint detected.' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
