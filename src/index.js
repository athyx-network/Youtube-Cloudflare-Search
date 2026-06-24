const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

export default {
  async fetch(request) {

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Get the search query from ?q=
    const url = new URL(request.url);
    const query = url.searchParams.get("q");

    if (!query) {
      return new Response(
        JSON.stringify({
          error: "Missing search query. Use ?q=search_term"
        }),
        {
          status: 400,
          headers: corsHeaders
        }
      );
    }

    try {
      const youtubeUrl =
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

      const response = await fetch(youtubeUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`YouTube returned ${response.status}`);
      }

      const html = await response.text();
      const videos = parseYouTubeHTML(html);

      return new Response(
        JSON.stringify(videos),
        {
          headers: corsHeaders
        }
      );

    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err.message
        }),
        {
          status: 500,
          headers: corsHeaders
        }
      );
    }
  }
};

function parseYouTubeHTML(html) {
  const videos = [];
  const seen = new Set();

  const patterns = [
    /var ytInitialData\s*=\s*(\{.+?\});/s,
    /ytInitialData\s*=\s*(\{.+?\})\s*<\/script>/s,
    /var ytInitialData = (\{.+?\});/s
  ];

  let data = null;

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match) {
      try {
        data = JSON.parse(match[1]);
        break;
      } catch (_) {}
    }
  }

  if (data) {
    try {
      const renderers = walk(data, "videoRenderer");

      for (const vr of renderers) {
        const id = vr?.videoId;

        if (!id || seen.has(id)) continue;
        seen.add(id);

        const title = getText(vr?.title);
        const creator =
          getText(vr?.ownerText) ||
          getText(vr?.shortBylineText) ||
          "Unknown";

        const thumb = getBestThumbnail(
          vr?.thumbnail?.thumbnails
        );

        const length =
          getText(vr?.lengthText) || "Unknown";

        videos.push({
          videoId: id,
          title: title || "Untitled",
          creator,
          url: `https://www.youtube.com/watch?v=${id}`,
          thumbnail: thumb,
          length
        });
      }
    } catch (e) {
      console.error("Error parsing JSON:", e);
    }
  }

  // Fallback regex extraction
  if (!videos.length) {
    const idRe =
      /"videoId":"([A-Za-z0-9_-]{11})"/g;

    const titleRe =
      /"title":\{"runs":\[\{"text":"([^"]+)"\}(?:,\{"text":"[^"]*"\})*\]/g;

    const chanRe =
      /"shortBylineText":\{"runs":\[\{"text":"([^"]+)"/g;

    const thumbRe =
      /"thumbnail":\{"thumbnails":\[\{[^\}]*"url":"([^"]+)"/g;

    const lengthRe =
      /"lengthText":\{"simpleText":"([^"]+)"/g;

    const ids = [...html.matchAll(idRe)];
    const titles = [...html.matchAll(titleRe)];
    const chans = [...html.matchAll(chanRe)];
    const thumbs = [...html.matchAll(thumbRe)];
    const lengths = [...html.matchAll(lengthRe)];

    ids.forEach((m, i) => {
      const id = m[1];

      if (seen.has(id)) return;
      seen.add(id);

      videos.push({
        videoId: id,
        title: titles[i]?.[1] || "Untitled",
        creator: chans[i]?.[1] || "Unknown",
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnail:
          thumbs[i]?.[1] ||
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        length: lengths[i]?.[1] || "Unknown"
      });
    });
  }

  return videos;
}

function walk(obj, key, out = []) {
  if (!obj || typeof obj !== "object") {
    return out;
  }

  if (key in obj) {
    out.push(obj[key]);
  }

  for (const value of Object.values(obj)) {
    walk(value, key, out);
  }

  return out;
}

function getText(node) {
  if (!node) return "";

  if (typeof node === "string") {
    return node;
  }

  if (node.simpleText) {
    return node.simpleText;
  }

  if (Array.isArray(node.runs)) {
    return node.runs
      .map(run => run.text)
      .join("");
  }

  return "";
}

function getBestThumbnail(list) {
  if (!Array.isArray(list) || !list.length) {
    return "";
  }

  return list[list.length - 1].url;
}
