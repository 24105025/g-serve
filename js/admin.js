/*  G-Serve  |  js/admin.js  (private manager dashboard)
    Sign-in uses the manager account in Supabase (the PIN is its password).
    Every dashboard call is checked again on the server, so hiding this page is not what protects it. */
(function () {
  'use strict';

  const S = window.Store;
  const h = S.h;
  const $ = (id) => document.getElementById(id);
  const el = {
    gate: $('gate'), gateForm: $('gate-form'), pin: $('pin'), gateMsg: $('gate-msg'),
    dash: $('dash'), month: $('month'), seed: $('seed'), clear: $('clear'),
    stats: $('stats'), chart: $('chart'), tx: $('tx'), ov: $('ov')
  };

  let cfg = { timezone: 'Asia/Manila' };
  let data = { bookings: [], pending_all: 0 };
  let loading = false, poll = null;

  /* extra controls created here so admin.html stays exactly as drafted */
  el.seed.textContent = 'Add sample bookings';
  el.clear.textContent = 'Clear samples';
  const refreshBtn = h('button', { type: 'button', id: 'refresh', class: 'border border-chalk/50 rounded-full px-5 py-2.5 hover:bg-white/10' }, 'Refresh');
  const outBtn = h('button', { type: 'button', id: 'logout', class: 'underline py-2.5' }, 'Sign out');
  el.clear.after(refreshBtn, outBtn);
  const note = h('p', { id: 'dash-msg', role: 'status', class: 'mt-4 text-sm min-h-[1.25rem]' });
  el.stats.before(note);
  const say = (t, bad) => { note.textContent = t || ''; note.className = 'mt-4 text-sm min-h-[1.25rem] ' + (bad ? 'text-red-300' : 'text-lime'); };

  const BADGE = {
    confirmed: 'bg-lime text-deep', pending: 'bg-line text-deep', rejected: 'bg-red-300 text-deep',
    cancelled: 'bg-white/20', expired: 'bg-red-300 text-deep'
  };

  /* ---------- money helpers: revenue is counted per play date ---------- */
  const monthKey = () => el.month.value;                       // 'YYYY-MM'
  const inMonth = (date) => date.slice(0, 7) === monthKey();

  function dayRevenue(b) {                                     // -> { 'YYYY-MM-DD': pesos }
    const out = {};
    b.slots.forEach((s) => { out[s.date] = (out[s.date] || 0) + s.price; });
    (b.paddles || []).forEach((p) => { out[p.date] = (out[p.date] || 0) + p.price; });
    return out;
  }

  /* ---------- rendering ---------- */
  function renderStats() {
    let revenue = 0, bookings = 0, paddles = 0;
    data.bookings.forEach((b) => {
      if (b.status !== 'confirmed') return;
      const rev = dayRevenue(b);
      let touched = false;
      Object.keys(rev).forEach((d) => { if (inMonth(d)) { revenue += rev[d]; touched = true; } });
      (b.paddles || []).forEach((p) => { if (inMonth(p.date)) paddles += p.qty; });
      if (touched) bookings++;
    });
    const card = (label, value, hot) => h('div', { class: 'panel' + (hot ? ' ring-2 ring-lime' : '') },
      h('p', { class: 'text-sm opacity-80' }, label), h('p', { class: 'font-display text-3xl mt-1' }, value));
    el.stats.replaceChildren(
      card('Confirmed revenue', S.peso(revenue)),
      card('Confirmed bookings', String(bookings)),
      card('Paddles rented', String(paddles)),
      card('Awaiting payment check', String(data.pending_all), data.pending_all > 0));
  }

  function renderChart() {
    const first = S.parse(monthKey() + '-01');
    const y = first.getUTCFullYear(), m = first.getUTCMonth();
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const perDay = new Array(dim + 1).fill(0);
    data.bookings.forEach((b) => {
      if (b.status !== 'confirmed') return;
      const rev = dayRevenue(b);
      Object.keys(rev).forEach((d) => { if (inMonth(d)) perDay[Number(d.slice(8, 10))] += rev[d]; });
    });
    const max = Math.max.apply(null, perDay.concat([1]));
    const total = perDay.reduce((a, b) => a + b, 0);
    el.chart.setAttribute('role', 'img');
    el.chart.setAttribute('aria-label', 'Daily confirmed revenue for ' + S.monthLabel(monthKey() + '-01') + '. Total ' + S.peso(total));
    const cols = [];
    for (let d = 1; d <= dim; d++) {
      const v = perDay[d];
      cols.push(h('div', { class: 'flex min-w-0 flex-1 flex-col', title: S.dayLabel(monthKey() + '-' + String(d).padStart(2, '0')) + ': ' + S.peso(v) },
        h('div', { class: 'flex flex-1 items-end' },
          h('div', { class: 'w-full rounded-t ' + (v ? 'bg-lime' : 'bg-white/10'), style: 'height:' + (v ? Math.max(4, Math.round(v / max * 100)) : 2) + '%' })),
        h('span', { class: 'mt-1 text-center text-[9px] opacity-70 sm:text-[10px]' }, String(d))));
    }
    el.chart.replaceChildren.apply(el.chart, cols);
  }

  const slotText = (b) => {
    const parts = S.byDate(b.slots).map((g) => S.dayLabel(g.date) + ': ' + g.ranges.map((r) => S.rangeLabel(r[0], r[1])).join(', '));
    (b.paddles || []).forEach((p) => parts.push('Paddle rental \u00D7 ' + p.qty + ' (' + S.dayLabel(p.date) + ')'));
    return parts;
  };

  function renderTx() {
    const rows = data.bookings.slice().sort((a, b) => {
      if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
      return a.status === 'pending' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at);
    });
    if (!rows.length) {
      el.tx.replaceChildren(h('tr', {}, h('td', { class: 'p-2 opacity-70', colspan: '5' }, 'No bookings for this month yet.')));
      return;
    }
    el.tx.replaceChildren.apply(el.tx, rows.map((b) => {
      const acts = [];
      if (b.status === 'pending') {
        acts.push(h('button', { type: 'button', class: 'rounded-full bg-lime px-4 py-1.5 font-bold text-deep', onClick: () => decide(b, 'confirmed') }, 'Confirm'));
        acts.push(h('button', { type: 'button', class: 'rounded-full border border-chalk/50 px-4 py-1.5 hover:bg-white/10', onClick: () => decide(b, 'rejected') }, 'Reject'));
      } else if (b.status === 'confirmed') {
        acts.push(h('button', { type: 'button', class: 'text-xs underline', onClick: () => decide(b, 'cancelled') }, 'Cancel booking'));
      }
      return h('tr', { class: 'border-t border-white/10 align-top' },
        h('td', { class: 'p-2' },
          h('p', { class: 'font-bold' }, b.ref),
          b.is_sample ? h('p', { class: 'text-xs opacity-70' }, 'sample data') : null,
          h('p', { class: 'text-xs opacity-80' }, 'GCash ref: ' + (b.gcash_ref || 'not entered'))),
        h('td', { class: 'p-2' }, h('p', {}, b.name), h('p', { class: 'text-xs opacity-80' }, b.email), h('p', { class: 'text-xs opacity-80' }, b.phone)),
        h('td', { class: 'p-2' }, slotText(b).map((t) => h('p', {}, t))),
        h('td', { class: 'p-2 whitespace-nowrap font-bold' }, S.peso(b.amount)),
        h('td', { class: 'p-2' },
          h('span', { class: 'inline-block rounded-full px-3 py-0.5 text-xs font-bold ' + (BADGE[b.status] || 'bg-white/20') }, S.STATUS[b.status] || b.status),
          b.admin_note ? h('p', { class: 'mt-1 max-w-[14rem] text-xs opacity-80' }, b.admin_note) : null,
          h('div', { class: 'mt-2 flex flex-wrap items-center gap-2' }, acts)));
    }));
  }

  function renderCalendar() {
    const first = S.parse(monthKey() + '-01');
    const y = first.getUTCFullYear(), m = first.getUTCMonth();
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const today = S.zoned(cfg.timezone).date;
    const byDay = {};
    data.bookings.forEach((b) => {
      if (b.status !== 'confirmed' && b.status !== 'pending') return;
      b.slots.forEach((s) => { if (inMonth(s.date)) (byDay[s.date] = byDay[s.date] || []).push({ hour: s.hour, b: b }); });
    });
    const cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => h('div', { class: 'py-1 text-center text-xs opacity-70' }, d));
    for (let i = 0; i < first.getUTCDay(); i++) cells.push(h('div'));
    for (let d = 1; d <= dim; d++) {
      const date = S.toISO(new Date(Date.UTC(y, m, d)));
      const list = (byDay[date] || []).sort((a, b) => a.hour - b.hour);
      const shown = list.slice(0, 4).map((x) => h('p', { class: 'truncate rounded px-1 ' + (x.b.status === 'confirmed' ? 'bg-lime/90 text-deep' : 'bg-line/90 text-deep'), title: x.b.name + ' (' + S.STATUS[x.b.status] + ')' },
        S.hourLabel(x.hour).replace(':00', '') + ' ' + x.b.name.split(' ')[0]));
      cells.push(h('div', { class: 'min-h-[5.5rem] rounded-lg border bg-deep/60 p-1.5 text-xs ' + (date === today ? 'border-line' : 'border-white/10') },
        h('p', { class: 'mb-1 font-bold opacity-80' }, String(d)),
        h('div', { class: 'grid gap-0.5' }, shown, list.length > 4 ? h('p', { class: 'opacity-70' }, '+' + (list.length - 4) + ' more') : null)));
    }
    el.ov.replaceChildren.apply(el.ov, cells);
  }

  const renderAll = () => { renderStats(); renderChart(); renderTx(); renderCalendar(); };

  /* ---------- data ---------- */
  async function load(quiet) {
    if (loading) return;
    loading = true;
    try {
      data = await S.admin.call('admin_dashboard', { p_month: monthKey() + '-01' });
      renderAll();
      if (!quiet) say('');
    } catch (e) {
      if (e.code === 'signed_out' || e.status === 401 || e.status === 403) { lock('Your session ended. Enter your PIN again.'); }
      else say(S.errorText(e), true);
    }
    loading = false;
  }

  async function decide(b, status) {
    let reason = null;
    if (status === 'confirmed') {
      if (!window.confirm('Confirm ' + b.ref + '?\n\nGCash reference: ' + b.gcash_ref + '\nAmount: ' + S.peso(b.amount) +
        '\n\nOnly confirm if both match your GCash transaction history. The customer will be emailed.')) return;
    } else {
      reason = window.prompt(status === 'rejected'
        ? 'Reject ' + b.ref + '. The times will be released and the customer will be emailed.\n\nReason shown to the customer (optional):'
        : 'Cancel ' + b.ref + '. The times will be released and the customer will be emailed.\n\nNote for the customer (optional, e.g. refund details):', '');
      if (reason === null) return;
    }
    say('Saving\u2026');
    try {
      const r = await S.admin.call('admin_set_status', { p_id: b.id, p_status: status, p_note: reason });
      if (!r.ok) { say(r.error === 'bad_transition' ? 'That booking has already changed. Refreshing.' : 'Could not save. Refreshing.', true); }
      else say(b.ref + ' ' + (status === 'confirmed' ? 'confirmed. The customer has been emailed.' : status === 'rejected' ? 'rejected and the times were released.' : 'cancelled and the times were released.'));
      await load(true);
    } catch (e) { say(S.errorText(e), true); }
  }

  /* ---------- sign in / out ---------- */
  function lock(text) {
    clearInterval(poll);
    S.admin.logout();
    el.dash.hidden = true; el.gate.hidden = false;
    el.pin.value = ''; el.gateMsg.textContent = text || '';
    el.gateMsg.className = 'text-sm text-red-300';
  }

  async function openDash() {
    el.gate.hidden = true; el.dash.hidden = false;
    try { cfg = await S.config(); } catch (e) { /* keep default timezone */ }
    if (!el.month.value) el.month.value = S.zoned(cfg.timezone).date.slice(0, 7);
    await load();
    clearInterval(poll);
    poll = setInterval(() => { if (!document.hidden) load(true); }, 45000);
  }

  el.gateForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = el.gateForm.querySelector('button');
    el.gateMsg.className = 'text-sm'; el.gateMsg.textContent = 'Checking\u2026'; btn.disabled = true;
    try {
      await S.admin.login(el.pin.value);
      el.pin.value = ''; el.gateMsg.textContent = '';
      await openDash();
    } catch (e) {
      el.gateMsg.className = 'text-sm text-red-300';
      el.gateMsg.textContent = S.errorText(e);
    }
    btn.disabled = false;
  });

  el.month.addEventListener('change', () => { if (el.month.value) load(); });
  refreshBtn.addEventListener('click', () => load());
  outBtn.addEventListener('click', () => lock('Signed out.'));

  el.seed.addEventListener('click', async () => {
    try { await S.admin.call('admin_add_samples'); say('Sample bookings added (they never block real customers). Use "Clear samples" to remove them.'); await load(true); }
    catch (e) { say(S.errorText(e), true); }
  });
  el.clear.addEventListener('click', async () => {
    if (!window.confirm('Remove all SAMPLE bookings?\n\nReal customer bookings are never deleted from here.')) return;
    try { await S.admin.call('admin_clear_samples'); say('Sample bookings removed.'); await load(true); }
    catch (e) { say(S.errorText(e), true); }
  });

  /* ---------- start ---------- */
  if (!S.configured) {
    el.gateMsg.className = 'text-sm text-red-300';
    el.gateMsg.textContent = S.errorText({ code: 'not_configured' });
    el.gateForm.querySelector('button').disabled = true;
  } else if (S.admin.signedIn()) {
    openDash();
  }
}());
