export default function handler(request, response) {
  const source = new URL(request.url, "https://openoak.org");
  const redirectPath = source.searchParams.get("redirectPath") || "";
  source.searchParams.delete("redirectPath");

  const destination = new URL(
    redirectPath ? `/outline/${redirectPath}` : "/outline/",
    "https://openoak.org",
  );
  destination.search = source.searchParams.toString();

  response.setHeader("Cache-Control", "public, max-age=3600");
  response.setHeader("Location", destination.toString());
  response.status(308).end();
}
