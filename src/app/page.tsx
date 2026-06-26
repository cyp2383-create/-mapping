import HomeClient, { type LatestPayload } from "./home-client";

const OLD_API = "https://talent-miner.vercel.app";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialPayload = await loadLatestPayload();
  return <HomeClient initialPayload={initialPayload} />;
}

async function loadLatestPayload(): Promise<LatestPayload | null> {
  try {
    const listResp = await fetch(`${OLD_API}/api/data?list=true`, { cache: "no-store" });
    if (!listResp.ok) throw new Error("list failed");

    const list = (await listResp.json()) as { positions?: Array<{ id?: string | number }> };
    const latest = list.positions?.[0];
    if (!latest?.id) return null;

    const detailResp = await fetch(`${OLD_API}/api/data?position_id=${latest.id}`, { cache: "no-store" });
    if (!detailResp.ok) throw new Error("detail failed");

    const detail = await detailResp.json();
    const reportHtml = typeof detail.report_html === "string" ? detail.report_html : "";
    return {
      position: latest,
      detail: {
        ...detail,
        _hasReport: reportHtml.length > 100,
        report_html: "",
      },
    } as LatestPayload;
  } catch {
    return null;
  }
}
