document.addEventListener('DOMContentLoaded', function () {
  renderSidebarMenu();
  lucide.createIcons();
  setHeaderUser();
  startLiveClock();
  setupSidebarCollapse();
});

function renderSidebarMenu() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav || typeof SIDEBAR_MENU === 'undefined') return;

  const currentPath = window.location.pathname.replace('/', '');
  let html = '';

  SIDEBAR_MENU.forEach(function (group) {
    html += `<div class="sidebar-group-label px-2 text-xs font-semibold text-gray-400 tracking-wide mb-2 mt-5">${group.section}</div>`;
    group.items.forEach(function (item) {
      const isActive = item.page === currentPath;
      const activeClasses = isActive ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-50';
      html += `
        <a href="/${item.page}" class="sidebar-link flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 ${activeClasses}">
          <i data-lucide="${item.icon}" class="w-4 h-4 shrink-0"></i>
          <span class="sidebar-label whitespace-nowrap">${item.label}</span>
        </a>`;
    });
  });

  nav.innerHTML = html;
}

// --- Cookie helper: reads a value Frappe already stores in the browser after login ---
function getCookie(name) {
  const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return match ? decodeURIComponent(match.pop()) : null;
}

function setHeaderUser() {
  const nameEl = document.getElementById('header-username');
  const greetingEl = document.getElementById('header-greeting');
  if (!nameEl) return;

  let fullName = getCookie('full_name') || 'User';
  fullName = fullName.replace(/^"|"$/g, ''); // Frappe sometimes wraps the cookie value in quotes

  nameEl.textContent = fullName;

  if (greetingEl) {
    const firstName = fullName.split(' ')[0];
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
    greetingEl.textContent = `Good ${timeOfDay}, ${firstName}!`;
  }
}

function startLiveClock() {
  const dateEl = document.getElementById('header-date');
  if (!dateEl) return;

  function tick() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    dateEl.textContent = `${dateStr} \u2022 ${timeStr}`;
  }

  tick();
  setInterval(tick, 1000 * 30); // refresh every 30 seconds — plenty for a clock showing minutes, not seconds
}

function setupSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggleBtn) return;

  const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

  function applyCollapsedState(collapsed) {
    if (collapsed) {
      sidebar.classList.remove('w-64');
      sidebar.classList.add('w-20');
      document.querySelectorAll('.sidebar-label, .sidebar-group-label, #sidebar-brand-text').forEach(el => el.classList.add('hidden'));
    } else {
      sidebar.classList.remove('w-20');
      sidebar.classList.add('w-64');
      document.querySelectorAll('.sidebar-label, .sidebar-group-label, #sidebar-brand-text').forEach(el => el.classList.remove('hidden'));
    }
    // Rebuild the icon fresh each time instead of searching for the old <i> — fixes the bug above
    toggleBtn.innerHTML = `<i data-lucide="${collapsed ? 'chevron-right' : 'chevron-left'}" class="w-4 h-4"></i>`;
    lucide.createIcons();
  }

  applyCollapsedState(isCollapsed);

  toggleBtn.addEventListener('click', function () {
    const nowCollapsed = !sidebar.classList.contains('w-20');
    localStorage.setItem('sidebarCollapsed', nowCollapsed);
    applyCollapsedState(nowCollapsed);
  });
}