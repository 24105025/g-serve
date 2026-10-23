/*  G-Serve  |  js/book.js  (customer booking page)
    Calendar -> hours -> paddle rental -> cart -> GCash QR -> "I've paid".
    The server re-checks everything and the database blocks double bookings. */
(function () {
  'use strict';

  const S = window.Store;
  const h = S.h;
  const $ = (id) => document.getElementById(id);
  const el = {
    rates: $('rates'), cal: $('cal'), slots: $('slots'), cart: $('cart'), total: $('total'),
    form: $('form'), pay: $('pay'), checkout: $('checkout'), done: $('done'),
    find: $('find'), findEmail: $('find-email'), mine: $('mine'),
    dlg: $('dlg'), dlgTotal: $('dlg-total'), gref: $('gref'), gerr: $('gerr'), paid: $('paid'), cancel: $('cancel')
  };

  let cfg = null;
  const state = {
    month: '',                 // first day of the visible month, YYYY-MM-01
    days: new Set(),           // dates chosen on the calendar
    picked: {},                // date -> Set of start hours
    paddles: {},               // date -> number of paddles
    taken: new Map(),          // 'YYYY-MM-DD|hour' -> { held }
    hold: null,                // active payment hold
    busy: false
  };

  const msgEl = h('p', { id: 'form-msg', role: 'alert', class: 'text-sm min-h-[1.25rem]' });
  el.pay.before(msgEl);
  const say = (text, kind) => {
    msgEl.textContent = text || '';
    msgEl.className = 'text-sm min-h-[1.25rem] ' + (kind === 'info' ? 'text-lime' : 'text-red-300');
  };

  const nowZ = () => S.zoned(cfg.timezone);
  const key = (d, hr) => d + '|' + hr;

  function hoursOf(date) {
    const n = nowZ(), out = [];
    for (let hr = cfg.open_hour; hr < cfg.close_hour; hr++) {
      if (date === n.date && hr <= n.hour) continue;   // already started
      out.push(hr);
    }
    return out;
  }

  function dayStatus(date) {
    const n = nowZ();
    if (date < n.date) return 'past';
    if (date > S.addDays(n.date, cfg.max_days_ahead)) return 'out';
    return hoursOf(date).some((hr) => !state.taken.has(key(date, hr))) ? 'open' : 'full';
  }

  const countPicked = () => Object.keys(state.picked).reduce((n, d) => n + state.picked[d].size, 0);

  function cartData() {
    const slots = [], paddles = [];
    let total = 0;
    Array.from(state.days).sort().forEach((date) => {
      Array.from(state.picked[date] || []).sort((a, b) => a - b).forEach((hr) => {
        const p = S.price(cfg, date, hr);
        slots.push({ date: date, hour: hr, price: p });
        total += p;
      });
      const q = (state.picked[date] && state.picked[date].size) ? (state.paddles[date] || 0) : 0;
      if (q) { paddles.push({ date: date, qty: q, price: q * cfg.paddle_price }); total += q * cfg.paddle_price; }
    });
    return { slots: slots, paddles: paddles, total: total };
  }

  /* ---------- rates ---------- */
  function renderRates() {
    const pill = (title, sub) => h('div', { class: 'rounded-full border border-white/25 bg-deep/40 px-4 py-2 text-sm' },
      h('span', { class: 'font-bold' }, title), sub ? h('span', { class: 'ml-2 opacity-80' }, sub) : null);
    const out = [pill('Off-peak ' + S.peso(cfg.rate_offpeak) + '/hr')];
    if (cfg.rate_peak !== cfg.rate_offpeak) {
      out.push(pill('Peak ' + S.peso(cfg.rate_peak) + '/hr',
        S.hourLabel(cfg.peak_start) + ' to ' + S.hourLabel(cfg.peak_end) + (cfg.weekend_all_peak ? ' and all weekend' : '')));
    }
    out.push(pill('Paddle rental ' + S.peso(cfg.paddle_price), 'per paddle, per day'));
    out.push(pill('Open ' + S.hourLabel(cfg.open_hour) + ' to ' + S.hourLabel(cfg.close_hour)));
    el.rates.replaceChildren.apply(el.rates, out);
  }

  /* ---------- calendar ---------- */
  function renderCal(focusDate) {
    const first = S.parse(state.month);
    const y = first.getUTCFullYear(), m = first.getUTCMonth();
    const lead = first.getUTCDay();
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const n = nowZ();
    const thisMonth = n.date.slice(0, 7) + '-01';
    const lastMonth = S.addDays(n.date, cfg.max_days_ahead).slice(0, 7) + '-01';

    const nav = (label, text, disabled, delta) => h('button', {
      type: 'button', 'aria-label': label, disabled: disabled,
      class: 'h-10 w-10 rounded-full border border-white/25 text-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed',
      onClick: () => {
        const d = S.parse(state.month);
        state.month = S.toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)));
        renderCal();
      }
    }, text);

    const cells = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => h('div', { class: 'py-1 text-center text-xs opacity-70' }, d));
    for (let i = 0; i < lead; i++) cells.push(h('div'));
    for (let d = 1; d <= dim; d++) {
      const date = S.toISO(new Date(Date.UTC(y, m, d)));
      const st = dayStatus(date);
      const sel = state.days.has(date);
      const usable = st === 'open' || (st === 'full' && sel);
      let cls = 'relative h-11 rounded-lg border text-sm ';
      if (sel) cls += 'border-lime bg-lime font-bold text-deep ';
      else if (st === 'open') cls += 'border-white/20 hover:bg-white/10 ';
      else cls += 'border-white/10 opacity-35 cursor-not-allowed ' + (st === 'full' ? 'line-through ' : '');
      if (date === n.date && !sel) cls += 'ring-1 ring-line ';
      const hasPicks = state.picked[date] && state.picked[date].size;
      cells.push(h('button', {
        type: 'button', class: cls, disabled: !usable, 'data-d': date,
        'aria-pressed': sel ? 'true' : 'false',
        'aria-label': S.dateLabel(date) + (st === 'full' ? ', fully booked' : ''),
        onClick: () => {
          if (state.days.has(date)) { state.days.delete(date); delete state.picked[date]; delete state.paddles[date]; }
          else state.days.add(date);
          renderAll('[data-d="' + date + '"]');
        }
      }, String(d), hasPicks ? h('span', { class: 'absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ' + (sel ? 'bg-deep' : 'bg-lime') }) : null));
    }

    el.cal.replaceChildren(
      h('h2', { class: 'font-display text-2xl' }, 'Choose your days'),
      h('p', { class: 'mt-1 text-sm opacity-80' }, 'You can pick more than one day.'),
      h('div', { class: 'mt-4 flex items-center justify-between' },
        nav('Previous month', '\u2039', state.month <= thisMonth, -1),
        h('p', { class: 'font-bold', 'aria-live': 'polite' }, S.monthLabel(state.month)),
        nav('Next month', '\u203A', state.month >= lastMonth, 1)),
      h('div', { class: 'mt-3 grid grid-cols-7 gap-1' }, cells));
    if (focusDate) { const f = el.cal.querySelector(focusDate); if (f && !f.disabled) f.focus(); }
  }

  /* ---------- hours + paddles ---------- */
  function renderSlots(focusSel) {
    const title = h('h2', { class: 'font-display text-2xl' }, 'Choose your hours');
    if (!state.days.size) {
      el.slots.replaceChildren(title, h('p', { class: 'mt-2 opacity-80' }, 'Pick one or more days above to see open times.'));
      return;
    }
    const blocks = Array.from(state.days).sort().map((date) => {
      const picked = state.picked[date] || new Set();
      const hrs = hoursOf(date);
      const grid = h('div', { class: 'mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4' }, hrs.map((hr) => {
        const t = state.taken.get(key(date, hr));
        const on = picked.has(hr);
        const peak = S.isPeak(cfg, date, hr) && cfg.rate_peak !== cfg.rate_offpeak;
        let cls = 'rounded-lg border px-3 py-2 text-left ';
        if (on) cls += 'border-lime bg-lime text-deep';
        else if (t) cls += 'border-white/10 opacity-40 cursor-not-allowed';
        else cls += 'border-white/25 hover:bg-white/10';
        return h('button', {
          type: 'button', class: cls, disabled: !!t && !on, 'data-k': key(date, hr), 'aria-pressed': on ? 'true' : 'false',
          onClick: () => toggleHour(date, hr)
        },
          h('span', { class: 'block font-bold' }, S.rangeLabel(hr, hr + 1)),
          h('span', { class: 'block text-xs ' + (on ? '' : 'opacity-80') },
            t ? (t.held ? 'On hold' : 'Taken') : S.peso(S.price(cfg, date, hr)) + (peak ? ' (peak)' : '')));
      }));

      const qty = picked.size ? (state.paddles[date] || 0) : 0;
      const step = (label, text, delta, off) => h('button', {
        type: 'button', 'aria-label': label + ' for ' + S.dateLabel(date), disabled: off, 'data-k': 'pad|' + date + '|' + delta,
        class: 'h-9 w-9 rounded-full border border-white/30 text-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed',
        onClick: () => { state.paddles[date] = Math.max(0, Math.min(cfg.max_paddles, qty + delta)); renderSlots('[data-k="pad|' + date + '|' + delta + '"]'); renderCart(); }
      }, text);

      return h('div', { class: 'border-t border-white/15 pt-5 mt-5 first:mt-4 first:border-0 first:pt-0' },
        h('div', { class: 'flex items-center justify-between gap-3' },
          h('h3', { class: 'text-lg font-bold' }, S.dateLabel(date)),
          h('button', {
            type: 'button', class: 'text-sm underline',
            onClick: () => { state.days.delete(date); delete state.picked[date]; delete state.paddles[date]; renderAll(); }
          }, 'Remove day')),
        hrs.length ? grid : h('p', { class: 'mt-3 opacity-80' }, 'No more times today.'),
        h('div', { class: 'mt-4 flex items-center justify-between gap-3 rounded-lg bg-deep/50 px-4 py-3' },
          h('div', {},
            h('p', { class: 'font-bold' }, 'Paddle rental'),
            h('p', { class: 'text-xs opacity-80' }, S.peso(cfg.paddle_price) + ' per paddle, per day')),
          h('div', { class: 'flex items-center gap-3' },
            step('Fewer paddles', '\u2212', -1, qty <= 0),
            h('span', { class: 'w-6 text-center font-bold', 'aria-live': 'polite' }, String(qty)),
            step('More paddles', '+', 1, !picked.size || qty >= cfg.max_paddles))));
    });
    el.slots.replaceChildren.apply(el.slots, [title].concat(blocks));
    if (focusSel) { const f = el.slots.querySelector(focusSel); if (f && !f.disabled) f.focus(); }
  }

  function toggleHour(date, hr) {
    const set = state.picked[date] || (state.picked[date] = new Set());
    if (set.has(hr)) set.delete(hr);
    else {
      if (countPicked() >= cfg.max_slots) { say('You can book up to ' + cfg.max_slots + ' hours in one booking. Pay for these first, then book again.'); return; }
      set.add(hr);
    }
    if (!set.size) delete state.paddles[date];
    say('');
    renderSlots('[data-k="' + key(date, hr) + '"]');
    renderCart();
    renderCal();
  }

  /* ---------- cart ---------- */
  function renderCart() {
    const c = cartData();
    const items = [];
    c.slots.forEach((s) => items.push(h('li', { class: 'flex items-start justify-between gap-3 py-2' },
      h('div', {}, h('p', { class: 'text-sm opacity-80' }, S.dateLabel(s.date)), h('p', { class: 'font-bold' }, S.rangeLabel(s.hour, s.hour + 1))),
      h('div', { class: 'flex items-center gap-2' },
        h('span', {}, S.peso(s.price)),
        h('button', {
          type: 'button', class: 'h-8 w-8 rounded-full hover:bg-white/10', 'aria-label': 'Remove ' + S.dateLabel(s.date) + ' ' + S.hourLabel(s.hour),
          onClick: () => toggleHour(s.date, s.hour)
        }, '\u2715')))));
    c.paddles.forEach((p) => items.push(h('li', { class: 'flex items-start justify-between gap-3 py-2' },
      h('div', {}, h('p', { class: 'text-sm opacity-80' }, S.dateLabel(p.date)), h('p', { class: 'font-bold' }, 'Paddle rental \u00D7 ' + p.qty)),
      h('div', { class: 'flex items-center gap-2' },
        h('span', {}, S.peso(p.price)),
        h('button', {
          type: 'button', class: 'h-8 w-8 rounded-full hover:bg-white/10', 'aria-label': 'Remove paddle rental for ' + S.dateLabel(p.date),
          onClick: () => { state.paddles[p.date] = 0; renderSlots(); renderCart(); }
        }, '\u2715')))));
    if (!items.length) items.push(h('li', { class: 'py-3 opacity-70' }, 'Nothing selected yet.'));
    el.cart.replaceChildren.apply(el.cart, items);
    el.total.textContent = S.peso(c.total);
    el.pay.disabled = !c.slots.length || state.busy;
  }

  function renderAll(focusCal) { renderCal(focusCal); renderSlots(); renderCart(); }

  /* ---------- availability from the server ---------- */
  async function refreshTaken() {
    if (!cfg) return;
    const n = nowZ();
    try {
      const rows = await S.taken(n.date, S.addDays(n.date, cfg.max_days_ahead));
      state.taken = new Map(rows.map((r) => [key(r.date, r.hour), { held: !!r.held }]));
    } catch (e) { return; }       // keep showing the last known list
    let removed = 0;
    if (!state.hold) {            // while paying, the customer's own hold looks "taken", so skip pruning
      Object.keys(state.picked).forEach((date) => {
        Array.from(state.picked[date]).forEach((hr) => {
          if (state.taken.has(key(date, hr))) { state.picked[date].delete(hr); removed++; }
        });
        if (!state.picked[date].size) delete state.paddles[date];
      });
    }
    if (removed) say('Some times were just booked by someone else and were removed from your list.');
    renderAll();
  }

  /* ---------- payment dialog ---------- */
  const refLine = h('p', { id: 'dlg-ref', class: 'mt-2 text-center text-sm' });
  const timerLine = h('p', { id: 'dlg-timer', class: 'mt-1 text-center text-sm opacity-80' });
  el.dlgTotal.parentElement.after(refLine, timerLine);
  let timer = null, deadline = 0;

  function tick() {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    timerLine.textContent = left > 0
      ? 'Your times are held for ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0')
      : "The hold has expired. If you've already paid, enter your reference anyway and we'll check if your times are still free.";
  }

  function openPay(hold) {
    state.hold = hold;
    el.dlgTotal.textContent = S.peso(hold.amount);
    refLine.textContent = 'Booking reference ' + hold.ref;
    el.gref.value = ''; el.gerr.textContent = '';
    deadline = Date.now() + hold.expires_in * 1000;
    tick(); clearInterval(timer); timer = setInterval(tick, 1000);
    if (typeof el.dlg.showModal === 'function') el.dlg.showModal(); else el.dlg.setAttribute('open', '');
    el.gref.focus();
  }

  function closePay() {
    clearInterval(timer);
    if (el.dlg.open) el.dlg.close();
  }

  async function cancelHold() {
    const hold = state.hold;
    closePay();
    state.hold = null;
    if (hold) { try { await S.release(hold.ref, hold.email); } catch (e) { /* it will expire on its own */ } }
    refreshTaken();
  }

  /* ---------- confirmation panel ---------- */
  function showDone(hold, late) {
    const lines = S.byDate(hold.slots).map((g) => h('li', { class: 'py-2' },
      h('p', { class: 'text-sm opacity-80' }, S.dateLabel(g.date)),
      h('p', { class: 'font-bold' }, g.ranges.map((r) => S.rangeLabel(r[0], r[1])).join(', '))));
    hold.paddles.forEach((p) => lines.push(h('li', { class: 'py-2' },
      h('p', { class: 'text-sm opacity-80' }, S.dateLabel(p.date)), h('p', { class: 'font-bold' }, 'Paddle rental \u00D7 ' + p.qty))));

    const title = h('h2', { class: 'font-display text-2xl', tabindex: '-1' }, late ? 'Payment received, but your times were taken' : 'Booking received');
    el.done.replaceChildren(
      title,
      h('p', { class: 'mt-3 text-sm opacity-80' }, 'Booking reference'),
      h('p', { class: 'font-display text-3xl text-lime' }, hold.ref),
      h('ul', { class: 'mt-3 divide-y divide-white/15' }, lines),
      h('p', { class: 'mt-2 flex justify-between font-bold text-lg' }, h('span', {}, 'Total'), h('span', {}, S.peso(hold.amount))),
      late
        ? h('p', { class: 'mt-4 text-sm' }, "Your payment arrived after the hold ran out and someone else booked those times. We've recorded your GCash reference and will contact you at " + hold.email + ' to rebook or refund you.')
        : h('p', { class: 'mt-4 text-sm' }, "We're checking your GCash payment. Your times are on hold, and we'll email " + hold.email + ' as soon as the booking is confirmed. Check your spam folder if you do not see it.'),
      h('button', {
        type: 'button', class: 'mt-5 w-full rounded-full border border-chalk/50 py-3 hover:bg-white/10',
        onClick: () => { el.done.hidden = true; el.checkout.hidden = false; say(''); renderAll(); refreshTaken(); }
      }, 'Make another booking'));
    el.checkout.hidden = true;
    el.done.hidden = false;
    title.focus();
  }

  /* ---------- events ---------- */
  el.form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (state.busy) return;
    if (el.form.elements.website && el.form.elements.website.value) return;      // bot trap
    const c = cartData();
    if (!c.slots.length) { say('Pick at least one hour first.'); return; }
    state.busy = true; renderCart(); say('');
    const label = el.pay.textContent; el.pay.textContent = 'Holding your times\u2026';
    try {
      const r = await S.hold({
        name: el.form.elements.name.value, email: el.form.elements.email.value, phone: el.form.elements.phone.value,
        slots: c.slots.map((s) => ({ date: s.date, hour: s.hour })),
        paddles: c.paddles.map((p) => ({ date: p.date, qty: p.qty })),
        website: el.form.elements.website ? el.form.elements.website.value : ''
      });
      if (r.ok) {
        openPay({ ref: r.ref, amount: r.amount, expires_in: r.expires_in, slots: r.slots, paddles: r.paddles, email: el.form.elements.email.value.trim().toLowerCase() });
      } else {
        say(S.errorText(r), 'error');
        if (r.error === 'slot_taken' || r.error === 'past_slot' || r.error === 'invalid_slots') await refreshTaken();
      }
    } catch (e) { say(S.errorText(e), 'error'); }
    state.busy = false; el.pay.textContent = label; renderCart();
  });

  el.paid.addEventListener('click', async () => {
    const hold = state.hold;
    if (!hold || state.busy) return;
    const ref = el.gref.value.replace(/\D/g, '');
    if (ref.length < 8 || ref.length > 20) { el.gerr.textContent = S.errorText({ code: 'invalid_reference' }); el.gref.focus(); return; }
    el.gerr.textContent = '';
    state.busy = true; el.paid.disabled = true; el.cancel.disabled = true;
    try {
      const r = await S.pay(hold.ref, hold.email, ref);
      if (r.ok) {
        closePay(); state.hold = null;
        showDone(hold, false);
        state.days.clear(); state.picked = {}; state.paddles = {};
        refreshTaken();
      } else if (r.error === 'late_conflict') {
        closePay(); state.hold = null;
        showDone(hold, true);
        state.days.clear(); state.picked = {}; state.paddles = {};
        refreshTaken();
      } else {
        el.gerr.textContent = S.errorText(r);
      }
    } catch (e) { el.gerr.textContent = S.errorText(e); }
    state.busy = false; el.paid.disabled = false; el.cancel.disabled = false;
  });

  el.cancel.addEventListener('click', cancelHold);
  el.dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); if (!state.busy) cancelHold(); });   // Esc key = Cancel

  el.find.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = el.findEmail.value.trim();
    if (!email) return;
    el.mine.replaceChildren(h('li', { class: 'py-3 opacity-70' }, 'Searching\u2026'));
    try {
      const rows = await S.find(email);
      if (!rows.length) { el.mine.replaceChildren(h('li', { class: 'py-3 opacity-70' }, 'No bookings found for that email.')); return; }
      const tone = { confirmed: 'bg-lime text-deep', pending: 'bg-line text-deep', rejected: 'bg-red-300 text-deep', cancelled: 'bg-white/20', expired: 'bg-red-300 text-deep' };
      el.mine.replaceChildren.apply(el.mine, rows.map((b) => {
        const parts = S.byDate(b.slots).map((g) => S.dateLabel(g.date) + ': ' + g.ranges.map((r) => S.rangeLabel(r[0], r[1])).join(', '));
        (b.paddles || []).forEach((p) => parts.push('Paddle rental \u00D7 ' + p.qty + ' (' + S.dayLabel(p.date) + ')'));
        return h('li', { class: 'py-3' },
          h('div', { class: 'flex items-center justify-between gap-3' },
            h('span', { class: 'font-bold' }, b.ref),
            h('span', { class: 'rounded-full px-3 py-0.5 text-xs font-bold ' + (tone[b.status] || 'bg-white/20') }, S.STATUS[b.status] || b.status)),
          parts.map((t) => h('p', { class: 'text-sm' }, t)),
          h('p', { class: 'mt-1 text-sm opacity-80' }, S.peso(b.amount)),
          b.admin_note ? h('p', { class: 'mt-1 text-sm opacity-80' }, 'Note: ' + b.admin_note) : null);
      }));
    } catch (e) { el.mine.replaceChildren(h('li', { class: 'py-3 text-red-300' }, S.errorText(e))); }
  });

  /* ---------- start ---------- */
  async function boot() {
    if (!S.configured) {
      const note = h('p', { class: 'rounded-lg border border-line p-4' }, S.errorText({ code: 'not_configured' }));
      el.cal.replaceChildren(note);
      el.pay.disabled = true;
      return;
    }
    el.pay.disabled = true;
    try { cfg = await S.config(); }
    catch (e) { el.cal.replaceChildren(h('p', { class: 'rounded-lg border border-line p-4' }, S.errorText(e))); return; }
    state.month = nowZ().date.slice(0, 7) + '-01';
    renderRates(); renderAll();
    await refreshTaken();
    setInterval(() => { if (!document.hidden && !state.busy) refreshTaken(); }, 45000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTaken(); });
  }
  boot();
}());
