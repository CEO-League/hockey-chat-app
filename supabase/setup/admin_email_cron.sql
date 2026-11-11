-- Run after deployment and after adding these two secrets to Supabase Vault:
-- admin_email_project_url: https://YOUR_PROJECT.supabase.co
-- admin_email_worker_secret: same random value as Edge secret ADMIN_EMAIL_WORKER_SECRET
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name = 'admin_email_project_url')
     or not exists(select 1 from vault.decrypted_secrets where name = 'admin_email_worker_secret') then
    raise exception 'Add the admin email project URL and worker secret to Vault first.';
  end if;
end $$;

select cron.schedule('process-admin-email', '* * * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'admin_email_project_url') || '/functions/v1/process-admin-email',
    headers := jsonb_build_object('Content-Type','application/json','x-email-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'admin_email_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 65000
  );
$cron$);
