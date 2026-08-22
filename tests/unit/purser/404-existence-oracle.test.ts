export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname);
      // route logic
    } catch (e) {
      if (e instanceof URIError) {
        return notFoundPage();
      }
    }
  }
}