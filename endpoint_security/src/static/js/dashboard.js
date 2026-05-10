document.addEventListener("DOMContentLoaded", () => {
  const WINDOW_SIZE = 90;
  const STEP_SIZE = 6;
  const REFRESH_MS = 5000;

  let cursor = WINDOW_SIZE;
  let lastPayload = null;
  let previousChart = null;
  let animationFrame = null;
  let attackDrillActive = false;
  let refreshTimer = null;

  const chartContainer = document.getElementById("anomalyChart");
  const canvas = document.getElementById("chartCanvas");
  const ctx = canvas.getContext("2d");
  const attackButton = document.getElementById("attackButton");
  const exportButton = document.getElementById("exportButton");
  const themeToggle = document.getElementById("themeToggle");

  const els = {
    themeToggleText: document.getElementById("themeToggleText"),
    eliminationOverlay: document.getElementById("eliminationOverlay"),
    refreshInterval: document.getElementById("refreshInterval"),
    threatBanner: document.getElementById("threatBanner"),
    threatLevel: document.getElementById("threatLevel"),
    threatSummary: document.getElementById("threatSummary"),
    threatScore: document.getElementById("threatScore"),
    totalSamples: document.getElementById("totalSamples"),
    anomalies: document.getElementById("anomalies"),
    fleetHealth: document.getElementById("fleetHealth"),
    threshold: document.getElementById("threshold"),
    windowAnomalies: document.getElementById("windowAnomalies"),
    cursorLabel: document.getElementById("cursorLabel"),
    windowLabel: document.getElementById("windowLabel"),
    endpointTable: document.getElementById("endpointTable"),
    incidentQueue: document.getElementById("incidentQueue"),
    attackStatus: document.getElementById("attackStatus"),
    modelType: document.getElementById("modelType"),
    modelMode: document.getElementById("modelMode"),
    featureCount: document.getElementById("featureCount"),
    trainingRecords: document.getElementById("trainingRecords"),
    telemetryTags: document.getElementById("telemetryTags"),
    activityFeed: document.getElementById("activityFeed"),
  };

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-IN");
  }

  function formatScore(value) {
    return Number(value || 0).toFixed(5);
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  function chip(severity, text) {
    return `<span class="chip chip-${severity}">${text}</span>`;
  }

  function applyTheme(theme) {
    const isLight = theme === "light";
    document.body.classList.toggle("theme-light", isLight);
    themeToggle.setAttribute("aria-pressed", String(isLight));
    themeToggle.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
    els.themeToggleText.textContent = isLight ? "Light" : "Dark";
    localStorage.setItem("soc-theme", theme);
    if (lastPayload) {
      drawChart(lastPayload.chart, 1);
    }
  }

  function toggleTheme() {
    applyTheme(document.body.classList.contains("theme-light") ? "dark" : "light");
  }

  async function fetchDashboard() {
    const url = `/api/dashboard?cursor=${cursor}&window=${WINDOW_SIZE}&step=${STEP_SIZE}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Dashboard API failed: ${response.status}`);
    }
    return response.json();
  }

  async function refreshDashboard() {
    if (attackDrillActive) return;

    try {
      const payload = await fetchDashboard();
      cursor = payload.next_cursor;
      updateDashboard(payload);
      previousChart = payload.chart;
      lastPayload = payload;
    } catch (error) {
      console.error(error);
      setAttackStatus("error", "Connection issue", "Dashboard API is not responding.");
    }
  }

  function updateDashboard(payload) {
    updateThreat(payload.threat, payload.kpis.threat_score);
    updateKpis(payload.kpis);
    drawAnimatedChart(payload.chart, previousChart);
    updateEndpoints(payload.endpoints);
    updateIncidents(payload.incidents);
    updateModel(payload.model);
    updateActivity(payload.activity);
  }

  function updateThreat(threat, score) {
    els.threatBanner.className = `threat-banner severity-${threat.severity}`;
    els.threatLevel.textContent = threat.level;
    els.threatSummary.textContent = threat.summary;
    els.threatScore.textContent = Math.round(score);
    els.threatBanner.style.setProperty("--score", `${Math.round(score)}%`);
  }

  function updateKpis(kpis) {
    els.refreshInterval.textContent = "5s";
    els.totalSamples.textContent = formatNumber(kpis.total_samples);
    els.anomalies.textContent = formatNumber(kpis.anomalies);
    els.fleetHealth.textContent = `${Math.round(kpis.fleet_health)}%`;
    els.threshold.textContent = Number(kpis.threshold || 0).toFixed(4);
    els.windowAnomalies.textContent = `${formatNumber(kpis.window_anomalies)} in active window`;
    els.cursorLabel.textContent = formatNumber(lastPayload ? lastPayload.cursor : cursor);
    els.windowLabel.textContent = `${WINDOW_SIZE} samples`;
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, chartContainer.clientWidth);
    const height = Math.max(280, chartContainer.clientHeight);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  function drawAnimatedChart(nextChart, prevChart) {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }

    const start = performance.now();
    const duration = 850;
    const from = prevChart && prevChart.errors.length === nextChart.errors.length
      ? prevChart.errors
      : nextChart.errors;

    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const interpolated = nextChart.errors.map((value, index) => {
        const startValue = from[index] ?? value;
        return startValue + (value - startValue) * eased;
      });

      drawChart({
        labels: nextChart.labels,
        errors: interpolated,
        threshold: nextChart.threshold,
      }, eased);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(frame);
      }
    }

    animationFrame = requestAnimationFrame(frame);
  }

  function drawChart(chart, progress) {
    const { width, height } = resizeCanvas();
    const errors = chart.errors || [];
    if (!errors.length) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    const padding = { top: 24, right: 24, bottom: 34, left: 54 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxVal = Math.max(...errors, chart.threshold * 1.4, 0.01);
    const xStep = plotWidth / Math.max(errors.length - 1, 1);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = cssVar("--chart-bg");
    ctx.fillRect(0, 0, width, height);

    const gridGradient = ctx.createLinearGradient(0, 0, width, 0);
    gridGradient.addColorStop(0, cssVar("--chart-grid-from"));
    gridGradient.addColorStop(1, cssVar("--chart-grid-to"));
    ctx.fillStyle = gridGradient;
    ctx.fillRect(padding.left, padding.top, plotWidth, plotHeight);

    ctx.strokeStyle = cssVar("--chart-grid-line");
    ctx.lineWidth = 1;
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.fillStyle = cssVar("--chart-label");
    for (let i = 0; i <= 5; i += 1) {
      const y = padding.top + (plotHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      const label = (maxVal - (maxVal / 5) * i).toFixed(3);
      ctx.fillText(label, 8, y + 4);
    }

    const thresholdY = padding.top + plotHeight - (chart.threshold / maxVal) * plotHeight;
    ctx.strokeStyle = cssVar("--red");
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(padding.left, thresholdY);
    ctx.lineTo(width - padding.right, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]);

    const drift = (1 - progress) * xStep * STEP_SIZE;
    const points = errors.map((value, index) => ({
      x: padding.left + index * xStep - drift,
      y: padding.top + plotHeight - (value / maxVal) * plotHeight,
      value,
    }));

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, plotWidth, plotHeight);
    ctx.clip();

    const areaGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    areaGradient.addColorStop(0, cssVar("--chart-area-top"));
    areaGradient.addColorStop(1, cssVar("--chart-area-bottom"));

    ctx.beginPath();
    points.forEach((point, index) => {
      index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y);
    });
    ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
    ctx.lineTo(points[0].x, height - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = areaGradient;
    ctx.fill();

    const lineGradient = ctx.createLinearGradient(padding.left, 0, width - padding.right, 0);
    lineGradient.addColorStop(0, cssVar("--teal"));
    lineGradient.addColorStop(0.55, cssVar("--cyan"));
    lineGradient.addColorStop(1, cssVar("--violet"));

    ctx.beginPath();
    points.forEach((point, index) => {
      index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = lineGradient;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = cssVar("--chart-shadow");
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    points.forEach((point) => {
      if (point.value > chart.threshold) {
        const severityColor = point.value > chart.threshold * 3 ? cssVar("--red") : cssVar("--yellow");
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.value > chart.threshold * 3 ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = severityColor;
        ctx.fill();
      }
    });
    ctx.restore();

    ctx.fillStyle = cssVar("--chart-label");
    ctx.fillText(`sample ${chart.labels[0] ?? "--"}`, padding.left, height - 10);
    ctx.textAlign = "right";
    ctx.fillText(`sample ${chart.labels[chart.labels.length - 1] ?? "--"}`, width - padding.right, height - 10);
    ctx.textAlign = "left";
  }

  function updateEndpoints(endpoints) {
    if (!endpoints.length) {
      els.endpointTable.innerHTML = `<tr><td colspan="5" class="empty-state">No endpoint activity in this replay window.</td></tr>`;
      return;
    }

    els.endpointTable.innerHTML = endpoints.map((endpoint) => `
      <tr>
        <td><strong>${endpoint.endpoint}</strong><small>${endpoint.last_seen}</small></td>
        <td>
          <div class="risk-bar"><span style="width:${endpoint.risk}%"></span></div>
          <small>${endpoint.risk}% risk</small>
        </td>
        <td>${chip(endpoint.severity, endpoint.severity)}</td>
        <td>${endpoint.status}</td>
        <td>${endpoint.action}</td>
      </tr>
    `).join("");
  }

  function updateIncidents(incidents) {
    if (!incidents.length) {
      els.incidentQueue.innerHTML = `<p class="empty-state">No active incidents in this replay window.</p>`;
      return;
    }

    els.incidentQueue.innerHTML = incidents.map((incident) => `
      <article class="incident-card incident-${incident.severity}">
        <div>
          <span class="incident-id">${incident.id}</span>
          <strong>${incident.title}</strong>
          <small>${incident.endpoint} | ${incident.time} | score ${formatScore(incident.score)}</small>
        </div>
        ${chip(incident.severity, incident.action)}
      </article>
    `).join("");
  }

  function updateModel(model) {
    els.modelType.textContent = model.type;
    els.modelMode.textContent = model.mode;
    els.featureCount.textContent = formatNumber(model.features);
    els.trainingRecords.textContent = formatNumber(model.training_records);
    els.telemetryTags.innerHTML = (model.telemetry || []).map((tag) => `<span>${tag}</span>`).join("");
  }

  function updateActivity(activity) {
    els.activityFeed.innerHTML = activity.map((item) => `
      <div class="activity-item">
        <time>${item.time}</time>
        <span>${item.text}</span>
      </div>
    `).join("");
  }

  function setAttackStatus(state, title, text) {
    els.attackStatus.className = `attack-status ${state}`;
    els.attackStatus.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
  }

  function clonePayload(payload) {
    return JSON.parse(JSON.stringify(payload));
  }

  function buildAttackPayload(payload) {
    const simulated = clonePayload(payload);
    const errors = simulated.chart.errors;
    const threshold = Math.max(Number(simulated.chart.threshold || 0.003), 0.003);
    const burstSize = Math.min(26, errors.length);
    const start = errors.length - burstSize;

    for (let index = start; index < errors.length; index += 1) {
      const wave = 1 + Math.sin((index - start) / 2) * 0.16;
      errors[index] = threshold * (9 + ((index - start) % 5) * 2) * wave;
    }

    simulated.kpis.window_anomalies = (simulated.kpis.window_anomalies || 0) + burstSize;
    simulated.kpis.anomalies = (simulated.kpis.anomalies || 0) + burstSize;
    simulated.kpis.threat_score = 96;
    simulated.kpis.fleet_health = 4;
    simulated.threat = {
      level: "Critical",
      severity: "critical",
      summary: "Simulated endpoint compromise is active right now",
    };
    simulated.incidents = [
      {
        id: "DRILL-NOW",
        time: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        endpoint: "WS-ENDPOINT-ATTACK",
        severity: "critical",
        score: Math.max(...errors.slice(start)),
        title: "Live simulated anomaly burst detected",
        action: "Contain now",
      },
      ...(simulated.incidents || []),
    ].slice(0, 8);
    simulated.activity = [
      {
        time: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        text: "Attack drill injected into live dashboard view",
      },
      ...(simulated.activity || []),
    ].slice(0, 5);

    return simulated;
  }

  function showEliminationOverlay() {
    els.eliminationOverlay.classList.add("is-visible");
    els.eliminationOverlay.setAttribute("aria-hidden", "false");
  }

  function hideEliminationOverlay() {
    els.eliminationOverlay.classList.remove("is-visible");
    els.eliminationOverlay.setAttribute("aria-hidden", "true");
  }

  async function simulateAttack() {
    if (attackDrillActive) return;

    try {
      attackDrillActive = true;
      attackButton.disabled = true;
      setAttackStatus("running", "Attack detected", "Critical anomaly burst is visible in the graph and readings.");
      const basePayload = lastPayload || await fetchDashboard();
      const attackPayload = buildAttackPayload(basePayload);
      updateDashboard(attackPayload);
      previousChart = attackPayload.chart;
      lastPayload = attackPayload;
      await sleep(10000);
      setAttackStatus("success", "Containment complete", "Returning live replay to normal baseline.");
      showEliminationOverlay();
      await sleep(2000);
      hideEliminationOverlay();
      attackDrillActive = false;
      await refreshDashboard();
      setAttackStatus("ready", "Ready", "Inject high-risk endpoint samples for demo validation.");
    } catch (error) {
      console.error(error);
      setAttackStatus("error", "Simulation failed", "Check Flask logs and anomaly_results.csv.");
      attackDrillActive = false;
    } finally {
      attackButton.disabled = false;
    }
  }

  function exportSummary() {
    if (!lastPayload) return;

    const rows = [
      ["Metric", "Value"],
      ["Threat Level", lastPayload.threat.level],
      ["Threat Score", lastPayload.kpis.threat_score],
      ["Total Samples", lastPayload.kpis.total_samples],
      ["Anomalies", lastPayload.kpis.anomalies],
      ["Threshold", lastPayload.kpis.threshold],
      ["Fleet Health", `${lastPayload.kpis.fleet_health}%`],
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "soc_dashboard_summary.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  attackButton.addEventListener("click", simulateAttack);
  exportButton.addEventListener("click", exportSummary);
  themeToggle.addEventListener("click", toggleTheme);
  window.addEventListener("resize", () => {
    if (lastPayload) drawChart(lastPayload.chart, 1);
  });

  applyTheme(localStorage.getItem("soc-theme") || "dark");
  refreshDashboard();
  refreshTimer = setInterval(refreshDashboard, REFRESH_MS);
});
