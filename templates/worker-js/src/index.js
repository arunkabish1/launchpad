export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/hello") {
      return new Response(`Hello from __PROJECT_NAME__!`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
