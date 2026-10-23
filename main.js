// Mobile menu
const btn = document.getElementById('menu-btn');
const menu = document.getElementById('menu');
function setMenu(open) {
  menu.classList.toggle('hidden', !open);
  menu.classList.toggle('flex', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
btn.addEventListener('click', () => setMenu(btn.getAttribute('aria-expanded') !== 'true'));
menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));

document.getElementById('year').textContent = new Date().getFullYear();

// Contact form (works with Formspree or any endpoint that accepts JSON)
const form = document.getElementById('contact-form');
const statusEl = document.getElementById('form-status');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = '';
  if (!form.checkValidity()) { statusEl.textContent = 'Please enter your name and a valid email.'; form.reportValidity(); return; }
  if (form.action.includes('YOUR_FORM_ID')) { statusEl.textContent = 'Form is not connected yet. Add your Formspree ID in index.html.'; return; }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true; statusEl.textContent = 'Sending...';
  try {
    const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error();
    form.reset(); statusEl.textContent = 'Thanks! We will reply within 2 days.';
  } catch {
    statusEl.textContent = 'Could not send. Please email us directly or try again.';
  } finally { submit.disabled = false; }
});
