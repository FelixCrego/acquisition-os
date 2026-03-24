const steps = Array.from(document.querySelectorAll('.step-panel'));
const form = document.getElementById('assessmentForm');
const nextStepBtn = document.getElementById('nextStepBtn');
const prevStepBtn = document.getElementById('prevStepBtn');
const runAssessmentBtn = document.getElementById('runAssessmentBtn');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const emptyState = document.getElementById('emptyState');
const resultsContent = document.getElementById('resultsContent');
const priorityList = document.getElementById('priorityList');
const nextActions = document.getElementById('nextActions');
const overallHeadline = document.getElementById('overallHeadline');
const overallSummary = document.getElementById('overallSummary');
const aiStatus = document.getElementById('aiStatus');
const aiAnalysis = document.getElementById('aiAnalysis');
const rerunAiBtn = document.getElementById('rerunAiBtn');
const scanStatus = document.getElementById('scanStatus');
const websiteScanEl = document.getElementById('websiteScan');

let currentStep = 1;
let lastResult = null;

document.addEventListener('DOMContentLoaded', () => {
  bindSmoothScroll();
  bindRanges();
  bindStepControls();
  updateStepUI();
});

function bindSmoothScroll() {
  const links = document.querySelectorAll('a[href^="#"]');
  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      const id = link.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function bindRanges() {
  document.querySelectorAll('input[type="range"]').forEach((input) => {
    const output = document.querySelector(`[data-range-output="${input.id}"]`);
    const sync = () => {
      if (output) output.textContent = input.value;
    };
    input.addEventListener('input', sync);
    sync();
  });
}

function bindStepControls() {
  nextStepBtn.addEventListener('click', () => {
    if (!validateCurrentStep()) return;
    currentStep += 1;
    updateStepUI();
  });

  prevStepBtn.addEventListener('click', () => {
    currentStep -= 1;
    updateStepUI();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateCurrentStep()) return;
    const result = buildDiagnostic();
    lastResult = result;
    renderResults(result);
    await runAiAnalysis(result);
    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  rerunAiBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    await runAiAnalysis(lastResult);
  });
}

function updateStepUI() {
  steps.forEach((step) => {
    step.classList.toggle('active', Number(step.dataset.step) === currentStep);
  });

  const pct = (currentStep / steps.length) * 100;
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `Step ${currentStep} of ${steps.length}`;

  prevStepBtn.classList.toggle('hidden', currentStep === 1);
  nextStepBtn.classList.toggle('hidden', currentStep === steps.length);
  runAssessmentBtn.classList.toggle('hidden', currentStep !== steps.length);
}

function validateCurrentStep() {
  const panel = steps.find((step) => Number(step.dataset.step) === currentStep);
  if (!panel) return true;

  const requiredFields = panel.querySelectorAll('[required]');
  for (const field of requiredFields) {
    if (!field.value) {
      field.reportValidity();
      return false;
    }
  }
  return true;
}

function buildDiagnostic() {
  const formData = new FormData(form);
  const answers = Object.fromEntries(formData.entries());

  const scores = {
    offer: calculateOfferScore(answers),
    funnel: calculateFunnelScore(answers),
    trust: calculateTrustScore(answers),
    ops: calculateOpsScore(answers)
  };

  const priorities = buildPriorities(scores, answers);
  const actions = buildActions(scores, answers);

  return { answers, scores, priorities, actions };
}

function calculateOfferScore(answers) {
  let score = Number(answers.offerClarity || 5) + Number(answers.differentiation || 5);
  score += scoreValue(answers.pricingConfidence, { low: 1, medium: 3, high: 5 });
  return normalizeScore(score, 25);
}

function calculateFunnelScore(answers) {
  let score = Number(answers.ctaStrength || 5);
  score += scoreValue(answers.formFriction, { high: 1, medium: 3, low: 5 });
  score += scoreValue(answers.dropoffPoint, { landing: 2, form: 3, sales: 4, unclear: 1 });
  return normalizeScore(score, 20);
}

function calculateTrustScore(answers) {
  let score = Number(answers.proofStrength || 5);
  score += scoreValue(answers.pricingConfidence, { low: 2, medium: 3, high: 5 });
  score += scoreValue(answers.dropoffPoint, { landing: 2, form: 3, sales: 4, unclear: 2 });
  return normalizeScore(score, 20);
}

function calculateOpsScore(answers) {
  let score = scoreValue(answers.followupSpeed, { slow: 1, moderate: 3, fast: 5 });
  score += scoreValue(answers.trackingConfidence, { low: 1, medium: 3, high: 5 });
  score += scoreValue(answers.goalWindow, { urgent: 2, quarter: 3, longer: 4 });
  return normalizeScore(score, 15);
}

function scoreValue(value, map) {
  return map[value] || 0;
}

function normalizeScore(score, max) {
  return Math.max(0, Math.min(100, Math.round((score / max) * 100)));
}

function buildPriorities(scores, answers) {
  const items = [];
  const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1]);

  weakest.forEach(([key, value], index) => {
    const level = value < 45 ? 'critical' : value < 65 ? 'high' : 'medium';
    items.push(priorityTemplate(key, level, answers, index));
  });

  return items.slice(0, 3);
}

function priorityTemplate(key, level, answers, index) {
  const templates = {
    offer: {
      title: 'Clarify the offer and sharpen differentiation',
      detail: 'The system sees weakness in how the offer is framed. Tighten the promise, make the value easier to understand, and remove generic positioning.'
    },
    funnel: {
      title: 'Reduce friction in the conversion path',
      detail: 'The page or lead path is likely making action harder than it should be. Simplify the CTA, reduce friction, and inspect where users stall before submitting or booking.'
    },
    trust: {
      title: 'Increase confidence with stronger proof',
      detail: 'Acquisition is likely leaking because the page or process is not creating enough belief. Add sharper credibility, proof timing, and clearer reassurance around the offer.'
    },
    ops: {
      title: 'Tighten follow-up and visibility',
      detail: 'The system is likely losing yield after the click or lead comes in. Improve response speed, lead handling, and reporting confidence before scaling more traffic.'
    }
  };

  return {
    rank: index + 1,
    level,
    title: templates[key].title,
    detail: templates[key].detail,
    module: key
  };
}

function buildActions(scores, answers) {
  const actions = [];

  if (scores.offer < 60) {
    actions.push({
      title: 'Rewrite the primary offer block',
      detail: 'Make the offer easier to understand in one glance and reduce generic language that sounds like every competitor.'
    });
  }

  if (scores.funnel < 60) {
    actions.push({
      title: 'Audit CTA and form friction',
      detail: 'Reduce unnecessary fields, clarify the ask, and align the CTA with the actual buying stage of the visitor.'
    });
  }

  if (scores.trust < 60) {
    actions.push({
      title: 'Upgrade proof placement and confidence signals',
      detail: 'Move testimonials, case studies, authority markers, and reassurance closer to the decision points.'
    });
  }

  if (scores.ops < 60) {
    actions.push({
      title: 'Shorten response time and improve attribution',
      detail: 'Tighten the operational handoff after a lead arrives so follow-up does not kill acquisition efficiency.'
    });
  }

  if (!actions.length) {
    actions.push({
      title: 'Stress-test the current system before scaling',
      detail: 'The scores suggest a relatively healthy acquisition base. Validate with real lead flow and tighten the weakest module before increasing spend.'
    });
  }

  if (answers.biggestConstraint) {
    actions.push({
      title: 'Pressure-test the stated constraint',
      detail: `The operator identified this as the main issue: "${answers.biggestConstraint}". Validate whether that is the root problem or just the most visible symptom.`
    });
  }

  return actions.slice(0, 4);
}

function renderResults(result) {
  emptyState.classList.add('hidden');
  resultsContent.classList.remove('hidden');

  setScore('offer', result.scores.offer);
  setScore('funnel', result.scores.funnel);
  setScore('trust', result.scores.trust);
  setScore('ops', result.scores.ops);

  const weakest = [...Object.entries(result.scores)].sort((a, b) => a[1] - b[1])[0][0];
  overallHeadline.textContent = headlineForWeakest(weakest);
  overallSummary.textContent = summaryForScores(result.scores, result.answers);

  priorityList.innerHTML = '';
  result.priorities.forEach((item) => {
    const node = document.createElement('article');
    node.className = 'priority-item';
    node.dataset.level = item.level;
    node.innerHTML = `<strong>#${item.rank} ${item.title}</strong><span>${item.detail}</span>`;
    priorityList.appendChild(node);
  });

  nextActions.innerHTML = '';
  result.actions.forEach((item) => {
    const node = document.createElement('article');
    node.className = 'action-item';
    node.innerHTML = `<strong>${item.title}</strong><span>${item.detail}</span>`;
    nextActions.appendChild(node);
  });

  aiStatus.textContent = 'Generating';
  scanStatus.textContent = result.answers.website ? 'Scanning website' : 'No website';
  websiteScanEl.innerHTML = result.answers.website
    ? '<p>Acquisition OS is inspecting the submitted page for headings, CTAs, trust cues, forms, and visible conversion signals.</p>'
    : '<p>No website URL was supplied, so scoring will rely more heavily on the guided intake.</p>';
  aiAnalysis.innerHTML = '<p>Acquisition OS is building a strategy readout based on your scores and answers.</p>';
}

function setScore(key, value) {
  document.getElementById(`${key}Score`).textContent = value;
  document.getElementById(`${key}Label`).textContent = scoreLabel(value);
}

function scoreLabel(value) {
  if (value < 45) return 'Under pressure';
  if (value < 65) return 'Needs work';
  if (value < 80) return 'Stable';
  return 'Strong';
}

function headlineForWeakest(weakest) {
  const headlines = {
    offer: 'The offer itself is likely slowing the machine down.',
    funnel: 'The acquisition path is adding too much friction.',
    trust: 'Confidence is dropping before prospects commit.',
    ops: 'The back half of the system is suppressing yield.'
  };
  return headlines[weakest];
}

function summaryForScores(scores, answers) {
  const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([key]) => key);
  return `Acquisition OS sees the most pressure in ${weakest.join(' and ')}. Based on the current inputs, the business likely needs tighter alignment between the offer, the conversion path, and the operating layer that turns attention into action.`;
}

async function runAiAnalysis(result) {
  aiStatus.textContent = 'Thinking';
  rerunAiBtn.disabled = true;

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    });

    const data = await response.json();
    const analysis = data.analysis || {};
    const effectiveScores = data.scoreOverrides || result.scores;

    setScore('offer', effectiveScores.offer);
    setScore('funnel', effectiveScores.funnel);
    setScore('trust', effectiveScores.trust);
    setScore('ops', effectiveScores.ops);
    overallSummary.textContent = summaryForScores(effectiveScores, result.answers);

    aiStatus.textContent = data.mode === 'ai' ? 'AI mode' : 'Heuristic mode';
    renderWebsiteScan(data.websiteScan);
    aiAnalysis.innerHTML = '';

    const blocks = [
      analysis.summary,
      analysis.strategic_read,
      Array.isArray(analysis.priorities) && analysis.priorities.length
        ? `Top priorities: ${analysis.priorities.join('; ')}`
        : '',
      Array.isArray(analysis.blindspots) && analysis.blindspots.length
        ? `Blind spots to watch: ${analysis.blindspots.join('; ')}`
        : ''
    ].filter(Boolean);

    blocks.forEach((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      aiAnalysis.appendChild(p);
    });
  } catch (error) {
    aiStatus.textContent = 'Unavailable';
    scanStatus.textContent = 'Unavailable';
    aiAnalysis.innerHTML = `<p>The AI layer could not respond. The local scoring engine is still active, and the priority stack above is still valid.</p>`;
    websiteScanEl.innerHTML = '<p>The website scan could not be completed.</p>';
  } finally {
    rerunAiBtn.disabled = false;
  }
}

function renderWebsiteScan(scan) {
  if (!scan) {
    scanStatus.textContent = 'Unavailable';
    websiteScanEl.innerHTML = '<p>The website scan did not return any usable data.</p>';
    return;
  }

  if (scan.status !== 'ok') {
    scanStatus.textContent = scan.status.replace(/_/g, ' ');
    websiteScanEl.innerHTML = `<p>${scan.note || 'The website could not be analyzed directly.'}</p>`;
    return;
  }

  scanStatus.textContent = 'Scanned';
  const h1Text = Array.isArray(scan.h1s) && scan.h1s.length ? scan.h1s[0] : 'No clear H1 found';
  const buttons = Array.isArray(scan.primaryButtons) && scan.primaryButtons.length
    ? scan.primaryButtons.join(', ')
    : 'No obvious CTA language found';

  websiteScanEl.innerHTML = `
    <p><strong>URL:</strong> ${escapeHtml(scan.url || '')}</p>
    <p><strong>Headline signal:</strong> ${escapeHtml(h1Text)}</p>
    <p><strong>Primary CTA language:</strong> ${escapeHtml(buttons)}</p>
    <p><strong>Forms / proof / contact:</strong> ${scan.forms} form(s), ${scan.testimonialSignals} proof signal(s), phone visible: ${scan.visiblePhone ? 'yes' : 'no'}, email visible: ${scan.visibleEmail ? 'yes' : 'no'}</p>
  `;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
