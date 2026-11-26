export default function handler(request, response) {
  const source = new URL(request.url, "https://opentodo.org");
  const destination = new URL("https://openoak.org/legal/");
  destination.search = source.search;

  response.setHeader("Cache-Control", "public, max-age=3600");
  response.setHeader("Location", destination.toString());
  response.status(308).end();
}
