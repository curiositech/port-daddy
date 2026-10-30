type: fixed

- **Website deployment uses a runner supported by Playwright.** Pin `.github/workflows/deploy-website-v2.yml` to `ubuntu-24.04` because Playwright 1.58.2 rejects Chromium dependency installation on Ubuntu 26.04, which stopped the production workflow before build and deployment.
