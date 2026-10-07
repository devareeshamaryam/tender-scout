// JSON GET with retries. Contracts Finder and Find a Tender both allow ~12
// requests per window and reply "Rate limit of 12 exceeded. Please retry after 120 seconds."

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, label, attempt = 1) {
  let res;
  let body;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
    body = await res.text();
  } catch (err) {
    // Network blips (DNS, connection reset) - retry a few times.
    if (attempt > 4) throw err;
    console.log(`${label} network error (${err.cause?.code || err.message}), retrying in ${15 * attempt}s...`);
    await sleep(15000 * attempt);
    return getJson(url, label, attempt + 1);
  }

  const rateLimit = body.match(/Rate limit.*?retry after (\d+) seconds/i);
  if ((rateLimit || res.status === 429 || res.status >= 500) && attempt <= 8) {
    const waitSec = rateLimit ? Number(rateLimit[1]) + 5 : 10 * attempt;
    console.log(`${label} busy (${res.status}), retrying in ${waitSec}s...`);
    await sleep(waitSec * 1000);
    return getJson(url, label, attempt + 1);
  }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

module.exports = { getJson, sleep };
