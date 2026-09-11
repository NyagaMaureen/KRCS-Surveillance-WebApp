let currentStep = 1;
const formState = {
  reporter_name: '', phone_number: '', signal_type: '', region: '', location_name: '',
  latitude: null, longitude: null, affected_count: '', symptoms: [], severity: '',
  additional_notes: '',
};
let REGIONS = [];
let SYMPTOMS = [];

document.addEventListener('DOMContentLoaded', async function () {
  REGIONS = await fetchList('Region', ['name', 'region_name']);
  SYMPTOMS = await fetchList('Symptom', ['name', 'symptom_name', 'category']);
  renderStepper();
  renderStep1();
});

async function fetchList(doctype, fields) {
  const res = await fetch(`/api/resource/${doctype}?fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=200`);
  const data = await res.json();
  return data.data || [];
}

function renderStepper() {
  const steps = ['Reporter Info', 'Symptoms', 'Details', 'Review Report'];
  document.getElementById('stepper').innerHTML = steps.map((label, i) => {
    const num = i + 1;
    const active = num <= currentStep;
    return `
      <div class="flex items-center ${i < steps.length - 1 ? 'flex-1' : ''}">
        <div class="flex flex-col items-center">
          <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${active ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-500'}">${num}</div>
          <div class="text-xs mt-1 ${active ? 'text-red-600 font-medium' : 'text-gray-400'}">${label}</div>
        </div>
        ${i < steps.length - 1 ? `<div class="flex-1 h-0.5 mx-2 ${num < currentStep ? 'bg-red-600' : 'bg-gray-200'}"></div>` : ''}
      </div>`;
  }).join('');
}

function goToStep(n) {
  const currentDiv = document.getElementById(`step-${currentStep}`);
  currentDiv.classList.add('hidden');
  currentDiv.innerHTML = ''; // clear old content so IDs don't collide with the next step
  currentStep = n;
  document.getElementById(`step-${currentStep}`).classList.remove('hidden');
  renderStepper();
  ({ 1: renderStep1, 2: renderStep2, 3: renderStep3, 4: renderStep4 })[n]();
}

// --- STEP 1 ---
function renderStep1() {
  const regionOptions = REGIONS.map(r => `<option value="${r.name}" ${formState.region === r.name ? 'selected' : ''}>${r.region_name}</option>`).join('');
  document.getElementById('step-1').innerHTML = `
    <label class="block text-sm font-semibold mb-1">Reporter Name</label>
    <input id="f-reporter_name" value="${formState.reporter_name}" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm" placeholder="Full name">
    <label class="block text-sm font-semibold mb-1">Phone Number</label>
    <input id="f-phone_number" value="${formState.phone_number}" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm" placeholder="07...">
    <label class="block text-sm font-semibold mb-1">Signal Type</label>
    <select id="f-signal_type" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
      <option value="">Select signal type</option>
      <option ${formState.signal_type==='Suspected Outbreak'?'selected':''}>Suspected Outbreak</option>
      <option ${formState.signal_type==='Unusual Symptom Cluster'?'selected':''}>Unusual Symptom Cluster</option>
      <option ${formState.signal_type==='Environmental Hazard'?'selected':''}>Environmental Hazard</option>
      <option ${formState.signal_type==='Other'?'selected':''}>Other</option>
    </select>
    <label class="block text-sm font-semibold mb-1">Region</label>
    <select id="f-region" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
      <option value="">Select region</option>${regionOptions}
    </select>
    <label class="block text-sm font-semibold mb-1">Location</label>
    <div class="flex gap-2 mb-1">
      <input id="f-location_name" value="${formState.location_name}" class="flex-1 bg-gray-50 rounded-lg px-4 py-3 text-sm" placeholder="Location name">
      <button id="gps-btn" type="button" class="border border-gray-200 rounded-lg px-4 text-gray-500 hover:bg-gray-50"><i data-lucide="map-pin" class="w-4 h-4"></i></button>
    </div>
    <p id="gps-display" class="text-xs text-gray-400 mb-6">${formState.latitude ? `GPS: ${formatCoords(formState.latitude, formState.longitude)}` : 'GPS not captured yet'}</p>
    <div class="flex justify-end">
      <button id="continue-btn" class="bg-red-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Continue</button>
    </div>`;
  lucide.createIcons();
  document.getElementById('gps-btn').addEventListener('click', captureGPS);
  document.getElementById('continue-btn').addEventListener('click', function () {
    formState.reporter_name = document.getElementById('f-reporter_name').value;
    formState.phone_number = document.getElementById('f-phone_number').value;
    formState.signal_type = document.getElementById('f-signal_type').value;
    formState.region = document.getElementById('f-region').value;
    formState.location_name = document.getElementById('f-location_name').value;
    goToStep(2);
  });
}

// --- STEP 2 ---
function renderStep2() {
  const categories = [...new Set(SYMPTOMS.map(s => s.category))];
  const categoryBlocks = categories.map(cat => `
    <p class="text-xs text-gray-400 mt-4 mb-2">${cat}</p>
    <div class="grid grid-cols-2 gap-2">
      ${SYMPTOMS.filter(s => s.category === cat).map(s => `
        <label class="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <input type="checkbox" class="symptom-checkbox" value="${s.name}" ${formState.symptoms.includes(s.name) ? 'checked' : ''}>
          ${s.symptom_name}
        </label>`).join('')}
    </div>`).join('');

  document.getElementById('step-2').innerHTML = `
    <label class="block text-sm font-semibold mb-1">Number of Affected Persons</label>
    <input id="f-affected_count" type="number" value="${formState.affected_count}" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-2 text-sm" placeholder="Estimated count">
    <p class="text-sm font-semibold mt-4">Select All Observed Symptoms</p>
    ${categoryBlocks}
    <label class="block text-sm font-semibold mb-1 mt-6">Severity Assessment</label>
    <select id="f-severity" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-6 text-sm">
      <option value="">Select severity...</option>
      ${['Mild','Moderate','Severe','Critical'].map(s => `<option ${formState.severity===s?'selected':''}>${s}</option>`).join('')}
    </select>
    <div class="flex justify-between">
      <button id="back-btn" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold">Back</button>
      <button id="continue-btn" class="bg-red-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Continue</button>
    </div>`;
  document.getElementById('back-btn').addEventListener('click', () => goToStep(1));
  document.getElementById('continue-btn').addEventListener('click', function () {
    formState.affected_count = document.getElementById('f-affected_count').value;
    formState.severity = document.getElementById('f-severity').value;
    formState.symptoms = Array.from(document.querySelectorAll('.symptom-checkbox:checked')).map(el => el.value);
    goToStep(3);
  });
}

// --- STEP 3 ---
function renderStep3() {
  document.getElementById('step-3').innerHTML = `
    <label class="block text-sm font-semibold mb-1">Additional Notes</label>
    <textarea id="f-notes" rows="4" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-6 text-sm" placeholder="Describe the situation...">${formState.additional_notes}</textarea>
    <label class="block text-sm font-semibold mb-1">Voice Note</label>
    <div class="border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-400 mb-1">Record Voice Note</div>
    <p class="text-xs text-gray-400 mb-6">Speech-to-Text powered by Whisper AI — coming later</p>
    <div class="flex justify-between">
      <button id="back-btn" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold">Back</button>
      <button id="continue-btn" class="bg-red-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Continue</button>
    </div>`;
  document.getElementById('back-btn').addEventListener('click', () => goToStep(2));
  document.getElementById('continue-btn').addEventListener('click', function () {
    formState.additional_notes = document.getElementById('f-notes').value;
    goToStep(4);
  });
}

// --- STEP 4 ---
function renderStep4() {
  const regionLabel = (REGIONS.find(r => r.name === formState.region) || {}).region_name || '';
  const symptomLabels = formState.symptoms.map(id => (SYMPTOMS.find(s => s.name === id) || {}).symptom_name).filter(Boolean);
  document.getElementById('step-4').innerHTML = `
    <h3 class="font-bold text-center mb-6">Review your report</h3>
    <div class="space-y-3 text-sm mb-6">
      <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Reporter</span><span class="font-medium">${formState.reporter_name}</span></div>
      <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Region</span><span class="font-medium">${regionLabel}</span></div>
      <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Location</span><span class="font-medium">${formState.location_name}</span></div>
      <div class="border-b border-gray-100 pb-2"><span class="text-gray-400 block mb-1">Symptoms</span>${symptomLabels.map(s => `<span class="inline-block bg-gray-100 text-xs px-2 py-1 rounded-full mr-1">${s}</span>`).join('')}</div>
      <div><span class="text-gray-400 block mb-1">Notes</span><span>${formState.additional_notes || '—'}</span></div>
    </div>
    <p id="submit-error" class="text-red-600 text-sm mb-4 hidden"></p>
    <div class="flex justify-between">
      <button id="back-btn" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold">Back</button>
      <button id="submit-btn" class="bg-red-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Submit Report</button>
    </div>`;
  document.getElementById('back-btn').addEventListener('click', () => goToStep(3));
  document.getElementById('submit-btn').addEventListener('click', submitReport);
}

// --- GPS capture ---
function captureGPS() {
  const display = document.getElementById('gps-display');
  if (!navigator.geolocation) {
    display.textContent = 'GPS not supported on this device/browser.';
    return;
  }
  display.textContent = 'Capturing location...';
  navigator.geolocation.getCurrentPosition(
    function (position) {
      formState.latitude = position.coords.latitude;
      formState.longitude = position.coords.longitude;
      display.textContent = `GPS: ${formatCoords(formState.latitude, formState.longitude)} (accuracy \u00b1${Math.round(position.coords.accuracy)}m)`;
    },
    function (err) {
      display.textContent = 'Could not get location — check browser permission, or enter location name manually.';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function formatCoords(lat, lng) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}\u00b0${latDir}, ${Math.abs(lng).toFixed(4)}\u00b0${lngDir}`;
}


async function submitReport() {
  const errorEl = document.getElementById('submit-error');
  errorEl.classList.add('hidden');
  try {
    const res = await fetch('/api/method/frappe.client.insert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.FRAPPE_CSRF_TOKEN || '' },
      body: JSON.stringify({
        doc: {
          doctype: 'Case Report',
          reporter_name: formState.reporter_name,
          phone_number: formState.phone_number,
          signal_type: formState.signal_type,
          region: formState.region,
          location_name: formState.location_name,
          latitude: formState.latitude,
          longitude: formState.longitude,
          affected_count: formState.affected_count,
          symptoms: formState.symptoms.map(s => ({ symptom: s })),
          severity: formState.severity,
          additional_notes: formState.additional_notes,
          channel: 'Mobile',
          status: 'Submitted',
        },
      }),
    });
    if (res.ok) {
      window.location.href = '/reports';
    } else {
      const data = await res.json();
      errorEl.textContent = data.exception || 'Something went wrong submitting the report.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = 'Network error — please try again.';
    errorEl.classList.remove('hidden');
  }
}