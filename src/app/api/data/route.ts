const OLD_API = "https://talent-miner.vercel.app";

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    if (url.searchParams.get("latest") === "true") {
      const listResp = await fetch(`${OLD_API}/api/data?list=true`, { cache: "no-store" });
      const list = await listResp.json();
      const latest = list.positions?.[0];

      if (!latest?.id) {
        return Response.json({ position: null, detail: null }, { headers: { "Access-Control-Allow-Origin": "*" } });
      }

      const detailResp = await fetch(`${OLD_API}/api/data?position_id=${latest.id}`, { cache: "no-store" });
      const detail = await detailResp.json();
      const reportHtml = typeof detail.report_html === "string" ? detail.report_html : "";
      return Response.json(
        {
          position: latest,
          detail: {
            ...detail,
            _hasReport: reportHtml.length > 100,
            report_html: "",
          },
        },
        { headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const resp = await fetch(`${OLD_API}/api/data?${url.searchParams.toString()}`);
    const data = await resp.json();
    return Response.json(data, { headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown data proxy error";
    return Response.json({ error: message }, { status: 502, headers: { "Access-Control-Allow-Origin": "*" } });
  }
}
