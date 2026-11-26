export default function handler(_request, response) {
  response.setHeader("Cache-Control", "public, max-age=3600");
  response.setHeader("Location", "https://openoak.org/");
  response.status(308).end();
}
