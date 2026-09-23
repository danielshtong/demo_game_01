const NEWS_URL = "https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml";
const NS = "http://data.one.gov.hk/td";

const STATUS_LABEL = {
  1: "Active incident",
  2: "Update",
  3: "Notice",
};

function text(el, tag) {
  const node = el.getElementsByTagNameNS(NS, tag)[0];
  return node?.textContent?.trim() ?? "";
}

export async function fetchTrafficNews() {
  const res = await fetch(NEWS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`News request failed (${res.status})`);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse traffic news");

  return [...doc.getElementsByTagNameNS(NS, "message")].map((msg) => {
    const status = text(msg, "CurrentStatus") || "3";
    return {
      id: text(msg, "msgID"),
      status,
      statusLabel: STATUS_LABEL[status] || "Notice",
      title: text(msg, "EngShort") || text(msg, "EngText"),
      body: text(msg, "EngText"),
      chinese: text(msg, "ChinShort") || text(msg, "ChinText"),
      time: text(msg, "ReferenceDate"),
    };
  });
}

export function cameraImageUrl(camera, bust = Date.now()) {
  return `${camera.image}?t=${bust}`;
}
