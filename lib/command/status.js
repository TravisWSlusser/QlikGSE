let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 5 * 60 * 1000;

async function fetchAtlassian(name, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  const indicator = data.status?.indicator || 'none';
  const status = indicator === 'none' ? 'operational' : indicator;
  return { name, status, description: data.status?.description || 'Operational' };
}

// Qlik Cloud gets its own fetcher: same aggregate shape as fetchAtlassian,
// plus a best-effort regional breakdown from the same Statuspage instance's
// components.json. Only AWS commercial regions are surfaced (name starts
// "Qlik Cloud <dash> AWS <dash> ...") — Government-tier and Talend Cloud
// components live on the same page but are not this widget's concern.
// Components failing is not fatal to the whole entry: the aggregate status
// from status.json still stands, the region list just comes back empty.
async function fetchQlikCloud(name, statusUrl, componentsUrl) {
  const response = await fetch(statusUrl, { signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  const indicator = data.status?.indicator || 'none';
  const status = indicator === 'none' ? 'operational' : indicator;
  const result = { name, status, description: data.status?.description || 'Operational' };

  try {
    const compRes = await fetch(componentsUrl, { signal: AbortSignal.timeout(5000) });
    const compData = await compRes.json();
    const AWS_REGION = /^Qlik Cloud\s*[–-]\s*AWS\s*[–-]\s*/;
    const regions = (compData.components || [])
      .filter(c => AWS_REGION.test(c.name) && c.status !== 'operational')
      .map(c => ({ name: c.name.replace(AWS_REGION, ''), status: c.status }));
    if (regions.length) result.regions = regions;
  } catch {
    // Regional breakdown is a bonus, not a requirement — swallow and move on.
  }

  return result;
}

async function fetchGemini(name) {
  const response = await fetch('https://status.cloud.google.com/incidents.json', { signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  const activeIncidents = data.filter(i => !i.end);
  const status = activeIncidents.length > 0 ? 'minor' : 'operational';
  return { name, status, description: activeIncidents.length > 0 ? 'Active Incident' : 'All Systems Operational' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const now = Date.now();
  if (cache.data && (now - cache.timestamp) < CACHE_DURATION) {
    return res.status(200).json(cache.data);
  }

  const results = await Promise.allSettled([
    fetchAtlassian('Claude', 'https://status.anthropic.com/api/v2/status.json'),
    fetchAtlassian('ChatGPT', 'https://status.openai.com/api/v2/status.json'),
    fetchGemini('Gemini'),
    // Same Atlassian Statuspage shape as Anthropic and OpenAI, so it reuses the
    // same fetcher. Mindtickle earns its place because it is the front door —
    // if it is down, nothing else being up actually helps.
    // NOTE: this list and `names` below are positional. Add to both or a failed
    // fetch gets labelled with the wrong service's name.
    fetchAtlassian('Mindtickle', 'https://status.mindtickle.com/api/v2/status.json'),
    // Requested by Rafael. Qlik's own public status.qlikcloud.com page is a
    // custom wrapper embedding the real Statuspage instance via iframe at
    // statusp-pb8g4h.qlikcloud.com — that iframe URL is the one with the
    // Atlassian /api/v2/status.json shape; status.qlikcloud.com itself 404s
    // on that path. Re-verify the subdomain if Qlik ever rotates it.
    fetchQlikCloud('Qlik Cloud',
      'https://statusp-pb8g4h.qlikcloud.com/api/v2/status.json',
      'https://statusp-pb8g4h.qlikcloud.com/api/v2/components.json')
  ]);

  const names = ['Claude', 'ChatGPT', 'Gemini', 'Mindtickle', 'Qlik Cloud'];
  const statuses = results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return { name: names[i], status: 'unknown', description: 'Unable to reach' };
  });

  cache = { data: statuses, timestamp: now };
  return res.status(200).json(statuses);
}
