import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || 'http://localhost:5173';

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } })

    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const jwt = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt)
    if (userError || !user) throw new Error('Unauthorized')

    const { auditor_id, plan_id, action = 'upgrade' } = await req.json();
    if (!auditor_id) throw new Error("Missing auditor_id");

    // Fetch the auditor's email to prefill/store using Admin bypass
    const { data: auditor, error: dbErr } = await supabaseAdmin
      .from('auditors')
      .select('id, email, billing_cycle')
      .eq('email', user.email)
      .single();

    if (dbErr || !auditor) {
      throw new Error("Auditor profile not found in database.");
    }
    
    // STRICT CHECK: auditor can only create a subscription for themselves
    if (auditor.id !== auditor_id) {
      throw new Error("Unauthorized to create subscription for this auditor ID.");
    }

    // Retrieve credentials
    const keyId = Deno.env.get('RAZORPAY_KEY_ID');
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    const defaultPlanId = plan_id || Deno.env.get('RAZORPAY_PLAN_ID');

    if (!keyId || !keySecret) {
      throw new Error("Razorpay API credentials not configured in Edge secrets.");
    }
    if (!defaultPlanId) {
      throw new Error("Razorpay Plan ID not specified or configured.");
    }

    // Count how many auditors currently have tier = 'PRO'
    const { count: proCount, error: countErr } = await supabaseAdmin
      .from('auditors')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'PRO');

    if (countErr) throw countErr;

    const isAddon = action === 'add-slot';
    const isWeekly = action === 'weekly-license';
    
    // Default to Early Access Annual License
    let amount = 789000; // Standard: ₹7,890.00
    let description = 'Arukin PRO - Annual License';
    
    if (isAddon) {
      amount = 120000; // ₹1,200 for addon slot
      description = 'Arukin PRO - Additional Auditor Slot';
      if ((proCount || 0) < 1 || auditor.billing_cycle !== 'yearly') {
        throw new Error("Cannot add extra slots without an Annual PRO plan.");
      }
    } else if (isWeekly) {
      amount = 49900; // ₹499 for 1 week
      description = 'Arukin PRO - 1-Week License';
    } else {
      // Annual Plan Logic
      if ((proCount || 0) < 10) {
        amount = 128000; // Early Bird Promo: ₹1,280
        description = 'Arukin PRO - Annual License (Early Bird)';
      }
    }

    // Generate standard Razorpay Order
    const authString = btoa(`${keyId}:${keySecret}`);
    const rzpayRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`
      },
      body: JSON.stringify({
        amount: amount,
        currency: 'INR',
        receipt: `rcpt_${auditor_id.substring(0, 8)}_${Date.now()}`,
        notes: {
          auditor_id: auditor_id,
          action: action,
          email: auditor.email
        }
      })
    });

    const rzpayData = await rzpayRes.json();

    if (!rzpayRes.ok) {
      throw new Error(rzpayData.error?.description || "Failed to create payment link with Razorpay");
    }

    return new Response(JSON.stringify({
      id: rzpayData.id,
      short_url: rzpayData.short_url,
      status: rzpayData.status,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
