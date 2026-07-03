-- Enable pg_cron extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule expire-pro Edge Function daily at midnight UTC
SELECT cron.schedule(
  'expire-pro-daily',
  '0 0 * * *',
  $$SELECT net.http_post(
    url:='https://qxgoxnywwvvzkbgjfhhx.supabase.co/functions/v1/expire-pro',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json'
    )
  ) AS request_id$$
);
