const OLD_API = "https://talent-miner.vercel.app";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resp = await fetch(`${OLD_API}/api/data?${url.searchParams.toString()}`);
  const data = await resp.json();
  return Response.json(data, { headers: { "Access-Control-Allow-Origin": "*" } });
}
