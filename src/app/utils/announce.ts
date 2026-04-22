export function announce(msg: string) {
  const el = document.getElementById('cinny-announcements');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = msg;
  });
}
