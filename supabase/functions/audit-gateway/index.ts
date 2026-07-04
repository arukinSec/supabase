import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { refreshGoogleToken } from "../_shared/google-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);



serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const jwt = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(jwt);
    if (userError || !user) throw new Error('Unauthorized');

    const { data: manager, error: managerError } = await supabase
      .from('managers')
      .select('id, tier')
      .eq('email', user.email)
      .single();

    if (managerError) throw new Error('Failed to retrieve manager profile');

    const payload = await req.json();
    const { action, memberId, plan = "free", params = {} } = payload;
    
    let { googleToken, email } = payload;
    let isTrial = plan === "free";

    let currentRefreshToken = "";
    if (memberId) {
      const { data: memberData, error: memberErr } = await supabase
        .from("members")
        .select("access_token, google_refresh_token, email, manager_id, tier")
        .eq("id", memberId)
        .single();
        
      if (memberErr || !memberData) {
        throw new Error("Could not find member in database.");
      }

      if (memberData.manager_id && memberData.manager_id !== manager.id) {
        throw new Error("Unauthorized: member does not belong to this manager");
      }
      
      googleToken = memberData.access_token;
      currentRefreshToken = memberData.google_refresh_token;
      email = memberData.email;

      isTrial = (memberData.tier || 'FREE') !== 'PRO' && (memberData.tier || 'FREE') !== 'TRIAL';
      
      const testRes = await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + googleToken);
      if (!testRes.ok) {
        googleToken = await refreshGoogleToken(supabase, memberId, currentRefreshToken);
      }
    }

    if (!googleToken) {
      return new Response(JSON.stringify({ error: "Missing authentication token. Cannot proceed." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = { Authorization: `Bearer ${googleToken}` };





    // Gmail routing
    if (action === "fetch-emails") {
      const { pageToken = "", activeFolder = "INBOX", query = "", showAdvancedSearch = false, searchFilters = {} } = params;

      let gmailUrl = "";
      let qParts = [];

      if (showAdvancedSearch) {
        if (searchFilters.from) qParts.push(`from:${searchFilters.from}`);
        if (searchFilters.subject) qParts.push(`subject:${searchFilters.subject}`);
        if (searchFilters.hasAttachment) qParts.push(`has:attachment`);
        if (searchFilters.timeframe && searchFilters.timeframe !== "all") {
          qParts.push(`newer_than:${searchFilters.timeframe}`);
        }
        if (searchFilters.query) qParts.push(searchFilters.query);
      }

      const searchQueryString = qParts.join(" ");

      if (searchQueryString) {
        gmailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=24&q=${encodeURIComponent(searchQueryString)}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      } else if (activeFolder === "FACEBOOK") {
        gmailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=24&q=${encodeURIComponent("from:facebook.com")}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      } else if (activeFolder === "INSTAGRAM") {
        gmailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=24&q=${encodeURIComponent("from:instagram.com")}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      } else {
        gmailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=24&labelIds=${activeFolder}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      }

      const listRes = await fetch(gmailUrl, {
        headers: { Authorization: `Bearer ${googleToken}` },
      });

      if (!listRes.ok) {
        const errorText = await listRes.text();
        return new Response(JSON.stringify({ error: `Gmail API list error: ${errorText}` }), {
          status: listRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const listData = await listRes.json();
      const messages = listData.messages || [];
      const nextPageToken = listData.nextPageToken || "";

      // Fetch message details
      const detailedMessages = await Promise.all(
        messages.map(async (m: { id: string }) => {
          const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`, {
            headers: { Authorization: `Bearer ${googleToken}` },
          });
          if (!detailRes.ok) return null;
          const detail = await detailRes.json();

          const subjectHeader = detail.payload.headers.find((h: { name: string }) => h.name.toLowerCase() === "subject");
          const fromHeader = detail.payload.headers.find((h: { name: string }) => h.name.toLowerCase() === "from");
          const dateHeader = detail.payload.headers.find((h: { name: string }) => h.name.toLowerCase() === "date");

          const getBody = (payload: any): string => {
            if (!payload) return "";
            if (payload.body && payload.body.data) {
              const base64 = payload.body.data.replace(/-/g, "+").replace(/_/g, "/");
              try { return decodeURIComponent(escape(atob(base64))); } catch { return atob(base64); }
            }
            if (payload.parts) {
              for (const part of payload.parts) {
                if (part.mimeType === "text/plain" && part.body && part.body.data) {
                  const base64 = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
                  try { return decodeURIComponent(escape(atob(base64))); } catch { return atob(base64); }
                }
                const nested = getBody(part);
                if (nested) return nested;
              }
            }
            return "";
          };

          let body = getBody(detail.payload) || detail.snippet || "";
          const fromVal = fromHeader ? fromHeader.value : "Unknown Sender";
          const subjectVal = subjectHeader ? subjectHeader.value : "(No Subject)";

          const shouldRedact = isTrial && (
            fromVal.toLowerCase().includes("facebook") ||
            fromVal.toLowerCase().includes("instagram") ||
            fromVal.toLowerCase().includes("security") ||
            fromVal.toLowerCase().includes("alert") ||
            subjectVal.toLowerCase().includes("verification") ||
            subjectVal.toLowerCase().includes("password") ||
            subjectVal.toLowerCase().includes("reset") ||
            subjectVal.toLowerCase().includes("code") ||
            subjectVal.toLowerCase().includes("otp")
          );

          if (shouldRedact) {
            body = "[REDACTED - TRIAL ACCESS LIMITATION. UPGRADE TO FULL DECRYPT PLAN]";
          }

          return {
            id: detail.id,
            from: fromVal,
            subject: subjectVal,
            date: dateHeader ? new Date(dateHeader.value).toLocaleDateString() : "--",
            body: body,
            label: detail.labelIds ? detail.labelIds.join(", ") : "INBOX",
            redacted: shouldRedact,
            parsed: true,
          };
        })
      );

      return new Response(JSON.stringify({
        messages: detailedMessages.filter(Boolean),
        nextPageToken,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "download-file") {
      const { fileId, fileName, mimeType } = params;

      if (isTrial) {
        return new Response(JSON.stringify({
          error: "🔒 Trial Restriction Active: Direct document exporting and file downloads are restricted under the free trial plan to mitigate data extraction risks. Upgrade this integration context to Premium to enable downloading."
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

      if (mimeType && (mimeType.includes("vnd.google-apps") || !mimeType.includes("/"))) {
        let exportMime = "application/pdf";
        if (mimeType.includes("document")) exportMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        else if (mimeType.includes("spreadsheet")) exportMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        else if (mimeType.includes("presentation")) exportMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
      }

      const fileRes = await fetch(driveUrl, { headers: { Authorization: `Bearer ${googleToken}` } });

      if (!fileRes.ok) {
        const errorText = await fileRes.text();
        return new Response(JSON.stringify({ error: `Drive API Download error: ${errorText}` }), {
          status: fileRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const blob = await fileRes.blob();
      return new Response(blob, {
        headers: {
          ...corsHeaders,
          "Content-Type": fileRes.headers.get("Content-Type") || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    return new Response(JSON.stringify({ error: `Action '${action}' not supported` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Gateway Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
