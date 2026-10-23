/**
 * G-SERVE  |  email sender
 * Paste this whole file into a new project at https://script.google.com,
 * change SECRET below, then Deploy > New deployment > Web app.
 * Emails are sent from the Google account that owns this script.
 */

// Choose a long random password (20+ characters). The SAME text goes into 02-connect-email.sql.
const SECRET = 'G-SERVE 2026 - LIFETIME';

// ---------------------------------------------------------------------
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.secret || data.secret !== SECRET) return reply_({ ok: false, error: 'forbidden' });
    handle_(data);
    return reply_({ ok: true });
  } catch (err) {
    console.error(err);
    return reply_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return reply_({ ok: true, service: 'G-Serve email sender is running' });
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
function handle_(d) {
  const b = d.booking;
  const biz = d.business || 'G-Serve';
  const manager = d.manager_email;
  const first = String(b.name || '').trim().split(/\s+/)[0] || 'there';
  const adminUrl = base_(d.site_url) + 'admin.html';
  const bookUrl = base_(d.site_url) + 'book.html';
  const details = details_(d);

  switch (d.event) {
    case 'received':
      send_(b.email, biz + ': we received your booking ' + b.ref,
        wrap_(biz, 'Booking received',
          p_('Hi ' + esc_(first) + ','),
          p_('Thanks for booking with ' + esc_(biz) + '. We have your GCash reference <b>' + esc_(b.gcash_ref) +
             '</b> and your times are on hold while we check the payment. You will get another email as soon as it is confirmed.'),
          details), manager, biz);
      send_(manager, 'New booking to verify: ' + b.ref + ' (' + peso_(b.amount) + ')',
        wrap_(biz, 'New booking to verify',
          p_('<b>' + esc_(b.name) + '</b> (' + esc_(b.email) + ', ' + esc_(b.phone) + ') just paid by GCash.'),
          p_('Check that the GCash reference <b>' + esc_(b.gcash_ref) + '</b> and the amount <b>' + peso_(b.amount) +
             '</b> match your GCash history, then press Confirm or Reject in the dashboard.'),
          details,
          button_('Open dashboard', adminUrl)), b.email, biz + ' bookings');
      break;

    case 'confirmed':
      send_(b.email, biz + ': booking confirmed (' + b.ref + ')',
        wrap_(biz, 'You are booked!',
          p_('Hi ' + esc_(first) + ', your payment is verified and your court time is confirmed. Keep this email as your booking reference.'),
          details), manager, biz);
      break;

    case 'rejected':
      send_(b.email, biz + ': we could not verify your payment (' + b.ref + ')',
        wrap_(biz, 'We could not verify your payment',
          p_('Hi ' + esc_(first) + ', we could not match your GCash payment to this booking, so the times were released.'),
          b.note ? p_('<b>Note from us:</b> ' + esc_(b.note)) : '',
          p_('If you did pay, just reply to this email with a screenshot of your GCash receipt and we will sort it out.'),
          details, button_('Book again', bookUrl)), manager, biz);
      break;

    case 'cancelled':
      send_(b.email, biz + ': booking cancelled (' + b.ref + ')',
        wrap_(biz, 'Your booking was cancelled',
          p_('Hi ' + esc_(first) + ', this booking has been cancelled and the times are free again.'),
          b.note ? p_('<b>Note from us:</b> ' + esc_(b.note)) : '',
          p_('Questions about a refund? Just reply to this email.'),
          details), manager, biz);
      break;

    case 'late_conflict':
      send_(b.email, biz + ': action needed for booking ' + b.ref,
        wrap_(biz, 'We received your payment, but the times were taken',
          p_('Hi ' + esc_(first) + ', your payment arrived after the hold on your times expired, and someone else booked them in the meantime. ' +
             'We have your GCash reference <b>' + esc_(b.gcash_ref) + '</b> and will contact you to rebook you or refund you. You can also reply to this email.'),
          details), manager, biz);
      send_(manager, 'ACTION NEEDED: late payment for ' + b.ref,
        wrap_(biz, 'Late payment, times already taken',
          p_('<b>' + esc_(b.name) + '</b> (' + esc_(b.email) + ', ' + esc_(b.phone) + ') paid GCash ref <b>' + esc_(b.gcash_ref) +
             '</b> for ' + peso_(b.amount) + ' after the hold expired, and the times were booked by someone else. Rebook or refund this customer.'),
          details, button_('Open dashboard', adminUrl)), b.email, biz + ' bookings');
      break;

    default:
      throw new Error('Unknown event: ' + d.event);
  }
}

// ---------------------------------------------------------------------
function send_(to, subject, html, replyTo, senderName) {
  if (!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: subject,
      htmlBody: html,
      body: html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      name: senderName || 'G-Serve',
      replyTo: replyTo || ''
    });
  } catch (err) {
    console.error('Could not email ' + to + ': ' + err);
  }
}

// ---------------------------------------------------------------------
// Email layout (brand colours from the website)
function wrap_(biz, title) {
  const body = Array.prototype.slice.call(arguments, 2).join('');
  return '<div style="background:#f6f7f2;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#0e3322">' +
    '<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">' +
    '<tr><td style="background:#0e3322;color:#c9f31d;padding:18px 24px;font-size:22px;font-weight:bold;font-style:italic">' + esc_(biz) + '</td></tr>' +
    '<tr><td style="padding:24px">' +
    '<h1 style="margin:0 0 14px;font-size:20px;color:#0e3322">' + esc_(title) + '</h1>' + body +
    '</td></tr>' +
    '<tr><td style="padding:14px 24px;background:#f6f7f2;font-size:12px;color:#5b6b61">' + esc_(biz) + ' &middot; Play. Serve. Connect.</td></tr>' +
    '</table></div>';
}

function p_(html) { return '<p style="margin:0 0 14px;font-size:15px;line-height:1.5">' + html + '</p>'; }

function button_(label, url) {
  return '<p style="margin:18px 0 0"><a href="' + esc_(url) + '" style="background:#c9f31d;color:#092216;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px;display:inline-block">' +
    esc_(label) + '</a></p>';
}

function details_(d) {
  const b = d.booking;
  const byDate = {};
  (d.slots || []).forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s.hour); });
  let rows = '';
  Object.keys(byDate).sort().forEach(function (date) {
    rows += row_(dateLabel_(date), ranges_(byDate[date]));
  });
  (b.paddles || []).forEach(function (p) {
    rows += row_(dateLabel_(p.date), 'Paddle rental &times; ' + p.qty);
  });
  return '<table role="presentation" width="100%" style="border-collapse:collapse;margin:6px 0 0;font-size:14px">' +
    '<tr><td colspan="2" style="padding:8px 0;border-bottom:2px solid #0e3322;font-weight:bold">Booking ' + esc_(b.ref) + '</td></tr>' +
    rows +
    '<tr><td style="padding:10px 0;font-weight:bold">Total</td><td style="padding:10px 0;text-align:right;font-weight:bold">' + peso_(b.amount) + '</td></tr>' +
    '<tr><td colspan="2" style="padding:0 0 4px;color:#5b6b61;font-size:12px">' + esc_(d.court || '') + '</td></tr></table>';
}

function row_(left, right) {
  return '<tr><td style="padding:8px 8px 8px 0;border-bottom:1px solid #e3e8e1;vertical-align:top">' + esc_(left) +
    '</td><td style="padding:8px 0;border-bottom:1px solid #e3e8e1;text-align:right;vertical-align:top">' + right + '</td></tr>';
}

// ---------------------------------------------------------------------
// Small helpers
function esc_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function peso_(n) { return '\u20B1' + Number(n || 0).toLocaleString('en-US'); }

function base_(url) { url = String(url || ''); return url.charAt(url.length - 1) === '/' ? url : url + '/'; }

function dateLabel_(iso) {
  const p = String(iso).split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)), 'UTC', 'EEE, d MMM yyyy');
}

function hourLabel_(h) { return (h % 12 || 12) + ':00 ' + (h % 24 < 12 ? 'AM' : 'PM'); }

function ranges_(hours) {
  hours = hours.slice().sort(function (a, b) { return a - b; });
  const out = [];
  let start = hours[0], prev = hours[0];
  for (let i = 1; i <= hours.length; i++) {
    if (hours[i] === prev + 1) { prev = hours[i]; continue; }
    out.push(hourLabel_(start) + ' &ndash; ' + hourLabel_(prev + 1));
    start = hours[i]; prev = hours[i];
  }
  return out.join('<br>');
}

// ---------------------------------------------------------------------
// Run this ONCE from the editor (select testEmail > Run) to authorise Gmail and send yourself a sample.
function testEmail() {
  const me = Session.getEffectiveUser().getEmail();
  handle_({
    event: 'confirmed', business: 'G-Serve', court: 'Court 1',
    site_url: 'https://YOUR-USERNAME.github.io/g-serve/', manager_email: me,
    booking: { ref: 'GS-TEST12', name: 'Test Player', email: me, phone: '09171234567', gcash_ref: '1234567890123', amount: 900, paddles: [{ date: '2026-12-05', qty: 2, price: 100 }] },
    slots: [{ date: '2026-12-05', hour: 17, price: 400 }, { date: '2026-12-05', hour: 18, price: 400 }]
  });
  console.log('Test email sent to ' + me + '. Remaining quota today: ' + MailApp.getRemainingDailyQuota());
}
