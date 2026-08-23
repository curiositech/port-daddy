// tests/unit/purser/account-chip-href-contract.test.ts

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { AccountChip } from '../../../website-v2/src/components/site/AccountChip';

const RELAY_ORIGIN = 'https://relay.portdaddy.dev';

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root.unmount();
    });
  }
  container.remove();
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(AccountChip));
  });
}

describe('AccountChip href contract', () => {
  it('renders the Repo settings link with the correct href when authenticated', async () => {
    // Mock a successful auth status probe
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ login: 'user', avatarUrl: null }),
    }));
    // @ts-ignore
    global.fetch = fetchMock;

    await mount();

    const repoLink = container.querySelector<HTMLAnchorElement>(
      `a[href="${RELAY_ORIGIN}/account/repos"]`,
    );
    expect(repoLink).not.toBeNull();
    expect(repoLink!.textContent?.trim()).toBe('Repo settings');
  });

  it('renders the login link when the auth probe fails', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('unreachable');
    });
    // @ts-ignore
    global.fetch = fetchMock;

    await mount();

    const loginLink = container.querySelector<HTMLAnchorElement>(
      `a[href="${RELAY_ORIGIN}/login"]`,
    );
    expect(loginLink).not.toBeNull();
  });
});