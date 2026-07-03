import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function refreshGoogleToken(memberId: string, currentRefreshToken: string) {
  if (!googleClientId || !googleClientSecret) {
    throw new Error("Missing Google OAuth credentials in Edge Function environment.");
  }
  
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: currentRefreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to refresh Google token: ${err}`);
  }

  const tokenData = await tokenRes.json();
  const newAccessToken = tokenData.access_token;
  
  // Save back to DB
  await supabase
    .from("members")
    .update({ access_token: newAccessToken })
    .eq("id", memberId);

  return newAccessToken;
}

async function validateOrRefreshToken(memberId: string, providedToken: string, refreshToken: string) {
  // Test token with a lightweight call
  const testRes = await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + providedToken);
  if (testRes.ok) {
    return providedToken;
  }
  
  // Token is dead, we must refresh
  if (!refreshToken) {
    throw new Error("Token expired and no refresh token available.");
  }
  
  console.log(`Token expired for ${memberId}. Refreshing...`);
  return await refreshGoogleToken(memberId, refreshToken);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { action, memberId, plan = "free", params = {} } = payload;
    
    // Fallback if frontend still sends googleToken and email (for legacy reasons during migration)
    let { googleToken, email } = payload;
    const isTrial = plan === "free";

    // If memberId is provided, we fetch their real tokens from the DB
    let currentRefreshToken = "";
    if (memberId) {
      const { data: memberData, error: memberErr } = await supabase
        .from("members")
        .select("access_token, google_refresh_token, email")
        .eq("id", memberId)
        .single();
        
      if (memberErr || !memberData) {
        throw new Error("Could not find member in database.");
      }
      
      googleToken = memberData.access_token;
      currentRefreshToken = memberData.google_refresh_token;
      email = memberData.email;
      
      // Attempt to refresh token if it's dead
      googleToken = await validateOrRefreshToken(memberId, googleToken, currentRefreshToken);
    }

    if (!googleToken) {
      return new Response(JSON.stringify({ error: "Missing authentication token. Cannot proceed." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "fetch-youtube") {
      const headers = { Authorization: `Bearer ${googleToken}` };
      
      // 1. Fetch Master Channel Info
      const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings,contentDetails&mine=true', { headers });
      const channelData = await channelRes.json();
      const channel = channelData.items?.[0] || null;

      if (!channel) {
         throw new Error("No YouTube channel found for this account.");
      }

      // 2. Fetch all Subscriptions (who they are subscribed to)
      let allSubscriptions = [];
      let subPageToken = "";
      do {
        const subsUrl = `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50${subPageToken ? `&pageToken=${subPageToken}` : ''}`;
        const subsRes = await fetch(subsUrl, { headers });
        if (!subsRes.ok) break;
        const subsData = await subsRes.json();
        const items = subsData.items || [];
        allSubscriptions.push(...items.map((item: any) => ({
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails?.default?.url,
          channelId: item.snippet.resourceId?.channelId
        })));
        subPageToken = subsData.nextPageToken;
      } while (subPageToken && allSubscriptions.length < 1000);

      // 3. Fetch all Subscribers (who is subscribed to them)
      let allSubscribers = [];
      let mySubPageToken = "";
      do {
        const mySubsUrl = `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet,subscriberSnippet&mySubscribers=true&maxResults=50${mySubPageToken ? `&pageToken=${mySubPageToken}` : ''}`;
        const mySubsRes = await fetch(mySubsUrl, { headers });
        if (!mySubsRes.ok) break;
        const mySubsData = await mySubsRes.json();
        const items = mySubsData.items || [];
        
        allSubscribers.push(...items.map((item: any) => ({
          title: item.subscriberSnippet.title,
          thumbnail: item.subscriberSnippet.thumbnails?.default?.url,
          channelId: item.subscriberSnippet.channelId,
          joined: item.snippet?.publishedAt || null
        })));
        
        mySubPageToken = mySubsData.nextPageToken;
      } while (mySubPageToken && allSubscribers.length < 1000); // hard limit 1000

      // 4. Batch Influence Analyzer (fetch sub counts for our subscribers)
      // Break into chunks of 50
      const rankedSubscribers = [];
      for (let i = 0; i < allSubscribers.length; i += 50) {
        const chunk = allSubscribers.slice(i, i + 50);
        const ids = chunk.map(s => s.channelId).join(',');
        
        const statsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${ids}&maxResults=50`;
        const statsRes = await fetch(statsUrl, { headers });
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          const statsMap = new Map();
          (statsData.items || []).forEach((item: any) => {
             statsMap.set(item.id, {
               subs: parseInt(item.statistics.subscriberCount || '0', 10),
               videos: parseInt(item.statistics.videoCount || '0', 10)
             });
          });
          
          chunk.forEach(sub => {
             const stats = statsMap.get(sub.channelId) || { subs: 0, videos: 0 };
             rankedSubscribers.push({
               ...sub,
               subscribers: stats.subs,
               videos: stats.videos
             });
          });
        } else {
          rankedSubscribers.push(...chunk.map(sub => ({ ...sub, subscribers: 0, videos: 0 })));
        }
      }
      
      // Sort rankedSubscribers by influence (descending)
      rankedSubscribers.sort((a, b) => b.subscribers - a.subscribers);

      // Optimize payload: Only send the top 100 most influential subscribers (excluding 0-sub accounts)
      const finalSubscribers = rankedSubscribers
        .filter(sub => sub.subscribers > 0)
        .slice(0, 100);

      // 5. Fetch Playlists
      let allPlaylists = [];
      const plRes = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status&mine=true&maxResults=50', { headers });
      if (plRes.ok) {
        const plData = await plRes.json();
        allPlaylists = (plData.items || []).map((item: any) => ({
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
          status: item.status.privacyStatus,
          id: item.id
        }));
      }

      return new Response(JSON.stringify({
        channel,
        subscriptions: allSubscriptions,
        subscribers: finalSubscribers,
        playlists: allPlaylists
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
