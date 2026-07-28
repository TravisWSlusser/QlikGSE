let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 5 * 60 * 1000;

async function fetchAtlassian(name, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  const indicator = data.status?.indicator || 'none';
  const status = indicator === 'none' ? 'operational' : indicator;
  return { name, status, description: data.status?.description || 'Operational' };
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
    fetchGemini('Gemini')
  ]);

  const names = ['Claude', 'ChatGPT', 'Gemini'];
  const statuses = results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return { name: names[i], status: 'unknown', description: 'Unable to reach' };
  });

  cache = { data: statuses, timestamp: now };
  return res.status(200).json(statuses);
}
