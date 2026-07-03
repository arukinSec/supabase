import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: expired, error: fetchError } = await supabase
      .from("auditors")
      .select("id")
      .eq("tier", "PRO")
      .lt("pro_expires_at", new Date().toISOString());

    if (fetchError) throw fetchError;

    if (!expired || expired.length === 0) {
      return new Response(JSON.stringify({ expired: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiredIds = expired.map((a) => a.id);

    const { error: updateError } = await supabase
      .from("auditors")
      .update({ tier: "FREE", pro_expires_at: null, billing_cycle: null })
      .in("id", expiredIds);

    if (updateError) throw updateError;

    const { error: memberError } = await supabase
      .from("members")
      .update({ tier: "FREE" })
      .in("auditor_id", expiredIds);

    if (memberError) throw memberError;

    return new Response(JSON.stringify({ expired: expiredIds.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("expire-pro error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
