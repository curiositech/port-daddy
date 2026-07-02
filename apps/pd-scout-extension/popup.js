const DEFAULT_DAEMON_URL = 'http://127.0.0.1:9876';

const els = {
  daemonStatus: document.getElementById('daemonStatus'),
  captureTitle: document.getElementById('captureTitle'),
  captureMeta: document.getElementById('captureMeta'),
  capturePage: document.getElementById('capturePage'),
  selectRegion: document.getElementById('selectRegion'),
  brief: document.getElementById('brief'),
  kind: document.getElementById('kind'),
  assignee: document.getElementById('assignee'),
  agentRow: document.getElementById('agentRow'),
  targetAgent: document.getElementById('targetAgent'),
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

function captureLabel(capture) {
  if (!capture) {
    els.captureTitle.textContent = 'No capture yet';
    els.captureMeta.textContent = 'Capture the active tab or draw a region.';
    return;
  }
  const region = capture.region
    ? `region ${capture.region.width} x ${capture.region.height}`
    : 'visible tab';
  const count = capture.domContext?.elementsInRegion?.length || 0;
  els.captureTitle.textContent = capture.pageTitle || 'Captured page';
  els.captureMeta.textContent = `${region} · ${count} DOM hint${count === 1 ? '' : 's'}`;
}

async function persistForm() {
  await storageSet({
    pdScoutDaemonUrl: els.daemonUrl.value.trim() || DEFAULT_DAEMON_URL,
    pdScoutProjectDir: els.projectDir.value.trim(),
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
  els.daemonUrl.value = stored.pdScoutDaemonUrl || DEFAULT_DAEMON_URL;
  els.projectDir.value = stored.pdScoutProjectDir || '';
  els.assignee.value = stored.pdScoutAssignee || 'local-agent';
  els.targetAgent.value = stored.pdScoutTargetAgent || '';
  els.startAgent.checked = stored.pdScoutStartAgent === true;
  updateAgentVisibility();

  currentCapture = await sendMessage({ type: 'pd-scout-get-last-capture' }).catch(() => null);
  if (currentCapture?.tabId && activeTab?.id && currentCapture.tabId !== activeTab.id) {
    currentCapture = null;
  }
  captureLabel(currentCapture);
}

function updateAgentVisibility() {
  els.agentRow.style.display = els.assignee.value === 'local-agent' ? 'flex' : 'none';
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
  setMessage('Draw a rectangle on the page, then reopen Scout to submit it.', 'pending');
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
  const task = {
    schemaVersion: 1,
    type: 'visual-task',
    source: 'chrome-extension',
    projectDir: els.projectDir.value.trim() || null,
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
      daemonUrl: els.daemonUrl.value.trim() || DEFAULT_DAEMON_URL,
      task,
    });
    const name = result.issue?.workItemSlug || result.issue?.id || 'visual issue';
    const start = result.agentStart?.error ? ` Agent start: ${result.agentStart.error}` : '';
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
for (const el of [els.daemonUrl, els.projectDir, els.targetAgent, els.startAgent]) {
  el.addEventListener('change', () => void persistForm());
}

void load();
