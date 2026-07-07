const OLD_API = "https://talent-miner.vercel.app";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resp = await fetch(`${OLD_API}/api/podcast-audio?position_id=${url.searchParams.get("position_id") || ""}`);
  if (!resp.ok) return new Response("Audio not available", { status: resp.status });
  return new Response(resp.body, {
    headers: { "Content-Type": "audio/mpeg", "Access-Control-Allow-Origin": "*" },
  });
}
