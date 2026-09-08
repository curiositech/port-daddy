importScripts('daemon-endpoint.js');

const LAST_CAPTURE_KEY = 'pdScoutLastCapture';
const { normalizePublishedEndpoint } = PortDaddyScoutEndpoint;

function chromePromise(fn) {
  return new Promise((resolve, reject) => {
    fn((result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

async function activeTab() {
  const tabs = await chromePromise((done) => chrome.tabs.query({ active: true, currentWindow: true }, done));
  const tab = tabs && tabs[0];
  if (!tab?.id) throw new Error('No active tab available.');
  return tab;
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/Cannot access|extensions gallery|chrome:\/\//i.test(message)) throw err;
    throw new Error('This page does not allow extension capture.');
  }
}

async function messageTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await injectContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function captureVisibleTab(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return {
    name: 'port-daddy-scout.png',
    mimeType: 'image/png',
    dataUrl,
  };
}

async function collectContext(tab) {
  try {
    await injectContentScript(tab.id);
    return await messageTab(tab.id, { type: 'pd-scout-collect-context' });
  } catch {
    return null;
  }
}

async function storeCapture(capture) {
  await chrome.storage.local.set({ [LAST_CAPTURE_KEY]: capture });
  return capture;
}

async function reopenComposer() {
  const url = chrome.runtime.getURL('popup.html?capture=region');
  try {
    await chrome.windows.create({
      url,
      type: 'popup',
      width: 460,
      height: 760,
      focused: true,
    });
    return { reopened: 'composer-window' };
  } catch {
    // Fall back to the action popup if Chrome refuses to create an extension
    // window in this context.
  }

  if (chrome.action?.openPopup) {
    try {
      await chrome.action.openPopup();
      return { reopened: 'action-popup' };
    } catch {
      // Chrome only allows action.openPopup in some user-activation paths.
    }
  }

  return { reopened: 'manual' };
}

async function captureTabIssue() {
  const tab = await activeTab();
  const [image, context] = await Promise.all([
    captureVisibleTab(tab),
    collectContext(tab),
  ]);
  return storeCapture({
    tabId: tab.id,
    pageUrl: tab.url || null,
    pageTitle: tab.title || null,
    image,
    region: null,
    domContext: context,
    viewport: context?.viewport || null,
    capturedAt: new Date().toISOString(),
  });
}

async function startRegionSelection() {
  const tab = await activeTab();
  await injectContentScript(tab.id);
  await messageTab(tab.id, { type: 'pd-scout-start-selection' });
  return { started: true, tabId: tab.id };
}

async function completeRegionSelection(selection, sender) {
  const tab = sender.tab;
  if (!tab?.id) return { success: false, error: 'No sender tab.' };
  const image = await captureVisibleTab(tab);
  await storeCapture({
    tabId: tab.id,
    pageUrl: tab.url || selection?.domContext?.url || null,
    pageTitle: tab.title || selection?.domContext?.title || null,
    image,
    region: selection?.region || null,
    domContext: selection?.domContext || null,
    viewport: selection?.viewport || null,
    capturedAt: new Date().toISOString(),
  });
  const reopen = await reopenComposer().catch((err) => ({
    reopened: 'manual',
    error: err instanceof Error ? err.message : String(err),
  }));
  return { success: true, ...reopen };
}

async function getLastCapture() {
  const stored = await chrome.storage.local.get(LAST_CAPTURE_KEY);
  return stored[LAST_CAPTURE_KEY] || null;
}

async function uploadImageIfNeeded(daemonUrl, task) {
  const image = task?.image;
  if (!image?.dataUrl) return task;

  const imageRes = await fetch(image.dataUrl);
  if (!imageRes.ok) throw new Error('Could not read captured screenshot.');
  const blob = await imageRes.blob();
  const contentType = image.mimeType || blob.type || 'application/octet-stream';

  const uploadRes = await fetch(`${daemonUrl}/blob`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  const payload = await uploadRes.json().catch(() => null);
  if (!uploadRes.ok) {
    throw new Error(payload?.error || `Screenshot upload returned ${uploadRes.status}`);
  }

  const { dataUrl: _dataUrl, ...rest } = image;
  return {
    ...task,
    image: {
      ...rest,
      mimeType: rest.mimeType || contentType,
      size: rest.size || blob.size || payload?.blob?.size || null,
      blobId: payload?.blob?.id || rest.blobId || null,
      blobUrl: payload?.blob?.id ? `/blob/${payload.blob.id}` : rest.blobUrl || null,
    },
  };
}

async function submitVisualTask(input) {
  const daemonUrl = normalizePublishedEndpoint(input.daemonUrl);
  const task = await uploadImageIfNeeded(daemonUrl, input.task);
  const res = await fetch(`${daemonUrl}/visual-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error || `Port Daddy returned ${res.status}`);
  }
  return payload;
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-region') {
    void startRegionSelection();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case 'pd-scout-capture-tab':
        return captureTabIssue();
      case 'pd-scout-start-selection':
        return startRegionSelection();
      case 'pd-scout-selection-complete':
        return completeRegionSelection(message.selection, sender);
      case 'pd-scout-get-last-capture':
        return getLastCapture();
      case 'pd-scout-submit-visual-task':
        return submitVisualTask(message);
      default:
        return { error: 'Unknown Port Daddy Scout message.' };
    }
  };

  run().then(sendResponse).catch((err) => {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  });
  return true;
});
