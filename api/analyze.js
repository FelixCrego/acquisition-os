module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { answers = {}, scores = {}, priorities = [], actions = [] } = payload;
    const websiteScan = await scanWebsite(answers.website);
    const heuristicScores = buildWebsiteInfluencedScores(scores, websiteScan);

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        mode: 'heuristic',
        websiteScan,
        scoreOverrides: heuristicScores,
        analysis: buildFallbackAnalysis(answers, heuristicScores, priorities, websiteScan)
      });
    }

    const prompt = `
You are Acquisition OS, an operator-grade acquisition strategist.
You are given:
1. the operator's diagnostic answers
2. local heuristic scores
3. a website scan snapshot pulled directly from the submitted site
4. current priorities/actions

Return strict JSON with these keys:
- summary: short paragraph
- strategic_read: short paragraph
- priorities: array of 3 concise priority strings
- blindspots: array of 2 concise blindspot strings
- score_overrides: object with numeric keys offer, funnel, trust, ops from 0 to 100

Operator answers:
${JSON.stringify(answers, null, 2)}

Heuristic scores:
${JSON.stringify(heuristicScores, null, 2)}

Priority stack:
${JSON.stringify(priorities, null, 2)}

Recommended actions:
${JSON.stringify(actions, null, 2)}

Website scan snapshot:
${JSON.stringify(websiteScan, null, 2)}

Use the website scan heavily. If the site snapshot clearly suggests stronger or weaker performance than the operator self-report, adjust the scores.
Be specific, practical, and operator-focused. Avoid fluff.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        input: prompt,
        text: { format: { type: 'json_object' } }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'OpenAI request failed');
    }

    const data = await response.json();
    const rawText =
      data.output_text ||
      data.output?.map((item) => item?.content?.map((c) => c?.text || '').join('')).join('') ||
      '{}';

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {
        summary: rawText,
        strategic_read: '',
        priorities: [],
        blindspots: [],
        score_overrides: heuristicScores
      };
    }

    return res.status(200).json({
      mode: 'ai',
      websiteScan,
      scoreOverrides: normalizeScoreObject(parsed.score_overrides, heuristicScores),
      analysis: {
        summary: parsed.summary || '',
        strategic_read: parsed.strategic_read || '',
        priorities: Array.isArray(parsed.priorities) ? parsed.priorities : [],
        blindspots: Array.isArray(parsed.blindspots) ? parsed.blindspots : []
      }
    });
  } catch (error) {
    return res.status(200).json({
      mode: 'heuristic',
      websiteScan: { status: 'unavailable', note: 'Website scan failed.', error: error.message.slice(0, 180) },
      scoreOverrides: {},
      analysis: {
        summary: 'The AI layer was unavailable, so Acquisition OS fell back to local diagnostic logic.',
        strategic_read: 'Use the priority stack and next actions first. The scoring model still reflects where the system sees the most acquisition pressure.',
        priorities: [],
        blindspots: [error.message.slice(0, 180)]
      }
    });
  }
};

async function scanWebsite(rawUrl) {
  if (!rawUrl) {
    return { status: 'not_provided', note: 'No website URL was provided for scanning.' };
  }

  let url;
  try {
    url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    return { status: 'invalid', note: 'The submitted website URL is invalid.' };
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'AcquisitionOS/1.0 (+https://acquisition-os-two.vercel.app)' },
      redirect: 'follow'
    });

    if (!response.ok) {
      return { status: 'failed', note: `Could not fetch the site. HTTP ${response.status}.` };
    }

    const html = await response.text();
    const snapshot = extractWebsiteSnapshot(html, response.url || url.toString());
    return { status: 'ok', ...snapshot };
  } catch (error) {
    return { status: 'failed', note: `Website fetch failed: ${error.message.slice(0, 140)}` };
  }
}

function extractWebsiteSnapshot(html, finalUrl) {
  const cleanHtml = html || '';
  const text = stripTags(cleanHtml).replace(/\s+/g, ' ').trim();
  const title = matchOne(cleanHtml, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = matchMeta(cleanHtml, 'description');
  const h1s = matchAll(cleanHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).slice(0, 4);
  const h2s = matchAll(cleanHtml, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 8);
  const buttons = matchAll(cleanHtml, /<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/gi)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 20);

  const forms = (cleanHtml.match(/<form\b/gi) || []).length;
  const phoneVisible = /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/.test(text);
  const emailVisible = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const testimonialSignals = countKeywordHits(text, ['testimonial', 'review', 'client', 'customer', 'success story', 'case study']);
  const proofSignals = countKeywordHits(text, ['trusted', 'years', 'experience', 'results', 'why choose', 'google reviews', 'verified']);
  const urgencySignals = countKeywordHits(text, ['call now', 'book', 'schedule', 'get started', 'apply now', 'free consultation']);
  const pricingSignals = countKeywordHits(text, ['pricing', 'price', 'cost', '$', 'investment']);

  return {
    url: finalUrl,
    title: cleanText(title),
    metaDescription: cleanText(metaDescription),
    h1s: h1s.map(cleanText).filter(Boolean),
    h2s: h2s.map(cleanText).filter(Boolean),
    primaryButtons: inferPrimaryButtons(buttons),
    forms,
    wordCount: text ? text.split(/\s+/).length : 0,
    visiblePhone: phoneVisible,
    visibleEmail: emailVisible,
    testimonialSignals,
    proofSignals,
    urgencySignals,
    pricingSignals
  };
}

function buildWebsiteInfluencedScores(baseScores, websiteScan) {
  const adjusted = { ...baseScores };
  if (!websiteScan || websiteScan.status !== 'ok') return adjusted;

  adjusted.offer = clamp(
    Math.round(
      (Number(baseScores.offer) || 0) +
      (websiteScan.title ? 4 : -4) +
      (websiteScan.metaDescription ? 3 : -2) +
      (websiteScan.h1s.length ? 5 : -8) +
      scoreFromWordCount(websiteScan.wordCount, 250, 2200)
    )
  );

  adjusted.funnel = clamp(
    Math.round(
      (Number(baseScores.funnel) || 0) +
      (websiteScan.forms > 0 ? 6 : -8) +
      (websiteScan.primaryButtons.length >= 2 ? 5 : websiteScan.primaryButtons.length === 1 ? 2 : -6) +
      (websiteScan.urgencySignals > 0 ? 3 : -2)
    )
  );

  adjusted.trust = clamp(
    Math.round(
      (Number(baseScores.trust) || 0) +
      (websiteScan.visiblePhone ? 4 : -3) +
      (websiteScan.visibleEmail ? 2 : -1) +
      websiteScan.testimonialSignals * 3 +
      websiteScan.proofSignals * 2
    )
  );

  adjusted.ops = clamp(
    Math.round(
      (Number(baseScores.ops) || 0) +
      (websiteScan.forms > 0 ? 3 : -4) +
      (websiteScan.primaryButtons.length >= 1 ? 2 : -2) +
      (websiteScan.pricingSignals > 0 ? 1 : 0)
    )
  );

  return adjusted;
}

function buildFallbackAnalysis(answers, scores, priorities, websiteScan) {
  const weakest = Object.entries(scores)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([key]) => key);

  const siteRead = websiteScan?.status === 'ok'
    ? `The website scan found ${websiteScan.forms} form${websiteScan.forms === 1 ? '' : 's'}, ${websiteScan.primaryButtons.length} notable CTA${websiteScan.primaryButtons.length === 1 ? '' : 's'}, and ${websiteScan.testimonialSignals} visible proof/testimonial signal${websiteScan.testimonialSignals === 1 ? '' : 's'}.`
    : `The website could not be scanned directly, so this read relies more heavily on operator inputs.`;

  return {
    summary: `The current acquisition system appears to be under the most pressure in ${weakest.join(' and ')}. ${siteRead}`,
    strategic_read: `Based on the intake and the website snapshot, the business likely does not need more random activity first. It needs better alignment between how the offer is framed, how the visitor moves through the page or process, and how quickly the business converts attention into action.`,
    priorities: priorities.slice(0, 3).map((item) => item.title),
    blindspots: [
      answers.dropoffPoint === 'unclear'
        ? 'The actual drop-off point is not clear, which means visibility is likely part of the problem.'
        : 'The system should verify whether the stated drop-off point is really the first point of friction.',
      websiteScan?.status === 'ok' && websiteScan.testimonialSignals === 0
        ? 'The scanned page did not show obvious testimonial or proof language, which may be weakening trust.'
        : 'Even if the page looks acceptable, proof placement and CTA timing should be pressure-tested against real behavior.'
    ]
  };
}

function matchOne(html, regex) {
  const match = html.match(regex);
  return match?.[1] || '';
}

function matchAll(html, regex) {
  const values = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    values.push(match[1] || '');
  }
  return values;
}

function matchMeta(html, name) {
  const regex = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i');
  return matchOne(html, regex);
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function cleanText(text) {
  return stripTags(String(text || '')).replace(/\s+/g, ' ').trim();
}

function countKeywordHits(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.reduce((count, keyword) => count + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function inferPrimaryButtons(buttons) {
  return buttons
    .filter((text) => text.length > 1 && text.length < 50)
    .filter((text) => /call|book|schedule|get started|apply|contact|learn more|free|demo|quote|offer|submit/i.test(text))
    .slice(0, 8);
}

function scoreFromWordCount(wordCount, minGood, maxGood) {
  if (!wordCount) return -6;
  if (wordCount < minGood) return -4;
  if (wordCount > maxGood) return -2;
  return 4;
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

function normalizeScoreObject(scoreOverrides, fallback) {
  return {
    offer: clamp(Number(scoreOverrides?.offer ?? fallback.offer ?? 0)),
    funnel: clamp(Number(scoreOverrides?.funnel ?? fallback.funnel ?? 0)),
    trust: clamp(Number(scoreOverrides?.trust ?? fallback.trust ?? 0)),
    ops: clamp(Number(scoreOverrides?.ops ?? fallback.ops ?? 0))
  };
}
