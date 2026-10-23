-- =====================================================================
--  G-SERVE  |  connect the confirmation emails
--  Run this AFTER you have deployed the Google Apps Script (Step 5 in the guide).
--  Replace the two values below, then press Run.
-- =====================================================================

update public.settings
set email_webhook_url    = 'PASTE-YOUR-APPS-SCRIPT-WEB-APP-URL-HERE',     -- ends with /exec
    email_webhook_secret = 'PASTE-THE-SAME-SECRET-YOU-PUT-IN-Code.gs'
where id = 1;

-- To check that emails are going out after a test booking, run this and look at the newest rows.
-- "status_code" 200 or 302 means Google received the request (the email is sent from your Gmail).
--
--   select id, status_code, error_msg, created from net._http_response order by created desc limit 5;
