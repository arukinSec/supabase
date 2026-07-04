import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0"
import { refreshGoogleToken } from "../_shared/google-token.ts"

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

    // 2. Cryptographically verify the logged-in manager's session
    const jwt = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt)
    if (userError || !user) throw new Error('Unauthorized')

    // 3. Fetch the manager's exact tier to prevent UI spoofing
    const { data: manager, error: dbError } = await supabaseAdmin
      .from('managers')
      .select('id, tier')
      .eq('email', user.email)
      .single()

    if (dbError) throw new Error('Failed to retrieve manager profile')

    const tier = manager?.tier || 'FREE'
    const managerId = user.id

    // 4. Parse the requested intelligence scan
    const { scanType, query, memberId, deepScan, platformId = 'unknown', action } = await req.json()

    if (!memberId) throw new Error('Missing memberId parameter')

    if (action === 'get_usage') {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const { data: usageLogs, error: usageError } = await supabaseAdmin
        .from('scan_executions')
        .select('scan_depth, platform_id, member_id, scan_category')
        .eq('manager_id', managerId)
        .eq('member_id', memberId)
        .gte('created_at', startOfMonth.toISOString());
        
      if (usageError) throw usageError;
      
      return new Response(JSON.stringify({ usage: usageLogs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Determine category and depth based on the incoming request
    const actualScanCategory = scanType === 'social' ? 'SOCIALS' : scanType.toUpperCase(); 
    const actualScanDepth = deepScan ? 'DEEP' : 'SIMPLE';

    // 5. Fetch the target member's access token and tier from the DB using Admin to bypass RLS
    const { data: member, error: memberError } = await supabaseAdmin
      .from('members')
      .select('access_token, tier')
      .eq('id', memberId)
      .single()
    
    if (memberError || !member?.access_token) {
       return new Response(JSON.stringify({ error: 'Google Account not connected.' }), {
         status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
       })
    }
    
    const googleToken = member.access_token
    const memberTier = member.tier || 'FREE'

    // 4b. Enforce Rate Limits via scan_executions
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count, error: countError } = await supabaseAdmin
      .from('scan_executions')
      .select('*', { count: 'exact', head: true })
      .eq('manager_id', managerId)
      .eq('member_id', memberId)
      .eq('scan_category', actualScanCategory)
      .eq('scan_depth', actualScanDepth)
      .eq('platform_id', platformId)
      .gte('created_at', startOfMonth.toISOString());

    if (!countError && count !== null) {
      if (memberTier === 'FREE') {
        if (actualScanDepth === 'DEEP' && count >= 5) {
          return new Response(JSON.stringify({ error: 'Monthly DEEP scan limit reached for this platform. Upgrade to PRO for 10x capacity.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (actualScanDepth === 'SIMPLE' && count >= 2) {
          return new Response(JSON.stringify({ error: 'Monthly SIMPLE scan limit reached for this platform. Upgrade to PRO for 10x capacity.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } else {
        // PRO / TRIAL tier
        if (actualScanDepth === 'DEEP' && count >= 10) {
          return new Response(JSON.stringify({ error: 'Monthly PRO deep scan limit reached for this platform.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (actualScanDepth === 'SIMPLE' && count >= 5) {
          return new Response(JSON.stringify({ error: 'Monthly PRO simple scan limit reached for this platform.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    // Insert usage log (fire and forget conceptually, but we await it for safety)
    const { error: insertError } = await supabaseAdmin.from('scan_executions').insert({
      manager_id: managerId,
      member_id: memberId,
      scan_category: actualScanCategory,
      scan_depth: actualScanDepth,
      platform_id: platformId
    });
    
    if (insertError) {
      console.error("Failed to insert scan_executions log:", insertError);
    }

    // 6. ENFORCE STRICT ROLE-BASED ACCESS CONTROL (RBAC)
    if (scanType === 'financial' && memberTier !== 'PRO' && memberTier !== 'TRIAL') {
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

    // 7. Execute the Google API Call Server-Side with auto-refresh
    let activeToken = googleToken;
    let gmailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`;
    let googleRes = await fetch(gmailUrl, {
      headers: { Authorization: `Bearer ${activeToken}` }
    });

    if (googleRes.status === 401) {
      activeToken = await refreshGoogleToken(supabaseAdmin, memberId);
      googleRes = await fetch(gmailUrl, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
    }

    if (!googleRes.ok) {
       const text = await googleRes.text()
       throw new Error(`Gmail API Error: ${text}`)
    }

    const data = await googleRes.json()
    const detected = data.resultSizeEstimate > 0 || (data.messages && data.messages.length > 0)
    const volume = data.resultSizeEstimate || 0;

    let exactVolume = volume;
    let deepMessages = data.messages || [];

    // --- DEEP SCAN LOGIC ---
    if (deepScan && detected) {
      // To get an exact volume count, query up to 500 results
      const exactRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=500`, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      if (exactRes.ok) {
         const exactData = await exactRes.json();
         deepMessages = exactData.messages || [];
         exactVolume = deepMessages.length;
      }

      if (tier !== 'PRO') {
         return new Response(JSON.stringify({
            detected,
            volume: exactVolume,
            locked: true,
            details: 'Deep scan locked behind PRO tier.'
         }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // PRO deep scan
      let latestSubject = 'No subject';
      let lastActive = 'Unknown';
      let targetAlias = 'Unknown';
      let securityFlags = [];
      let devices = [];
      let locations = [];

      // 1. Fetch latest message metadata (Subject, Date, To)
      if (deepMessages.length > 0) {
         const msgId = deepMessages[0].id;
         const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`, {
           headers: { Authorization: `Bearer ${activeToken}` }
         });
         if (msgRes.ok) {
            const msgData = await msgRes.json();
            const headers = msgData.payload?.headers || [];
            latestSubject = headers.find((h: {name: string, value: string}) => h.name.toLowerCase() === 'subject')?.value || latestSubject;
            lastActive = headers.find((h: {name: string, value: string}) => h.name.toLowerCase() === 'date')?.value || lastActive;
            
            const toHeader = headers.find((h: {name: string, value: string}) => h.name.toLowerCase() === 'to')?.value || '';
            // Extract just the email address from "Name <email@dom.com>"
            const emailMatch = toHeader.match(/<([^>]+)>/);
            targetAlias = emailMatch ? emailMatch[1] : toHeader;
         }
      }

      // 2. Check for security flags (Password resets, alerts)
      const secQuery = `(${query}) AND (subject:password OR subject:reset OR subject:alert OR subject:login OR subject:verification OR subject:security)`;
      const secRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(secQuery)}&maxResults=1`, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      if (secRes.ok) {
         const secData = await secRes.json();
         if (secData.resultSizeEstimate > 0 && secData.messages?.length > 0) {
            securityFlags.push("Recent security or login alerts detected");
            
            // Forensics: Fetch the body of the security alert to extract device/location
            const secMsgId = secData.messages[0].id;
            const secMsgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${secMsgId}?format=full`, {
              headers: { Authorization: `Bearer ${activeToken}` }
            });
            if (secMsgRes.ok) {
               const secMsgData = await secMsgRes.json();
               // Naive extraction of body text (could be in payload.body or payload.parts)
               let bodyRaw = secMsgData.payload?.body?.data || '';
               if (!bodyRaw && secMsgData.payload?.parts) {
                  const part = secMsgData.payload.parts.find((p: any) => p.mimeType === 'text/plain' || p.mimeType === 'text/html');
                  bodyRaw = part?.body?.data || '';
               }
               
               if (bodyRaw) {
                  // Base64url decode
                  try {
                     const base64 = bodyRaw.replace(/-/g, '+').replace(/_/g, '/');
                     const text = atob(base64);
                     
                     // Regex for Device
                     const deviceMatch = text.match(/(?:Windows|Mac OS X|iPhone|iPad|Android|Linux|Chrome OS|Safari|Firefox|Edge)/i);
                     if (deviceMatch && !devices.includes(deviceMatch[0])) devices.push(deviceMatch[0]);
                     
                     // Regex for Location (e.g. near Chicago, IL or Location: Paris, France)
                     const locMatch = text.match(/(?:near|Location:)\s*([A-Za-z]+,\s*[A-Za-z\s]+)/i);
                     if (locMatch) locations.push(locMatch[1].trim());
                  } catch (e) {
                     console.error("Base64 decode failed for forensics", e);
                  }
               }
            }
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
         volume: exactVolume,
         locked: false,
         latestSubject,
         lastActive,
         targetAlias,
         securityFlags,
         devices,
         locations,
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
