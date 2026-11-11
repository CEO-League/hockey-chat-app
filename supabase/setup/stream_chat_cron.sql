-- Enable pg_cron, pg_net and Vault first. Create these secrets in Vault:
-- stream_sync_secret: the same private value as STREAM_SYNC_SECRET
-- stream_sync_url: https://<project-ref>.supabase.co/functions/v1/stream-sync
-- Run once; inspect existing cron jobs before rerunning.
select cron.schedule(
  'hockey-stream-membership-sync',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'stream_sync_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'stream_sync_secret')
      ),
      body := '{"action":"sync"}'::jsonb,
      timeout_milliseconds := 100000
    );
  $job$
);
