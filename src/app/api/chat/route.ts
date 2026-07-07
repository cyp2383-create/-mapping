const OLD_API = "https://talent-mapping-hazel.vercel.app";

export async function POST(request: Request) {
  const body = await request.text();
  const resp = await fetch(`${OLD_API}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" },
  });
}
export async function OPTIONS() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
