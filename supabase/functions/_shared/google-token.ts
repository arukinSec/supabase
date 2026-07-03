export async function refreshGoogleToken(
  supabaseAdmin: any,
  memberId: string,
  refreshToken?: string
): Promise<string> {
  if (!refreshToken) {
    const { data: member, error: fetchError } = await supabaseAdmin
      .from("members")
      .select("google_refresh_token")
      .eq("id", memberId)
      .single();

    if (fetchError || !member?.google_refresh_token) {
      throw new Error("No google_refresh_token found for this member.");
    }
    refreshToken = member.google_refresh_token;
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth credentials in Edge Function environment.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(tokenData.error_description || "Failed to refresh Google token.");
  }

  const newAccessToken = tokenData.access_token;

  await supabaseAdmin
    .from("members")
    .update({ access_token: newAccessToken, updated_at: new Date().toISOString() })
    .eq("id", memberId);

  return newAccessToken;
}

export async function fetchWithTokenRefresh<T>(
  supabaseAdmin: any,
  memberId: string,
  url: string,
  token: string,
  options?: RequestInit
): Promise<Response> {
  let activeToken = token;
  let res = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${activeToken}`,
    },
  });

  if (res.status === 401) {
    activeToken = await refreshGoogleToken(supabaseAdmin, memberId);
    res = await fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        Authorization: `Bearer ${activeToken}`,
      },
    });
  }

  return res;
}
