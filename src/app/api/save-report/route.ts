const OLD_API = "https://talent-mapping-hazel.vercel.app";

export async function POST(request: Request) {
  const body = await request.text();
  const resp = await fetch(`${OLD_API}/api/save-report`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
  const data = await resp.json();
  return Response.json(data, { headers: { "Access-Control-Allow-Origin": "*" } });
}
