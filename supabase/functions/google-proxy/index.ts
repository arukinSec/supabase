import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { refreshGoogleToken } from "../_shared/google-token.ts";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    const jwt = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt);
    if (userError || !user) throw new Error("Unauthorized");

    const { data: auditor, error: auditorError } = await supabaseAdmin
      .from("auditors")
      .select("id")
      .eq("email", user.email)
      .single();

    if (auditorError) throw new Error("Failed to retrieve auditor profile");

    const { url, memberId, method = "GET", body } = await req.json();
    if (!url || !memberId) throw new Error("Missing url or memberId");

    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("access_token, google_refresh_token, auditor_id")
      .eq("id", memberId)
      .single();

    if (memberError || !member) throw new Error("Member not found");

    if (member.auditor_id && member.auditor_id !== auditor.id) {
      throw new Error("Unauthorized: member does not belong to this auditor");
    }

    let token = member.access_token;

    const testRes = await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + token);
    if (!testRes.ok && member.google_refresh_token) {
      token = await refreshGoogleToken(supabaseAdmin, memberId, member.google_refresh_token);
    }

    const fetchOpts: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${token}` },
    };
    if (body && method !== "GET") {
      fetchOpts.body = JSON.stringify(body);
      (fetchOpts.headers as Record<string, string>)["Content-Type"] = "application/json";
    }

    const proxyRes = await fetch(url, fetchOpts);
    const status = proxyRes.status;
    const contentType = proxyRes.headers.get("Content-Type") || "application/json";

    let responseBody: any;
    if (contentType.includes("text/") || contentType.includes("application/json")) {
      responseBody = await proxyRes.text();
    } else {
      const blob = await proxyRes.blob();
      responseBody = await blob.text();
    }

    return new Response(JSON.stringify({ __proxy: true, status, body: responseBody, ok: status >= 200 && status < 300 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ __proxy: true, status: 500, body: null, ok: false, error: (error as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
