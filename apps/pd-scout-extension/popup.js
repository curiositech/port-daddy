const MANUAL_PROJECT_VALUE = '__manual__';
const { MISSING_ENDPOINT_MESSAGE, normalizePublishedEndpoint } = PortDaddyScoutEndpoint;

const els = {
  daemonStatus: document.getElementById('daemonStatus'),
  captureTitle: document.getElementById('captureTitle'),
  captureBadge: document.getElementById('captureBadge'),
  captureMeta: document.getElementById('captureMeta'),
  capturePreview: document.getElementById('capturePreview'),
  capturePreviewImage: document.getElementById('capturePreviewImage'),
  captureRegionBox: document.getElementById('captureRegionBox'),
  domCard: document.getElementById('domCard'),
  domCount: document.getElementById('domCount'),
  domSummary: document.getElementById('domSummary'),
  capturePage: document.getElementById('capturePage'),
  selectRegion: document.getElementById('selectRegion'),
  brief: document.getElementById('brief'),
  kind: document.getElementById('kind'),
  assignee: document.getElementById('assignee'),
  agentRow: document.getElementById('agentRow'),
  targetAgent: document.getElementById('targetAgent'),
  projectChoice: document.getElementById('projectChoice'),
  projectHint: document.getElementById('projectHint'),
  projectManualRow: document.getElementById('projectManualRow'),
  projectDir: document.getElementById('projectDir'),
  daemonUrl: document.getElementById('daemonUrl'),
  startAgent: document.getElementById('startAgent'),
  submitIssue: document.getElementById('submitIssue'),
  message: document.getElementById('message'),
};

let currentCapture = null;
let activeTab = null;

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else if (response?.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function tabQuery() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tabs?.[0] || null);
    });
  });
}

function setMessage(text, tone = '') {
  els.message.textContent = text;
  if (tone) els.message.dataset.tone = tone;
  else delete els.message.dataset.tone;
}

function daemonBaseUrl() {
  return normalizePublishedEndpoint(els.daemonUrl.value);
}

function endpointForStorage() {
  if (!els.daemonUrl.value.trim()) return '';
  try {
    return daemonBaseUrl();
  } catch {
    return '';
  }
}

function projectDirValue() {
  return els.projectChoice.value === MANUAL_PROJECT_VALUE
    ? els.projectDir.value.trim()
    : els.projectChoice.value.trim();
}

function compact(value, length = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function captureLabel(capture) {
  if (!capture) {
    els.captureTitle.textContent = 'No capture yet';
    els.captureMeta.textContent = 'Capture the active tab or draw a region.';
    els.captureBadge.hidden = true;
    renderCapturePreview(null);
    renderDomSummary(null);
    return;
  }

  const region = capture.region
    ? `region ${capture.region.width} x ${capture.region.height}`
    : 'visible tab';
  const count = capture.domContext?.elementsInRegion?.length || 0;
  els.captureTitle.textContent = capture.pageTitle || 'Captured page';
  els.captureMeta.textContent = `${region} · ${count} DOM hint${count === 1 ? '' : 's'}`;
  els.captureBadge.hidden = false;
  renderCapturePreview(capture);
  renderDomSummary(capture.domContext);
}

function renderCapturePreview(capture) {
  const dataUrl = capture?.image?.dataUrl;
  if (!dataUrl) {
    els.capturePreview.hidden = true;
    els.capturePreviewImage.removeAttribute('src');
    els.captureRegionBox.hidden = true;
    return;
  }

  els.capturePreview.hidden = false;
  els.capturePreviewImage.src = dataUrl;

  const region = capture.region;
  const viewport = capture.viewport;
  if (!region || !viewport?.width || !viewport?.height) {
    els.captureRegionBox.hidden = true;
    return;
  }

  els.captureRegionBox.hidden = false;
  els.captureRegionBox.style.setProperty('--region-left', `${(region.x / viewport.width) * 100}%`);
  els.captureRegionBox.style.setProperty('--region-top', `${(region.y / viewport.height) * 100}%`);
  els.captureRegionBox.style.setProperty('--region-width', `${(region.width / viewport.width) * 100}%`);
  els.captureRegionBox.style.setProperty('--region-height', `${(region.height / viewport.height) * 100}%`);
}

function renderDomSummary(domContext) {
  const elements = domContext?.elementsInRegion || [];
  els.domCard.hidden = elements.length === 0;
  els.domCount.textContent = `${elements.length} element${elements.length === 1 ? '' : 's'}`;
  els.domSummary.replaceChildren();

  for (const element of elements.slice(0, 6)) {
    const li = document.createElement('li');
    const selector = document.createElement('code');
    selector.textContent = compact(element.selector || element.xpath || element.tagName || 'element', 48);
    li.append(selector);

    const source = element.source?.fileName
      ? ` · ${element.source.fileName}:${element.source.lineNumber || 1}`
      : '';
    const text = element.text ? ` · ${compact(element.text, 42)}` : '';
    li.append(document.createTextNode(`${source}${text}`));
    els.domSummary.append(li);
  }
}

let daemonProbeSeq = 0;
let daemonProbeTimer = null;

function setDaemonStatus(text, tone) {
  els.daemonStatus.textContent = text;
  if (tone) els.daemonStatus.dataset.tone = tone;
  else delete els.daemonStatus.dataset.tone;
}

function daemonScope() {
  try {
    normalizePublishedEndpoint(els.daemonUrl.value);
    return 'Local';
  } catch {
    return null;
  }
}

async function probeDaemon(scope) {
  const seq = ++daemonProbeSeq;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  let online = false;
  try {
    const res = await fetch(`${daemonBaseUrl()}/health`, { signal: controller.signal });
    online = res.ok;
  } catch {
    online = false;
  } finally {
    clearTimeout(timer);
  }
  if (seq !== daemonProbeSeq) return;
  if (online) setDaemonStatus(`${scope} · Online`, scope === 'Local' ? '' : 'remote');
  else setDaemonStatus(`${scope} · Offline`, 'offline');
}

function updateDaemonStatus() {
  const scope = daemonScope();
  if (!scope) {
    daemonProbeSeq += 1;
    if (daemonProbeTimer) clearTimeout(daemonProbeTimer);
    setDaemonStatus(els.daemonUrl.value.trim() ? 'Invalid endpoint' : 'Not connected', 'unknown');
    return;
  }
  setDaemonStatus(`${scope} · ...`, scope === 'Local' ? '' : 'remote');
  if (daemonProbeTimer) clearTimeout(daemonProbeTimer);
  daemonProbeTimer = setTimeout(() => void probeDaemon(scope), 300);
}

function isExtensionPage(tab) {
  return Boolean(tab?.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`));
}

async function loadProjects(preferredRoot = '') {
  els.projectChoice.disabled = true;
  els.projectChoice.replaceChildren(new Option('Loading Port Daddy projects...', ''));
  els.projectHint.textContent = 'Projects come from the local daemon.';

  try {
    const res = await fetch(`${daemonBaseUrl()}/projects`);
    const body = await res.json();
    if (!res.ok || body?.success === false) throw new Error(body?.error || `Port Daddy returned ${res.status}`);

    const projects = Array.isArray(body.projects) ? body.projects : [];
    els.projectChoice.replaceChildren();
    els.projectChoice.append(new Option('No project selected', ''));
    for (const project of projects) {
      if (!project?.root) continue;
      const label = `${project.displayName || project.id || project.root} - ${project.root}`;
      els.projectChoice.append(new Option(label, project.root));
    }
    els.projectChoice.append(new Option('Manual path...', MANUAL_PROJECT_VALUE));
    els.projectChoice.disabled = false;

    if (preferredRoot && projects.some((project) => project.root === preferredRoot)) {
      els.projectChoice.value = preferredRoot;
    } else if (preferredRoot) {
      els.projectChoice.value = MANUAL_PROJECT_VALUE;
      els.projectDir.value = preferredRoot;
    } else if (projects.length === 1) {
      els.projectChoice.value = projects[0].root;
    }
    updateProjectManualVisibility();
    els.projectHint.textContent = projects.length
      ? `${projects.length} Port Daddy project${projects.length === 1 ? '' : 's'} available.`
      : 'No registered projects found; use a manual root if needed.';
  } catch (err) {
    els.projectChoice.replaceChildren(new Option('Manual path required', MANUAL_PROJECT_VALUE));
    els.projectChoice.value = MANUAL_PROJECT_VALUE;
    els.projectChoice.disabled = true;
    updateProjectManualVisibility();
    els.projectHint.textContent = err instanceof Error ? err.message : MISSING_ENDPOINT_MESSAGE;
  }
}

function updateProjectManualVisibility() {
  els.projectManualRow.hidden = els.projectChoice.value !== MANUAL_PROJECT_VALUE;
}

function updateAgentVisibility() {
  els.agentRow.style.display = els.assignee.value === 'local-agent' ? 'flex' : 'none';
}

async function persistForm() {
  await storageSet({
    pdScoutDaemonUrl: endpointForStorage(),
    pdScoutProjectDir: projectDirValue(),
    pdScoutAssignee: els.assignee.value,
    pdScoutTargetAgent: els.targetAgent.value.trim(),
    pdScoutStartAgent: els.startAgent.checked,
  });
}

async function load() {
  activeTab = await tabQuery().catch(() => null);
  const stored = await storageGet([
    'pdScoutDaemonUrl',
    'pdScoutProjectDir',
    'pdScoutAssignee',
    'pdScoutTargetAgent',
    'pdScoutStartAgent',
  ]);
  els.daemonUrl.value = stored.pdScoutDaemonUrl || '';
  updateDaemonStatus();
  els.assignee.value = stored.pdScoutAssignee || 'review-queue';
  els.targetAgent.value = stored.pdScoutTargetAgent || '';
  els.startAgent.checked = stored.pdScoutStartAgent === true;
  updateAgentVisibility();
  await loadProjects(stored.pdScoutProjectDir || '');

  currentCapture = await sendMessage({ type: 'pd-scout-get-last-capture' }).catch(() => null);
  if (currentCapture?.tabId && activeTab?.id && currentCapture.tabId !== activeTab.id && !isExtensionPage(activeTab)) {
    currentCapture = null;
  }
  captureLabel(currentCapture);

  const params = new URLSearchParams(window.location.search);
  if (params.get('capture') === 'region' && currentCapture) {
    setMessage('Region captured. The screenshot, rectangle, and DOM context are attached.', 'success');
  }
}

async function capturePage() {
  setMessage('Capturing the active tab.', 'pending');
  currentCapture = await sendMessage({ type: 'pd-scout-capture-tab' });
  captureLabel(currentCapture);
  setMessage('Captured. Add a brief and open the issue.', 'success');
}

async function selectRegion() {
  await persistForm();
  await sendMessage({ type: 'pd-scout-start-selection' });
  setMessage('Draw a rectangle on the page. Scout reopens when it is captured.', 'pending');
  window.close();
}

function titleFromBrief(brief) {
  const first = brief.trim().split(/\n+/)[0]?.trim() || 'Visual issue';
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

async function submitIssue() {
  const brief = els.brief.value.trim();
  if (!brief && !currentCapture) {
    setMessage('Capture the page or write a brief first.', 'error');
    return;
  }
  await persistForm();
  setMessage('Opening issue in Port Daddy.', 'pending');
  els.submitIssue.disabled = true;

  const assignee = els.assignee.value;
  const targetAgent = assignee === 'local-agent' ? els.targetAgent.value.trim() : '';
  const projectDir = projectDirValue();
  const task = {
    schemaVersion: 1,
    type: 'visual-task',
    source: 'chrome-extension',
    projectDir: projectDir || null,
    targetAgent: targetAgent || null,
    kind: els.kind.value,
    title: titleFromBrief(brief),
    description: brief || titleFromBrief(currentCapture?.pageTitle || ''),
    pageUrl: currentCapture?.pageUrl || activeTab?.url || null,
    captureMode: currentCapture?.region ? 'browser-region' : 'browser-tab',
    image: currentCapture?.image || null,
    region: currentCapture?.region || null,
    domContext: currentCapture?.domContext || null,
    viewport: currentCapture?.viewport || null,
    routing: {
      assignee,
      targetAgent: targetAgent || null,
      openIssue: true,
      startAgent: els.startAgent.checked,
    },
    createdAt: new Date().toISOString(),
  };

  try {
    const result = await sendMessage({
      type: 'pd-scout-submit-visual-task',
      daemonUrl: daemonBaseUrl(),
      task,
    });
    const name = result.issue?.workItemSlug || result.issue?.id || 'visual issue';
    const start = result.agentStart?.error ? ` Spawn request: ${result.agentStart.error}` : '';
    setMessage(`Opened ${name}.${start}`, 'success');
    els.brief.value = '';
  } catch (err) {
    setMessage(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    els.submitIssue.disabled = false;
  }
}

els.capturePage.addEventListener('click', () => void capturePage());
els.selectRegion.addEventListener('click', () => void selectRegion());
els.submitIssue.addEventListener('click', () => void submitIssue());
els.assignee.addEventListener('change', () => {
  updateAgentVisibility();
  void persistForm();
});
els.projectChoice.addEventListener('change', () => {
  updateProjectManualVisibility();
  void persistForm();
});
els.daemonUrl.addEventListener('input', updateDaemonStatus);
els.daemonUrl.addEventListener('change', () => {
  updateDaemonStatus();
  void loadProjects(projectDirValue()).then(() => persistForm());
});
for (const el of [els.projectDir, els.targetAgent, els.startAgent]) {
  el.addEventListener('change', () => void persistForm());
}

void load();
