/*  G-Serve  |  js/store.js
    Connects the booking pages to your Supabase project and holds helpers shared by
    book.js and admin.js. Only the CONFIG block below needs editing.

    Court name, hours, rates and paddle price now live in the database (the EDIT block in
    supabase/01-schema.sql, or Table Editor > settings). The manager PIN is the password of
    the manager account in Supabase, so it is NOT stored in this file.            */
(function () {
  'use strict';

  /* ===== EDIT THESE THREE LINES ================================================ */
  const CONFIG = {
    SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
    SUPABASE_KEY: 'YOUR-PUBLISHABLE-KEY',   // "Publishable key" (sb_publishable_...) or legacy "anon" key. NEVER the secret/service_role key.
    MANAGER_EMAIL: 'manager@example.com'    // the manager's email (same one used in supabase/01-schema.sql)
  };
  /* ============================================================================= */

  const configured = !/YOUR-/.test(CONFIG.SUPABASE_URL + CONFIG.SUPABASE_KEY);
  const base = CONFIG.SUPABASE_URL.replace(/\/+$/, '');

  class ApiError extends Error {
    constructor(code, status) { super(code); this.code = code; this.status = status || 0; }
  }

  function headers(token) {
    const h = { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_KEY };
    if (token) h.Authorization = 'Bearer ' + token;
    else if (CONFIG.SUPABASE_KEY.indexOf('eyJ') === 0) h.Authorization = 'Bearer ' + CONFIG.SUPABASE_KEY; // legacy anon key is a JWT
    return h;
  }

  async function request(url, opts) {
    if (!configured) throw new ApiError('not_configured');
    let res;
    try { res = await fetch(url, opts); } catch (e) { throw new ApiError('network'); }
    let body = null;
    try { body = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const code = (body && (body.error_code || body.code || body.message || body.msg)) || 'request_failed';
      throw new ApiError(String(code), res.status);
    }
    return body;
  }

  const rpc = (name, args, token) =>
    request(base + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers(token), body: JSON.stringify(args || {}) });

  /* ---------- dates, hours, money ---------- */
  const DAY = 86400000;
  const parse = (iso) => { const p = String(iso).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  const toISO = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  const addDays = (iso, n) => toISO(new Date(parse(iso).getTime() + n * DAY));

  function zoned(tz) {
    const p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour) % 24 };
  }

  const peso = (n) => '\u20B1' + Number(n || 0).toLocaleString('en-PH');
  const dateLabel = (iso) => parse(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayLabel = (iso) => parse(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const monthLabel = (iso) => parse(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const clock = (h) => ((h % 12) || 12) + ':00';
  const mer = (h) => (h % 24) < 12 ? 'AM' : 'PM';
  const hourLabel = (h) => clock(h) + ' ' + mer(h);
  /* start hour to end hour (end is exclusive): "5:00 - 7:00 PM" or "11:00 AM - 1:00 PM" */
  const rangeLabel = (a, b) => (mer(a) === mer(b) ? clock(a) : hourLabel(a)) + ' \u2013 ' + hourLabel(b);

  function mergeHours(hours) {
    const hs = Array.from(new Set(hours)).sort((a, b) => a - b);
    const out = [];
    hs.forEach((h) => {
      const last = out[out.length - 1];
      if (last && last[1] === h) last[1] = h + 1; else out.push([h, h + 1]);
    });
    return out;
  }

  /* Group [{date, hour}] into [{date, ranges:[[a,b]]}] */
  function byDate(slots) {
    const m = {};
    (slots || []).forEach((s) => { (m[s.date] = m[s.date] || []).push(s.hour); });
    return Object.keys(m).sort().map((date) => ({ date: date, ranges: mergeHours(m[date]) }));
  }

  function isPeak(cfg, date, hour) {
    const dow = parse(date).getUTCDay();
    return (hour >= cfg.peak_start && hour < cfg.peak_end) || (cfg.weekend_all_peak && (dow === 0 || dow === 6));
  }
  const price = (cfg, date, hour) => (isPeak(cfg, date, hour) ? cfg.rate_peak : cfg.rate_offpeak);

  const STATUS = {
    held: 'Payment not submitted',
    pending: 'Awaiting payment check',
    confirmed: 'Confirmed',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    expired: 'Needs attention'
  };

  /* Friendly messages for every error code the server or network can return */
  function errorText(e) {
    const c = (e && (e.code || e.error)) || String(e || '');
    const map = {
      not_configured: 'Booking is not connected yet. The site owner needs to finish setup (js/store.js).',
      network: "Can't reach the booking server. Check your connection and try again.",
      slot_taken: 'Sorry, someone just booked one of those times. The list has been updated, so please pick again.',
      past_slot: 'One of those times has already started. Please choose a later time.',
      invalid_slots: 'Those times are not available. Please pick again.',
      invalid_details: 'Please check your name, email and mobile number.',
      invalid: 'Something looks wrong with this form. Please try again.',
      invalid_reference: 'Enter the reference number from your GCash receipt (digits only).',
      reference_used: 'That reference number was already used for another booking. Check your receipt.',
      already_submitted: 'A payment was already submitted for this booking.',
      not_payable: 'This booking was cancelled. Please start a new booking.',
      not_found: "We couldn't find this booking. Please start again.",
      invalid_credentials: 'Wrong PIN. Try again.',
      over_request_rate_limit: 'Too many tries. Please wait a few minutes.',
      not_admin: 'This account is not the manager account.',
      signed_out: 'Please sign in again.'
    };
    if (map[c]) return map[c];
    if (e && e.status === 429) return map.over_request_rate_limit;
    if (e && e.status === 400 && e.code && /invalid|credential|grant/i.test(e.code)) return map.invalid_credentials;
    return 'Something went wrong. Please try again.';
  }

  /* ---------- tiny DOM builder (never uses innerHTML, so customer names can't inject code) ---------- */
  function h(tag, props) {
    const el = document.createElement(tag);
    Object.keys(props || {}).forEach((k) => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach((kid) => {
        if (kid === null || kid === undefined || kid === false) return;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      });
    }
    return el;
  }

  /* ---------- manager login (the PIN is the manager account's password) ---------- */
  const SKEY = 'gserve.admin';
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { session = null; }

  const saveSession = (s) => {
    session = s;
    try { s ? sessionStorage.setItem(SKEY, JSON.stringify(s)) : sessionStorage.removeItem(SKEY); } catch (e) { /* private mode */ }
  };
  const authRequest = (path, body) =>
    request(base + '/auth/v1/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_KEY }, body: JSON.stringify(body) });
  const keepTokens = (t) => saveSession({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000 - 30000 });

  async function refresh() {
    if (!session || !session.refresh_token) throw new ApiError('signed_out', 401);
    try { keepTokens(await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })); }
    catch (e) { saveSession(null); throw new ApiError('signed_out', 401); }
  }

  const admin = {
    signedIn: () => !!session,
    async login(pin) {
      keepTokens(await authRequest('token?grant_type=password', { email: CONFIG.MANAGER_EMAIL, password: pin }));
      let ok = false;
      try { ok = (await rpc('is_admin', {}, session.access_token)) === true; } catch (e) { ok = false; }
      if (!ok) { saveSession(null); throw new ApiError('not_admin', 403); }
    },
    logout() { saveSession(null); },
    async call(name, args) {
      if (!session) throw new ApiError('signed_out', 401);
      if (Date.now() > session.expires_at) await refresh();
      try { return await rpc(name, args, session.access_token); }
      catch (e) {
        if (e.status !== 401) throw e;
        await refresh();
        return rpc(name, args, session.access_token);
      }
    }
  };

  /* ---------- public API ---------- */
  let cfgPromise = null;
  window.Store = {
    configured: configured,
    ApiError: ApiError,
    config() { if (!cfgPromise) cfgPromise = rpc('get_config').catch((e) => { cfgPromise = null; throw e; }); return cfgPromise; },
    taken: (from, to) => rpc('get_taken_slots', { p_from: from, p_to: to }),
    hold: (a) => rpc('create_hold', { p_name: a.name, p_email: a.email, p_phone: a.phone, p_slots: a.slots, p_paddles: a.paddles, p_website: a.website || '' }),
    pay: (ref, email, gref) => rpc('submit_payment', { p_ref: ref, p_email: email, p_gcash_ref: gref }),
    release: (ref, email) => rpc('cancel_hold', { p_ref: ref, p_email: email }),
    find: (email) => rpc('find_bookings', { p_email: email }),
    admin: admin,
    h: h, peso: peso, parse: parse, toISO: toISO, addDays: addDays, zoned: zoned,
    dateLabel: dateLabel, dayLabel: dayLabel, monthLabel: monthLabel,
    hourLabel: hourLabel, rangeLabel: rangeLabel, mergeHours: mergeHours, byDate: byDate,
    isPeak: isPeak, price: price, STATUS: STATUS, errorText: errorText
  };
}());
