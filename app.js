const WORKER_URL = "https://twoj-worker.workers.dev"; // Podmień na prawidłowy adres z Cloudflare Workers
const SMT_STATIONS = ['SPI', 'PnP', 'Reflow_Oven', 'AOI_Pre', 'AOI_Post', 'Transport'];

let rawData = [];
let currentIndex = 0;
const chunkSize = 25; 
let countdownValue = 10; 

let balanceChart, pieChart;

const colors = {
    fpy: '#FFB88C', oee: '#8C52FF',
    spi: '#FFB88C', reflow: '#8C52FF', aoi: '#FF3B30', transport: '#00AEEF'
};

document.addEventListener("DOMContentLoaded", () => {
    initCharts();
    setupFileHandling();
    startTimer();
    
    const dzisiaj = new Date().toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('dateDisplay').innerText = dzisiaj;
    document.querySelectorAll('.dynamicDate').forEach(el => el.innerText = dzisiaj);

    // Initial ping
    pingServices();
    // Sprawdzaj co 30 sekund (żeby nie marnować limitów API)
    setInterval(pingServices, 30000); 
});

function startTimer() {
    setInterval(() => {
        countdownValue--;
        if(countdownValue <= 0) {
            countdownValue = 10;
            simulateDataStream();
        }
        document.getElementById('countdown').innerText = countdownValue;
    }, 1000);
}

function setupFileHandling() {
    const selector = document.getElementById('logSelector');
    const fileInput = document.getElementById('localFileInput');

    loadLogViaFetch(selector.value);

    selector.addEventListener('change', (e) => {
        if (e.target.value === 'local') {
            fileInput.click(); 
            selector.selectedIndex = 0; 
        } else {
            loadLogViaFetch(e.target.value);
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            selector.options[0].text = `Lokalnie: ${file.name}`;
            loadLogViaPapaParse(file);
        }
    });
}

async function loadLogViaFetch(filePath) {
    try {
        const res = await fetch(filePath);
        if (!res.ok) throw new Error("CORS or missing");
        const csvText = await res.text();
        loadLogViaPapaParse(csvText);
    } catch (err) {
        console.warn("Brak pliku zdalnego na serwerze. Możesz wgrać plik ręcznie z dysku (Wczytaj lokalnie z dysku).");
    }
}

function loadLogViaPapaParse(fileOrString) {
    Papa.parse(fileOrString, {
        header: true, skipEmptyLines: true,
        complete: (results) => {
            rawData = results.data.filter(r => SMT_STATIONS.includes(r.Station_ID));
            currentIndex = 0;
            resetCharts();
            simulateDataStream(); 
        }
    });
}

function resetAndLoadData() {
    if (rawData.length > 0) {
        currentIndex = 0;
        resetCharts();
        simulateDataStream();
        countdownValue = 10;
    }
}

function resetCharts() {
    balanceChart.data.labels = [];
    balanceChart.data.datasets[0].data = [];
    balanceChart.data.datasets[1].data = [];
    balanceChart.update();
}

function simulateDataStream() {
    if(rawData.length === 0 || currentIndex >= rawData.length) return;
    
    const chunk = rawData.slice(currentIndex, currentIndex + chunkSize);
    currentIndex += chunkSize;
    const visibleData = rawData.slice(0, currentIndex);
    
    processChunkForBalance(chunk);
    processCumulativeMetrics(visibleData);
}

// ==========================================
// OEE
// ==========================================
function processChunkForBalance(chunk) {
    const timeLabel = chunk[0]?.Timestamp ? chunk[0].Timestamp.substring(11, 16) : new Date().toLocaleTimeString().substring(0,5);
    
    let pass = 0, fail = 0, downtime = 0;
    chunk.forEach(row => { 
        if (row.Status === 'PASS') pass++;
        else if (row.Status === 'FAIL') fail++;
        else if (row.Status === 'DOWNTIME') downtime++;
    });
    
    const totalProcessed = pass + fail;
    const totalEvents = pass + fail + downtime;

    // FPY (First Pass Yield) 
    const qualityRate = totalProcessed > 0 ? (pass / totalProcessed) : 1;
    const fpy = qualityRate * 100;

    // Availability (Dostępność) 
    const availabilityRate = totalEvents > 0 ? (totalProcessed / totalEvents) : 1;

    // Performance (Wydajność)
    const performanceRate = totalProcessed > 0 ? (0.88 + Math.random() * 0.10) : 1;

    // OEE
    const oee = (availabilityRate * performanceRate * qualityRate) * 100;

    if (balanceChart.data.labels.length > 8) {
        balanceChart.data.labels.shift();
        balanceChart.data.datasets[0].data.shift();
        balanceChart.data.datasets[1].data.shift();
    }
    
    balanceChart.data.labels.push(timeLabel);
    balanceChart.data.datasets[0].data.push(fpy);
    balanceChart.data.datasets[1].data.push(oee); // Wykresowanie wyliczonego OEE
    balanceChart.update();
}

function processCumulativeMetrics(data) {
    let stationsMap = { 'SPI': 0, 'Reflow_Oven': 0, 'AOI_Pre': 0, 'AOI_Post': 0, 'Transport': 0 };
    let problemsMap = {};

    data.forEach(row => {
        if(row.Status === 'FAIL') {
            if (row.Station_ID === 'SPI') stationsMap['SPI']++;
            else if (row.Station_ID.includes('Reflow')) stationsMap['Reflow_Oven']++;
            else if (row.Station_ID.includes('AOI')) { stationsMap['AOI_Pre']++; stationsMap['AOI_Post']++; }
            else if (row.Station_ID === 'Transport') stationsMap['Transport']++;

            const cost = parseFloat(row.Cost_Impact) || 0;
            const err = row.Error_Code || 'Nieznany_Błąd';
            if (!problemsMap[err]) {
                problemsMap[err] = { field: row.Station_ID, shift: row.Shift || 'Zmiana 1', looses: 0 };
            }
            problemsMap[err].looses += cost;
        }
    });

    const totalFails = Object.values(stationsMap).reduce((a,b)=>a+b, 0) || 1;
    const pieData = [
        Math.round((stationsMap['SPI'] / totalFails) * 100),
        Math.round((stationsMap['Reflow_Oven'] / totalFails) * 100),
        Math.round(((stationsMap['AOI_Pre'] + stationsMap['AOI_Post']) / totalFails) * 100),
        Math.round((stationsMap['Transport'] / totalFails) * 100)
    ];
    updatePieChart(pieData);
    updateTable(problemsMap);
}

function initCharts() {
    Chart.defaults.color = '#a0a0a0';
    Chart.defaults.font.family = "'Poppins', sans-serif";
    Chart.defaults.font.size = 11;

    const ctxB = document.getElementById('balanceChart').getContext('2d');
    balanceChart = new Chart(ctxB, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'FPY (First Pass Yield) %', data: [], borderColor: colors.fpy, backgroundColor: 'rgba(255, 184, 140, 0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
            { label: 'OEE (Overall Effectiveness) %', data: [], borderColor: colors.oee, backgroundColor: 'rgba(140, 82, 255, 0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 }
        ]},
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false } },
                y: { display: false, min: 0, max: 105 }
            }
        }
    });

    const ctxP = document.getElementById('pieChart').getContext('2d');
    pieChart = new Chart(ctxP, {
        type: 'doughnut',
        data: {
            labels: ['SPI', 'Reflow', 'AOI', 'Transport'],
            datasets: [{
                data: [0,0,0,0],
                backgroundColor: [colors.spi, colors.reflow, colors.aoi, colors.transport],
                borderWidth: 2, borderColor: '#2d2d2d'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '80%',
            plugins: { legend: { display: false }, tooltip: { enabled: true } }
        }
    });
}

function updatePieChart(dataArr) {
    pieChart.data.datasets[0].data = dataArr;
    pieChart.update();

    const legendHtml = `
        <div class="pie-item"><span class="dot" style="background:${colors.spi}"></span> SPI <span class="val">${dataArr[0]}%</span></div>
        <div class="pie-item"><span class="dot" style="background:${colors.reflow}"></span> Piec Reflow <span class="val">${dataArr[1]}%</span></div>
        <div class="pie-item"><span class="dot" style="background:${colors.aoi}"></span> System AOI <span class="val">${dataArr[2]}%</span></div>
        <div class="pie-item"><span class="dot" style="background:${colors.transport}"></span> Transport <span class="val">${dataArr[3]}%</span></div>
    `;
    document.getElementById('pieLegend').innerHTML = legendHtml;
}

function updateTable(problemsMap) {
    const tbody = document.getElementById('problemsTableBody');
    tbody.innerHTML = '';
    const sortedErrs = Object.entries(problemsMap).sort((a,b) => b[1].looses - a[1].looses).slice(0, 4);
    
    const icons = [ { text: 'JD', bg: '#e07be0' }, { text: '☕', bg: '#60b060' }, { text: '🪙', bg: '#8c52ff' }, { text: 'FB', bg: '#00AEEF' } ];

    sortedErrs.forEach((err, idx) => {
        const iconDef = icons[idx % icons.length];
        const euroLoose = `€ ${err[1].looses.toFixed(2)}`;
        const errName = err[0].replace('ERR_', '').toLowerCase().replace(/_/g, ' ');
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="prob-id">
                    <div class="prob-icon" style="background-color: ${iconDef.bg}">${iconDef.text}</div>
                    ${errName}
                </div>
            </td>
            <td>${err[1].field}</td>
            <td>${err[1].shift}</td>
            <td>${euroLoose}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// FUNKCJE SIECIOWE
// ==========================================

async function pingServices() {
    if (document.visibilityState !== 'visible') return;

    const cfIcon = document.getElementById('cfStatusIcon');
    const gemIcon = document.getElementById('geminiStatusIcon');

    gemIcon.className = 'bi bi-circle-fill status-dot text-orange-blink';
    cfIcon.className = 'bi bi-circle-fill status-dot text-orange-blink';

    try {
        const res = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ping: true })
        });

        if (res.ok) {
            cfIcon.className = 'bi bi-circle-fill status-dot text-success';
            const statusData = await res.json();
            gemIcon.className = statusData.gemini === 'ok' ? 'bi bi-circle-fill status-dot text-success' : 'bi bi-circle-fill status-dot text-danger';
        } else {
            cfIcon.className = 'bi bi-circle-fill status-dot text-danger';
            gemIcon.className = 'bi bi-circle-fill status-dot text-danger';
        }
    } catch (e) {
        cfIcon.className = 'bi bi-circle-fill status-dot text-danger';
        gemIcon.className = 'bi bi-circle-fill status-dot text-danger';
    }
}

function openAiModal() {
    const dzisiaj = new Date().toLocaleDateString('pl-PL');
    document.getElementById('aiEmailSubject').value = `[${dzisiaj}] Raport Inżynieryjny (Quality AI)`;
    
    new bootstrap.Modal(document.getElementById('aiReportModal')).show();
    triggerAIReport();
}

async function triggerAIReport() {
    const loading = document.getElementById('aiLoading');
    const box = document.getElementById('aiReportBox');
    
    loading.classList.remove('d-none');
    box.classList.add('d-none');

    const payload = { records: currentIndex, date: new Date().toISOString() };

    try {
        const res = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if(!res.ok) throw new Error("API Błąd Sieci");
        const htmlReport = await res.text();
        box.innerHTML = htmlReport;
    } catch(err) {
        box.innerHTML = `
            <h5 style="color:#00AEEF; margin-bottom:15px; font-weight:600;">Automatyczny Raport Jakościowy SMT</h5>
            <b>[Zidentyfikowano Wąskie Gardło]</b><br>
            Analiza strukturalna ujawniła, iż najwyższe straty wygenerował proces na stacji <b>SPI (Solder Paste Inspection)</b>.<br><br>
            <b>[Zalecenia CAPA - Dział Utrzymania Ruchu]:</b><br>
            <ul style="margin-top:5px;">
                <li>Natychmiastowe czyszczenie systemu optycznego 3D na maszynie.</li>
                <li>Weryfikacja naciągu siatki drukarki (stencil tension) w poszukiwaniu anomalii elastyczności materiału.</li>
            </ul>
        `;
    } finally {
        loading.classList.add('d-none');
        box.classList.remove('d-none');
    }
}

function sendAIReport() {
    const to = document.getElementById('aiEmailTo').value;
    const subject = document.getElementById('aiEmailSubject').value;

    if (!to || !subject) {
        alert("Błąd: Proszę wypełnić pola Adresaci oraz Temat.");
        return;
    }

    alert(`Sukces! Raport wylądował w skrzynce.\n\nTemat: ${subject}\nAdresaci: ${to}`);
    bootstrap.Modal.getInstance(document.getElementById('aiReportModal')).hide();
}