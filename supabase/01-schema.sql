-- =====================================================================
--  G-SERVE BOOKING SYSTEM  |  database + rules
--  Run this ONCE in Supabase > SQL Editor > New query > Run.
--  It is safe to run again later: it never deletes real bookings.
-- =====================================================================

create extension if not exists pg_net;      -- lets the database call the email sender

-- ---------------------------------------------------------------------
-- 1. SETTINGS TABLE (one row)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                    integer primary key default 1 check (id = 1),
  business_name         text    not null,
  court_name            text    not null,
  manager_email         text    not null,
  site_url              text    not null,
  timezone              text    not null default 'Asia/Manila',
  open_hour             smallint not null,
  close_hour            smallint not null,
  peak_start            smallint not null,
  peak_end              smallint not null,
  weekend_all_peak      boolean not null default false,
  rate_offpeak          integer not null,
  rate_peak             integer not null,
  paddle_price          integer not null,
  max_paddles           smallint not null default 4,
  hold_minutes          smallint not null default 10,
  max_days_ahead        smallint not null default 60,
  max_slots_per_booking smallint not null default 12,
  email_webhook_url     text,
  email_webhook_secret  text,
  constraint settings_hours_ok check (open_hour >= 0 and close_hour <= 24 and open_hour < close_hour)
);

-- ---------------------------------------------------------------------
-- >>> EDIT THIS BLOCK, then run the whole file <<<
--     Hours use the 24-hour clock: 6 = 6:00 AM, 17 = 5:00 PM, 22 = 10:00 PM.
--     The last bookable hour ENDS at close_hour (22 = last slot 9-10 PM).
--     Peak = from peak_start up to (not including) peak_end.
--     Prices are in pesos per hour. Paddle price is per paddle, per day.
-- ---------------------------------------------------------------------
insert into public.settings
  (id, business_name, court_name, manager_email,        site_url,                                   timezone,
   open_hour, close_hour, peak_start, peak_end, weekend_all_peak,
   rate_offpeak, rate_peak, paddle_price, max_paddles, hold_minutes, max_days_ahead, max_slots_per_booking)
values
  (1, 'G-Serve', 'Court 1', 'manager@example.com', 'https://YOUR-USERNAME.github.io/g-serve/', 'Asia/Manila',
   6, 22, 17, 21, false,
   300, 400, 50, 4, 10, 60, 12)
on conflict (id) do update set
  business_name = excluded.business_name, court_name = excluded.court_name,
  manager_email = excluded.manager_email, site_url = excluded.site_url, timezone = excluded.timezone,
  open_hour = excluded.open_hour, close_hour = excluded.close_hour,
  peak_start = excluded.peak_start, peak_end = excluded.peak_end, weekend_all_peak = excluded.weekend_all_peak,
  rate_offpeak = excluded.rate_offpeak, rate_peak = excluded.rate_peak, paddle_price = excluded.paddle_price,
  max_paddles = excluded.max_paddles, hold_minutes = excluded.hold_minutes,
  max_days_ahead = excluded.max_days_ahead, max_slots_per_booking = excluded.max_slots_per_booking;
-- ---------------------------------------------------------------------
-- >>> END OF THE EDIT BLOCK. Nothing below needs changing. <<<
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 2. BOOKINGS + SLOTS
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique,
  name            text not null,
  email           text not null,
  phone           text not null,
  status          text not null default 'held'
                  check (status in ('held','pending','confirmed','rejected','cancelled','expired')),
  amount          integer not null check (amount >= 0),
  paddles         jsonb   not null default '[]'::jsonb,   -- [{date, qty, price}]
  gcash_ref       text,
  admin_note      text,
  is_sample       boolean not null default false,
  hold_expires_at timestamptz,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz,
  decided_at      timestamptz
);

create table if not exists public.booking_slots (
  id         bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  court      smallint not null default 1,
  play_date  date not null,
  hour       smallint not null check (hour between 0 and 23),
  price      integer not null check (price >= 0),
  active     boolean not null default true       -- true while the slot is held / awaiting check / confirmed
);

-- *** DOUBLE-BOOKING PROTECTION ***
-- The database itself refuses a second ACTIVE booking for the same court, date and hour.
-- Even if two people press "Pay" in the same millisecond, only one can win.
create unique index if not exists booking_slots_no_double_booking
  on public.booking_slots (court, play_date, hour) where active;

-- The same GCash receipt number cannot be used for two live bookings.
create unique index if not exists bookings_gcash_ref_unique
  on public.bookings (gcash_ref)
  where gcash_ref is not null and status in ('pending','confirmed') and not is_sample;

create index if not exists bookings_email_idx    on public.bookings (lower(email));
create index if not exists bookings_status_idx   on public.bookings (status);
create index if not exists slots_booking_idx     on public.booking_slots (booking_id);
create index if not exists slots_date_idx        on public.booking_slots (play_date);

-- ---------------------------------------------------------------------
-- 3. LOCK THE TABLES: the website can only use the functions below
-- ---------------------------------------------------------------------
alter table public.settings      enable row level security;
alter table public.bookings      enable row level security;
alter table public.booking_slots enable row level security;
revoke all on public.settings, public.bookings, public.booking_slots from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. HELPERS
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
           lower(auth.jwt() ->> 'email') = (select lower(manager_email) from public.settings where id = 1),
           false)
         and coalesce(auth.jwt() ->> 'role', '') = 'authenticated';
$$;

create or replace function public.slot_price(p_date date, p_hour integer) returns integer
language sql stable security definer set search_path = public as $$
  select case
           when (p_hour >= s.peak_start and p_hour < s.peak_end)
             or (s.weekend_all_peak and extract(isodow from p_date) in (6, 7))
           then s.rate_peak else s.rate_offpeak
         end
  from public.settings s where s.id = 1;
$$;

create or replace function public.new_ref() returns text
language plpgsql security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- no 0/O/1/I to avoid mix-ups
  r text;
  i integer;
begin
  loop
    r := 'GS-';
    for i in 1..6 loop
      r := r || substr(chars, 1 + floor(random() * 32)::integer, 1);
    end loop;
    exit when not exists (select 1 from public.bookings where ref = r);
  end loop;
  return r;
end $$;

-- Unpaid holds older than the hold time are released automatically.
create or replace function public.release_expired_holds() returns void
language sql security definer set search_path = public as $$
  update public.bookings set status = 'expired'
  where status = 'held' and hold_expires_at < now();
$$;

-- ---------------------------------------------------------------------
-- 5. EMAIL: the database tells the email sender (Google Apps Script)
-- ---------------------------------------------------------------------
create or replace function public.send_email_event(p_event text, p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype;
  b public.bookings%rowtype;
begin
  select * into s from public.settings where id = 1;
  if s.email_webhook_url is null or s.email_webhook_url = '' then return; end if;   -- email not connected yet
  select * into b from public.bookings where id = p_booking_id;
  if not found or b.is_sample then return; end if;

  perform net.http_post(
    url     := s.email_webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000,
    body    := jsonb_build_object(
      'secret',        s.email_webhook_secret,
      'event',         p_event,
      'business',      s.business_name,
      'court',         s.court_name,
      'site_url',      s.site_url,
      'manager_email', s.manager_email,
      'booking', jsonb_build_object(
        'ref', b.ref, 'name', b.name, 'email', b.email, 'phone', b.phone,
        'gcash_ref', b.gcash_ref, 'amount', b.amount, 'status', b.status,
        'note', b.admin_note, 'paddles', b.paddles),
      'slots', coalesce((
        select jsonb_agg(jsonb_build_object('date', sl.play_date, 'hour', sl.hour, 'price', sl.price)
                         order by sl.play_date, sl.hour)
        from public.booking_slots sl where sl.booking_id = b.id), '[]'::jsonb)
    )
  );
exception when others then
  -- an email problem must never block a booking
  raise warning 'send_email_event failed: %', sqlerrm;
end $$;

-- Runs whenever a booking changes status: frees/holds the slots and sends the right email.
create or replace function public.bookings_on_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update public.booking_slots
       set active = (new.status in ('held','pending','confirmed') and not new.is_sample)
     where booking_id = new.id;

    if not new.is_sample then
      if    new.status = 'pending'   and old.status in ('held','expired') then perform public.send_email_event('received',  new.id);
      elsif new.status = 'confirmed' and old.status = 'pending'            then perform public.send_email_event('confirmed', new.id);
      elsif new.status = 'rejected'                                        then perform public.send_email_event('rejected',  new.id);
      elsif new.status = 'cancelled' and old.status in ('pending','confirmed') then perform public.send_email_event('cancelled', new.id);
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bookings_status_change on public.bookings;
create trigger bookings_status_change
  after update of status on public.bookings
  for each row execute function public.bookings_on_status_change();

-- ---------------------------------------------------------------------
-- 6. PUBLIC FUNCTIONS (used by book.html)
-- ---------------------------------------------------------------------
create or replace function public.get_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'business_name', business_name, 'court_name', court_name, 'timezone', timezone,
    'open_hour', open_hour, 'close_hour', close_hour,
    'peak_start', peak_start, 'peak_end', peak_end, 'weekend_all_peak', weekend_all_peak,
    'rate_offpeak', rate_offpeak, 'rate_peak', rate_peak, 'paddle_price', paddle_price,
    'max_paddles', max_paddles, 'hold_minutes', hold_minutes,
    'max_days_ahead', max_days_ahead, 'max_slots', max_slots_per_booking)
  from public.settings where id = 1;
$$;

-- Which hours are already taken (no personal details are returned).
create or replace function public.get_taken_slots(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.release_expired_holds();
  if p_from is null or p_to is null then return '[]'::jsonb; end if;
  if p_to > p_from + 200 then p_to := p_from + 200; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('date', sl.play_date, 'hour', sl.hour, 'held', b.status = 'held'))
    from public.booking_slots sl
    join public.bookings b on b.id = sl.booking_id
    where sl.active and sl.play_date between p_from and p_to), '[]'::jsonb);
end $$;

-- Step 1 of paying: check everything on the server, price it, and HOLD the slots.
create or replace function public.create_hold(
  p_name text, p_email text, p_phone text,
  p_slots jsonb, p_paddles jsonb default '[]'::jsonb, p_website text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s        public.settings%rowtype;
  v_now    timestamp;
  v_today  date;
  v_name   text := btrim(coalesce(p_name, ''));
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  r        record;
  v_q      integer;
  v_list   jsonb := '[]'::jsonb;
  v_pad    jsonb := '[]'::jsonb;
  v_dates  date[] := '{}';
  v_price  integer;
  v_total  integer := 0;
  v_id     uuid;
  v_ref    text;
  v_con    text;
begin
  if btrim(coalesce(p_website, '')) <> '' then                       -- spam-bot trap field
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select * into s from public.settings where id = 1;
  v_now   := now() at time zone s.timezone;
  v_today := v_now::date;

  if char_length(v_name) < 2 or char_length(v_name) > 80
     or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or char_length(v_digits) < 7 or char_length(v_digits) > 15 or char_length(v_phone) > 30 then
    return jsonb_build_object('ok', false, 'error', 'invalid_details');
  end if;

  if jsonb_typeof(p_slots) is distinct from 'array'
     or jsonb_array_length(p_slots) < 1
     or jsonb_array_length(p_slots) > s.max_slots_per_booking then
    return jsonb_build_object('ok', false, 'error', 'invalid_slots');
  end if;

  -- validate every slot and work out the price ON THE SERVER (the browser's price is never trusted)
  begin
    for r in
      select distinct (e ->> 'date')::date as d, (e ->> 'hour')::integer as h
      from jsonb_array_elements(p_slots) as e
      order by 1, 2
    loop
      if r.d is null or r.h is null
         or r.d < v_today or r.d > v_today + s.max_days_ahead
         or r.h < s.open_hour or r.h >= s.close_hour then
        return jsonb_build_object('ok', false, 'error', 'invalid_slots');
      end if;
      if (r.d + make_interval(hours => r.h)) <= v_now then
        return jsonb_build_object('ok', false, 'error', 'past_slot');
      end if;
      v_price := public.slot_price(r.d, r.h);
      v_total := v_total + v_price;
      v_list  := v_list || jsonb_build_object('date', r.d, 'hour', r.h, 'price', v_price);
      v_dates := v_dates || r.d;
    end loop;

    for r in
      select distinct on (x.d) x.d, x.q
      from (
        select (e ->> 'date')::date as d, (e ->> 'qty')::integer as q
        from jsonb_array_elements(coalesce(p_paddles, '[]'::jsonb)) as e
      ) x
      where x.d is not null and x.q is not null
      order by x.d, x.q desc
    loop
      v_q := least(greatest(r.q, 0), s.max_paddles);
      if v_q > 0 and r.d = any (v_dates) then
        v_pad   := v_pad || jsonb_build_object('date', r.d, 'qty', v_q, 'price', v_q * s.paddle_price);
        v_total := v_total + v_q * s.paddle_price;
      end if;
    end loop;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_slots');
  end;

  -- a person who starts again simply replaces their own unpaid hold
  perform public.release_expired_holds();
  update public.bookings set status = 'cancelled'
   where status = 'held'
     and (lower(email) = v_email or regexp_replace(phone, '\D', '', 'g') = v_digits);

  begin
    v_ref := public.new_ref();
    insert into public.bookings (ref, name, email, phone, status, amount, paddles, hold_expires_at)
    values (v_ref, v_name, v_email, v_phone, 'held', v_total, v_pad,
            now() + make_interval(mins => s.hold_minutes))
    returning id into v_id;

    insert into public.booking_slots (booking_id, court, play_date, hour, price)
    select v_id, 1, (e ->> 'date')::date, (e ->> 'hour')::integer, (e ->> 'price')::integer
    from jsonb_array_elements(v_list) as e;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'booking_slots_no_double_booking' then
      return jsonb_build_object('ok', false, 'error', 'slot_taken');     -- someone else got there first
    end if;
    raise;
  end;

  return jsonb_build_object('ok', true, 'ref', v_ref, 'amount', v_total,
                            'expires_in', s.hold_minutes * 60, 'slots', v_list, 'paddles', v_pad);
end $$;

-- Customer closed the payment window without paying.
create or replace function public.cancel_hold(p_ref text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.bookings set status = 'cancelled'
   where ref = upper(btrim(coalesce(p_ref, ''))) and lower(email) = lower(btrim(coalesce(p_email, '')))
     and status = 'held';
  return jsonb_build_object('ok', true);
end $$;

-- Step 2 of paying: the customer entered their GCash reference number.
create or replace function public.submit_payment(p_ref text, p_email text, p_gcash_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b     public.bookings%rowtype;
  v_g   text := regexp_replace(coalesce(p_gcash_ref, ''), '\D', '', 'g');
  v_con text;
begin
  if char_length(v_g) < 8 or char_length(v_g) > 20 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reference');
  end if;

  select * into b from public.bookings
   where ref = upper(btrim(coalesce(p_ref, ''))) and lower(email) = lower(btrim(coalesce(p_email, '')))
     and not is_sample
   for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if b.status in ('pending', 'confirmed') then
    if b.gcash_ref = v_g then
      return jsonb_build_object('ok', true, 'ref', b.ref, 'amount', b.amount);   -- pressed twice: fine
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_submitted');
  end if;
  if b.status in ('rejected', 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'not_payable');
  end if;

  -- status is 'held' (normal) or 'expired' (paid after the hold ran out)
  begin
    update public.bookings
       set status = 'pending', gcash_ref = v_g, paid_at = now(), hold_expires_at = null
     where id = b.id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'booking_slots_no_double_booking' then
      -- Paid late and the time was taken meanwhile: record it and alert the manager for a refund / rebooking.
      update public.bookings
         set gcash_ref = v_g, paid_at = now(),
             admin_note = 'Paid after the hold expired, but the time was already booked by someone else. Refund or rebook.'
       where id = b.id;
      perform public.send_email_event('late_conflict', b.id);
      return jsonb_build_object('ok', false, 'error', 'late_conflict', 'ref', b.ref);
    elsif v_con = 'bookings_gcash_ref_unique' then
      return jsonb_build_object('ok', false, 'error', 'reference_used');
    end if;
    raise;
  end;

  return jsonb_build_object('ok', true, 'ref', b.ref, 'amount', b.amount);
end $$;

-- "Find my bookings" (shows only dates, times, status and amount for that email).
create or replace function public.find_bookings(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select b.ref, b.status, b.amount, b.admin_note, b.created_at, b.paddles,
             (select coalesce(jsonb_agg(jsonb_build_object('date', sl.play_date, 'hour', sl.hour)
                                        order by sl.play_date, sl.hour), '[]'::jsonb)
                from public.booking_slots sl where sl.booking_id = b.id) as slots
      from public.bookings b
      where lower(b.email) = lower(btrim(coalesce(p_email, ''))) and not b.is_sample
        and (b.status in ('pending','confirmed','rejected','cancelled')
             or (b.status = 'expired' and b.gcash_ref is not null))
      order by b.created_at desc
      limit 20
    ) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 7. MANAGER FUNCTIONS (used by admin.html; only the manager's login works)
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_start date;
  v_end   date;
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  v_start := date_trunc('month', p_month)::date;
  v_end   := (date_trunc('month', p_month) + interval '1 month')::date;
  perform public.release_expired_holds();

  return jsonb_build_object(
    'pending_all', (select count(*) from public.bookings where status = 'pending'),
    'bookings', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select b.id, b.ref, b.name, b.email, b.phone, b.gcash_ref, b.amount, b.status,
               b.admin_note, b.is_sample, b.created_at, b.paid_at, b.paddles,
               (select coalesce(jsonb_agg(jsonb_build_object('date', sl.play_date, 'hour', sl.hour, 'price', sl.price)
                                          order by sl.play_date, sl.hour), '[]'::jsonb)
                  from public.booking_slots sl where sl.booking_id = b.id) as slots
        from public.bookings b
        where (b.status in ('pending','confirmed','rejected','cancelled')
               or (b.status = 'expired' and b.gcash_ref is not null))
          and (b.status = 'pending'
               or exists (select 1 from public.booking_slots sl
                           where sl.booking_id = b.id and sl.play_date >= v_start and sl.play_date < v_end))
      ) x), '[]'::jsonb));
end $$;

create or replace function public.admin_set_status(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings%rowtype;
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into b from public.bookings where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if not ((b.status = 'pending'   and p_status in ('confirmed', 'rejected', 'cancelled'))
       or (b.status = 'confirmed' and p_status = 'cancelled')) then
    return jsonb_build_object('ok', false, 'error', 'bad_transition');
  end if;

  update public.bookings
     set status = p_status,
         admin_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), admin_note),
         decided_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_add_samples() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s       public.settings%rowtype;
  v_m0    date;
  v_id    uuid;
  v_d     date;
  v_h     integer;
  v_amt   integer;
  v_pad   jsonb;
  i       integer;
  v_names text[] := array['Maria Santos','Juan Dela Cruz','Ana Reyes','Carlo Mendoza',
                          'Bea Villanueva','Rico Garcia','Liza Ramos','Paolo Cruz'];
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into s from public.settings where id = 1;
  v_m0 := date_trunc('month', now() at time zone s.timezone)::date;

  for i in 1..8 loop
    v_d   := v_m0 + ((i * 3) % 27);
    v_h   := least(s.open_hour + i, s.close_hour - 2);
    v_pad := case when i % 3 = 0
                  then jsonb_build_array(jsonb_build_object('date', v_d, 'qty', 2, 'price', 2 * s.paddle_price))
                  else '[]'::jsonb end;
    v_amt := public.slot_price(v_d, v_h) + public.slot_price(v_d, v_h + 1)
             + case when i % 3 = 0 then 2 * s.paddle_price else 0 end;

    insert into public.bookings (ref, name, email, phone, status, amount, paddles, gcash_ref, paid_at, is_sample)
    values ('SAMPLE-' || upper(substr(md5(random()::text), 1, 5)), v_names[i],
            'sample' || i || '@example.com', '09170000000',
            case when i % 4 = 0 then 'pending' else 'confirmed' end,
            v_amt, v_pad, lpad(((random() * 9999999999999)::bigint)::text, 13, '0'), now(), true)
    returning id into v_id;

    -- sample slots are never "active", so they can never block a real customer
    insert into public.booking_slots (booking_id, court, play_date, hour, price, active)
    values (v_id, 1, v_d, v_h,     public.slot_price(v_d, v_h),     false),
           (v_id, 1, v_d, v_h + 1, public.slot_price(v_d, v_h + 1), false);
  end loop;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_clear_samples() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  delete from public.bookings where is_sample;      -- real bookings are never touched
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 8. WHO MAY CALL WHAT
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_config()                              to anon, authenticated;
grant execute on function public.get_taken_slots(date, date)               to anon, authenticated;
grant execute on function public.create_hold(text, text, text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.cancel_hold(text, text)                   to anon, authenticated;
grant execute on function public.submit_payment(text, text, text)          to anon, authenticated;
grant execute on function public.find_bookings(text)                       to anon, authenticated;

grant execute on function public.is_admin()                                to authenticated;
grant execute on function public.admin_dashboard(date)                     to authenticated;
grant execute on function public.admin_set_status(uuid, text, text)        to authenticated;
grant execute on function public.admin_add_samples()                       to authenticated;
grant execute on function public.admin_clear_samples()                     to authenticated;

-- Done. You should see "Success. No rows returned".
