module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { answers = {}, scores = {}, priorities = [] } = payload;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        mode: 'heuristic',
        analysis: buildFallbackAnalysis(answers, scores, priorities)
      });
    }

    const prompt = `
You are analyzing an acquisition diagnostic for a business operator.
Return strict JSON with keys:
- summary: short paragraph
- strategic_read: short paragraph
- priorities: array of 3 concise priority strings
- blindspots: array of 2 concise blindspot strings

Diagnostic scores:
${JSON.stringify(scores, null, 2)}

Top priorities:
${JSON.stringify(priorities, null, 2)}

Answers:
${JSON.stringify(answers, null, 2)}

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
      data.output?.map((item) => item?.content?.map((c) => c?.text).join('')).join('') ||
      '{}';

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {
        summary: rawText,
        strategic_read: '',
        priorities: [],
        blindspots: []
      };
    }

    return res.status(200).json({
      mode: 'ai',
      analysis: parsed
    });
  } catch (error) {
    return res.status(200).json({
      mode: 'heuristic',
      analysis: {
        summary: 'The AI layer was unavailable, so Acquisition OS fell back to local diagnostic logic.',
        strategic_read: 'Use the priority stack and next actions first. The scoring model still reflects where the system sees the most acquisition pressure.',
        priorities: [],
        blindspots: [error.message.slice(0, 180)]
      }
    });
  }
};

function buildFallbackAnalysis(answers, scores, priorities) {
  const weakest = Object.entries(scores)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([key]) => key);

  return {
    summary: `The current acquisition system appears to be under the most pressure in ${weakest.join(' and ')}. The fastest gains are likely to come from tightening the offer, lowering friction, and making follow-up or proof feel more reliable.`,
    strategic_read: `Based on the intake, the business likely does not need more random activity first. It needs better alignment between how the offer is framed, how the visitor moves through the page or process, and how quickly the business converts attention into action.`,
    priorities: priorities.slice(0, 3).map((item) => item.title),
    blindspots: [
      answers.dropoffPoint === 'unclear'
        ? 'The actual drop-off point is not clear, which means visibility is likely part of the problem.'
        : 'The system should verify whether the stated drop-off point is really the first point of friction.',
      answers.trackingConfidence === 'low'
        ? 'Low attribution confidence suggests decision-making may be happening with partial signal.'
        : 'Even with moderate confidence, tracking quality should be pressure-tested against real lead movement.'
    ]
  };
}
