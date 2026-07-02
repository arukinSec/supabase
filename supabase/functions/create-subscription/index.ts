import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || 'http://localhost:5173';

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { auditor_id, plan_id, action = 'upgrade' } = await req.json();
    if (!auditor_id) throw new Error("Missing auditor_id");

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

    // Initialize Supabase Client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the auditor's email to prefill/store
    const { data: auditor, error: dbErr } = await supabase
      .from('auditors')
      .select('email')
      .eq('id', auditor_id)
      .single();

    if (dbErr || !auditor) {
      throw new Error("Auditor profile not found in database.");
    }

    // Count how many auditors currently have tier = 'PRO'
    const { count: proCount, error: countErr } = await supabase
      .from('auditors')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'PRO');

    if (countErr) throw countErr;

    const isAddon = action === 'add-slot';
    let amount = 789000; // Default: ₹7,890.00
    if (isAddon) {
      amount = 120000; // ₹1,200 for addon slot
    } else if ((proCount || 0) < 10) {
      amount = 128000; // ₹1,280 for early adopter promo
    }

    // Call Razorpay Orders API
    const authHeader = `Basic ${btoa(`${keyId}:${keySecret}`)}`;
    const razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: amount,
        currency: "INR",
        receipt: `receipt_${auditor_id.substring(0, 10)}`,
        notes: {
          auditor_id: auditor_id,
          email: auditor.email,
          action: action
        }
      })
    });

    const data = await razorpayRes.json();
    if (!razorpayRes.ok) {
      throw new Error(data.error?.description || "Razorpay order creation failed");
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Order generation error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
