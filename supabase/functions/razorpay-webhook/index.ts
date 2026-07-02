import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import crypto from "node:crypto";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature',
};

function verifySignature(bodyText: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(bodyText);
  const expectedSignature = hmac.digest("hex");
  
  const encoder = new TextEncoder();
  const a = encoder.encode(expectedSignature);
  const b = encoder.encode(signature);
  
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature') || '';
    
    // Retrieve Webhook Secret from environment secrets
    const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new Error("RAZORPAY_WEBHOOK_SECRET secret is not configured.");
    }

    // Verify HMAC signature
    const isValid = verifySignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      return new Response(JSON.stringify({ error: "Invalid signature verification" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event;
    
    // Parse order or payment details
    const order = payload.payload?.order?.entity;
    const payment = payload.payload?.payment?.entity;
    
    const orderId = order?.id || payment?.order_id || '';
    const notes = order?.notes || payment?.notes || {};
    const auditorId = notes.auditor_id;
    const email = notes.email || payment?.email;

    if (!orderId && !payment) {
      return new Response(JSON.stringify({ message: "No relevant order or payment entity in payload" }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase Client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (event === 'order.paid' || event === 'payment.captured') {
      const isAddon = notes.action === 'add-slot';

      if (isAddon) {
        if (!auditorId) {
          throw new Error("Unable to identify auditor for slot increment: no auditor_id found in notes.");
        }
        const { error } = await supabase.rpc('increment_slots', { auditor_uuid: auditorId });
        if (error) throw error;
        console.log(`Successfully incremented slots count for auditor ID: ${auditorId}`);
      } else {
        // For one-time annual payments, calculate 1 year duration
        const proExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        
        let query = supabase.from('auditors').update({
          tier: 'PRO',
          razorpay_subscription_id: orderId, // Store the order ID here
          pro_expires_at: proExpiresAt,
          billing_cycle: 'yearly'
        });

        if (auditorId) {
          query = query.eq('id', auditorId);
        } else if (email) {
          query = query.eq('email', email.toLowerCase());
        } else {
          throw new Error("Unable to identify auditor: no auditor_id or email found in payload.");
        }

        const { error } = await query;
        if (error) throw error;
        console.log(`Successfully upgraded auditor to PRO (One-Time Order) for ID/Email: ${auditorId || email}`);
      }
    }

    return new Response(JSON.stringify({ status: "success" }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
