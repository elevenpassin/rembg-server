const form = document.getElementById('users-form');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('user-list');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Loading…';
  listEl.innerHTML = '';

  try {
    // Same origin via Caddy: /trpc/* is proxied to the app
    const res = await fetch('/trpc/userList');
    const json = await res.json();

    if (!res.ok) {
      statusEl.textContent = 'Error: ' + (json.error?.message || res.statusText);
      return;
    }

    const users = json.result?.data ?? [];
    statusEl.textContent = users.length ? '' : 'No users.';

    for (const u of users) {
      const li = document.createElement('li');
      li.textContent = [u.id, u.name ?? '—', u.email].join(' · ');
      listEl.appendChild(li);
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});