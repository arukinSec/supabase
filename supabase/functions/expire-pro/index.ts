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

    let totalProcessed = 0;
    
    while (true) {
      const { data: expired, error: fetchError } = await supabase
        .from("managers")
        .select("id")
        .eq("tier", "PRO")
        .lt("pro_expires_at", new Date().toISOString())
        .limit(500);

      if (fetchError) throw fetchError;
      
      if (!expired || expired.length === 0) {
        break;
      }

      const expiredIds = expired.map((a) => a.id);
      
      // Process in chunks of 50 to prevent URI Too Long (414) in PostgREST
      const CHUNK_SIZE = 50;
      for (let i = 0; i < expiredIds.length; i += CHUNK_SIZE) {
        const chunk = expiredIds.slice(i, i + CHUNK_SIZE);
        
        const { error: updateError } = await supabase
          .from("managers")
          .update({ tier: "FREE", pro_expires_at: null, billing_cycle: null })
          .in("id", chunk);

        if (updateError) throw updateError;

        const { error: memberError } = await supabase
          .from("members")
          .update({ tier: "FREE" })
          .in("manager_id", chunk);

        if (memberError) throw memberError;
      }
      
      totalProcessed += expiredIds.length;
    }

    return new Response(JSON.stringify({ expired: totalProcessed }), {
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
