// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { AccountChip } from './components/site/AccountChip';

/**
 * Runtime companion to account-chip-contract.test.ts (review-round demand):
 * the source pins prove what the file SAYS; these prove what the component
 * DOES — the computed hrefs in the rendered DOM, for both auth states, with
 * the relay probe mocked at the fetch boundary exactly where the component
 * calls it.
 */

const RELAY = 'https://relay.portdaddy.dev';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(AccountChip));
  });
}

describe('AccountChip runtime hrefs', () => {
  test('signed-in menu renders the computed /account/repos href in order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ login: 'erichowens', avatarUrl: null }),
      })),
    );
    await mount();

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-account-chip="signed-in"]',
    );
    expect(trigger, 'probe resolves signed-in → chip renders').not.toBeNull();

    // Radix Popover.Trigger toggles on pointerdown+click; the content portals
    // into document.body, so query the whole document after opening.
    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      trigger!.click();
    });

    const repoLink = document.querySelector<HTMLAnchorElement>(
      `a[href="${RELAY}/account/repos"]`,
    );
    expect(repoLink, 'computed href must appear in the rendered menu').not.toBeNull();
    expect(repoLink!.textContent?.trim()).toBe('Repo settings');

    const labels = [...document.querySelectorAll<HTMLAnchorElement>('a')]
      .filter((a) => a.href.startsWith(`${RELAY}/account`))
      .map((a) => a.textContent?.trim());
    expect(labels).toEqual(['Your runs', 'Account', 'Repo settings', 'Mercy report']);
  });

  test('a failed probe renders the static computed /login href and nothing else', async () => {
    const failing = vi.fn(async () => {
      throw new Error('relay unreachable');
    });
    vi.stubGlobal('fetch', failing);
    await mount();

    const login = container.querySelector<HTMLAnchorElement>(
      '[data-account-chip="signed-out"]',
    );
    expect(login).not.toBeNull();
    expect(login!.getAttribute('href')).toBe(`${RELAY}/login`);
    // Graceful degrade means exactly one probe and no menu in the document.
    expect(failing).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`a[href="${RELAY}/account/repos"]`)).toBeNull();
  });
});
