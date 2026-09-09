const PAGE_SIZE = 6;
let currentPage = 0;
let totalCount = 0;

document.addEventListener('DOMContentLoaded', function () {
  loadStatCards();
  loadReports();
  document.getElementById('create-report-btn').addEventListener('click', function () {
    window.location.href = '/record-health-signal';
  });
  document.getElementById('btn-next').addEventListener('click', () => { currentPage++; loadReports(); });
  document.getElementById('btn-prev').addEventListener('click', () => { if (currentPage > 0) currentPage--; loadReports(); });
  document.getElementById('btn-first').addEventListener('click', () => { currentPage = 0; loadReports(); });
  document.getElementById('btn-last').addEventListener('click', () => { currentPage = Math.floor((totalCount - 1) / PAGE_SIZE); loadReports(); });
});

async function loadStatCards() {
  const counts = await Promise.all([
    getCount({}),
    getCount({ status: 'Submitted' }),
    getCount({ status: 'Reviewed' }),
    getCount({ status: 'Linked' }),
  ]);
  totalCount = counts[0];
  const cards = [
    { label: 'Total Reports', value: counts[0], icon: 'file-text' },
    { label: 'Pending Approval', value: counts[1], icon: 'clock' },
    { label: 'Reviewed', value: counts[2], icon: 'check-circle' },
    { label: 'Linked', value: counts[3], icon: 'link' },
  ];
  document.getElementById('stat-cards').innerHTML = cards.map(c => `
    <div class="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
      <div>
        <div class="text-xs text-gray-400">${c.label}</div>
        <div class="text-2xl font-bold text-gray-900">${c.value}</div>
      </div>
      <div class="bg-gray-100 rounded-full p-2"><i data-lucide="${c.icon}" class="w-4 h-4 text-gray-500"></i></div>
    </div>`).join('');
  lucide.createIcons();
}

async function getCount(filtersObj) {
  const filters = Object.entries(filtersObj).map(([k, v]) => [k, '=', v]);
  const res = await fetch(`/api/method/frappe.client.get_count?doctype=Case Report&filters=${encodeURIComponent(JSON.stringify(filters))}`);
  const data = await res.json();
  return data.message || 0;
}

async function loadReports() {
  const fields = JSON.stringify(["name", "reporter_name", "symptom_tags", "location_name", "channel", "status", "report_date"]);
  const url = `/api/resource/Case Report?fields=${encodeURIComponent(fields)}&limit_start=${currentPage * PAGE_SIZE}&limit_page_length=${PAGE_SIZE}&order_by=creation desc`;
  const res = await fetch(url);
  const data = await res.json();
  renderTable(data.data || []);
  updatePaginationLabel();
}

const STATUS_COLORS = {
  Submitted: 'bg-amber-50 text-amber-600',
  Reviewed: 'bg-green-50 text-green-600',
  Linked: 'bg-red-50 text-red-600',
  Investigating: 'bg-blue-50 text-blue-600',
  Closed: 'bg-gray-100 text-gray-500',
};
const CHANNEL_COLORS = {
  Mobile: 'bg-red-50 text-red-600',
  SMS: 'bg-green-50 text-green-600',
  USSD: 'bg-amber-50 text-amber-600',
  WhatsApp: 'bg-gray-100 text-gray-600',
};

function renderTable(rows) {
  const tbody = document.getElementById('reports-table-body');
  tbody.innerHTML = rows.map(r => `
    <tr class="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onclick="window.location.href='/case-detail?id=${r.name}'">
      <td class="px-5 py-3 font-medium text-gray-900">${r.name}</td>
      <td class="px-5 py-3 text-gray-700">${r.reporter_name || ''}</td>
      <td class="px-5 py-3">
        ${(r.symptom_tags || '').split(',').filter(Boolean).slice(0,3).map(s => `<span class="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full mr-1">${s.trim()}</span>`).join('')}
      </td>
      <td class="px-5 py-3 text-gray-700">${r.location_name || ''}</td>
      <td class="px-5 py-3"><span class="text-xs font-medium px-2 py-1 rounded-full ${CHANNEL_COLORS[r.channel] || 'bg-gray-100 text-gray-600'}">${(r.channel || '').toUpperCase()}</span></td>
      <td class="px-5 py-3"><span class="text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[r.status] || 'bg-gray-100'}">${r.status || ''}</span></td>
      <td class="px-5 py-3 text-gray-500">${r.report_date || ''}</td>
    </tr>`).join('');
}

function updatePaginationLabel() {
  const start = currentPage * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, totalCount);
  document.getElementById('pagination-label').textContent = `Showing ${start} to ${end} of ${totalCount}`;
}
document.getElementById('export-btn').addEventListener('click', function () {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/method/frappe.desk.reportview.export_query';
  form.target = '_blank';
  const fields = { doctype: 'Case Report', file_format_type: 'Excel', 
    fields: JSON.stringify(["name","reporter_name","symptom_tags","location_name","channel","status","report_date"]) };
  Object.entries(fields).forEach(([k, v]) => {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = k; input.value = v;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
  form.remove();
});