'use strict';
const $ = (selector) => document.querySelector(selector);
const text = (tag, content, className) => { const el = document.createElement(tag); el.textContent = content; if (className) el.className = className; return el; };
const human = value => value.replaceAll('_', ' ').replaceAll('-', ' ');
let data, team = 'all', page = 0;
const pageSize = 12;
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
function setTheme() { document.documentElement.dataset.theme = theme; $('#theme').textContent = theme === 'dark' ? 'Light theme' : 'Dark theme'; $('#theme').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`); }
setTheme();
$('#theme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; setTheme(); });
function renderFindings() {
  const list = $('#finding-list'); list.replaceChildren();
  for (const f of data.findings) {
    const card = text('article', '', 'finding');
    const heading = text('div', '', 'finding-heading'); heading.append(text('h3', f.title), text('span', f.id, 'finding-id')); card.append(heading);
    const cols = text('div', '', `finding-columns${team === 'all' ? '' : ' filtered'}`);
    if (team === 'all' || team === 'red') { const c = text('div', '', 'red'); c.append(text('p', 'Red / challenge', 'team-label'), text('p', f.observation), text('p', f.qualification, 'qualification')); cols.append(c); }
    if (team === 'all' || team === 'white') { const c = text('div', '', 'white'); c.append(text('p', 'White / response', 'team-label'), text('p', f.response)); cols.append(c); }
    if (team === 'all' || team === 'blue') { const c = text('div', '', 'blue'); c.append(text('p', 'Independent red / Gate C', 'team-label'), text('p', human(f.verdict), 'verdict-label'), text('p', 'Fresh retest reproduced the repaired baseline, executed the defense controls, and added independent semantic challenges.'), text('p', data.scope, 'qualification')); cols.append(c); }
    card.append(cols); list.append(card);
  }
}
for (const button of document.querySelectorAll('[data-team]')) button.addEventListener('click', () => { team = button.dataset.team; for (const b of document.querySelectorAll('[data-team]')) b.setAttribute('aria-pressed', String(b === button)); renderFindings(); });
function renderLedger() {
  const doc = $('#document').value, category = $('#classification').value;
  const rows = data.intake.items.filter(row => (doc === 'all' || row.document === doc) && (category === 'all' || row.classification === category));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)); page = Math.min(page, pages - 1);
  $('#ledger-count').textContent = `${rows.length} of ${data.intake.items.length} preserved source units match these filters.`;
  const ledger = $('#ledger'); ledger.replaceChildren();
  for (const row of rows.slice(page * pageSize, (page + 1) * pageSize)) {
    const article = text('article', '', 'ledger-row'); article.id = row.id;
    article.append(text('p', row.id, 'unit'));
    const content = text('div', ''); content.append(text('p', row.summary), text('p', `${human(row.classification)} · ${data.documents[row.document]}, line ${row.line}`, 'category')); article.append(content);
    const routes = text('div', '', 'routes'); routes.append(text('p', `Routes: ${row.targets.join(', ')}`), text('p', row.status, 'quiet')); article.append(routes); ledger.append(article);
  }
  if (!rows.length) ledger.append(text('p', 'No source units in this combination. Choose another category or document.'));
  $('#page-count').textContent = `Page ${page + 1} of ${pages}`; $('#previous').disabled = page === 0; $('#next').disabled = page >= pages - 1;
}
for (const selector of ['#document', '#classification']) $(selector).addEventListener('change', () => { page = 0; renderLedger(); });
$('#previous').addEventListener('click', () => { page--; renderLedger(); $('#ledger-count').scrollIntoView(); });
$('#next').addEventListener('click', () => { page++; renderLedger(); $('#ledger-count').scrollIntoView(); });
fetch('campaign-data.json').then(response => { if (!response.ok) throw new Error('Evidence unavailable'); return response.json(); }).then(value => {
  data = value; $('#scope-text').textContent = `${data.scope.charAt(0).toUpperCase() + data.scope.slice(1)}.`;
  $('#findings-count').textContent = `${data.findings.length} findings · ${data.retest.direct_proverif_runs} direct ProVerif retest runs`;
  renderFindings();
  for (const [id, label] of Object.entries(data.documents)) { const option = text('option', label); option.value = id; $('#document').append(option); }
  const adjudication = data.scout.mathematical_adjudication;
  $('#scout-summary').textContent = `The literature scout adds ${data.scout.coverage.nonblank_units} units across ${data.scout.coverage.directions} directions and ${data.scout.coverage.source_notes} source notes. ${adjudication ? 'Current mathematical decisions follow below; source intake and theorem adoption remain separate.' : 'Its literature assertions and research obligations remain open.'}`;
  const sourceAudit = data.scout.source_audit;
  if (sourceAudit) {
    const abstractOnly = sourceAudit.statuses.metadata_abstract_verified || 0;
    const partial = sourceAudit.status.includes('partial') || sourceAudit.status === 'in_progress';
    $('#scholarship-status').textContent = `Literature audit: ${sourceAudit.citations} citations inventoried; ${sourceAudit.direction_checks} direction checks recorded; ${abstractOnly} records verified only at metadata/abstract level. ${partial ? 'Claim verification remains partial.' : human(sourceAudit.status) + '.'}`;
  }
  const decisions = adjudication ? adjudication.directions : data.scout.directions;
  for (const direction of decisions) {
    const id = direction.direction || direction.id;
    const intake = data.scout.directions.find(item => item.id === id);
    const article = text('article', '', 'math-item');
    article.append(text('h3', `${id} · ${(intake?.existing_tasks || []).join(', ')}`));
    if (adjudication) article.append(text('p', direction.decision), text('p', direction.status, 'quiet'), text('p', `Acceptance: ${direction.acceptance}`));
    else article.append(text('p', direction.hypothesis), text('p', direction.disposition), text('p', `Acceptance: ${direction.acceptance}`, 'quiet'), text('p', `Falsifier: ${direction.falsifier}`, 'quiet'), text('p', direction.next_action, 'quiet'));
    $('#scout-directions').append(article);
  }
  for (const [name, result] of Object.entries(data.retest.new_mutant_observations)) $('#mutants').append(text('li', `${human(name)}: ${result}.`));
  for (const h of data.blue.harnesses) { const li = text('li', human(h.name.replace('proof_', ''))); li.append(text('span', `${h.successful ? 'PASS' : 'OPEN'} · ${h.covers_satisfied}/${h.covers_total} covers`)); $('#harnesses').append(li); }
  $('#blue-scope').textContent = data.blue.source_scope;
  if (data.guestPython) {
    const guest = data.guestPython, results = guest.research_results;
    $('#guest-python-verdict').textContent = `${guest.verdict}: the fixed checker returned the exact expected D14, D8, and D29 output. The intentional assertion control returned exit ${guest.expected_exit_codes.negative}; the positive checker returned exit ${guest.expected_exit_codes.positive}. Python ${guest.python_version} and its executable hash matched the staged manifest.`;
    const summaries = [
      ['D14 / reputation payoff', `${results.D14.bounded_positive_cases.toLocaleString('en-US')} bounded positive cases; conserved balance ${results.D14.conserved_balance}. Split payoff ${results.D14.split_payoff} versus unsplit payoff ${results.D14.unsplit_payoff}.`],
      ['D8 / task-specific information', `${results.D8.worlds} worlds and ${results.D8.digest_cells} digest cells. Opening loss ${results.D8.zero_miss_opening_loss}; digest guessing risk ${results.D8.digest_guess_risk} versus full-observation risk ${results.D8.full_guess_risk}.`],
      ['D29 / shared-state composition', `${results.D29.schedules} legal schedules; ${results.D29.violating_schedules} violate the reservation invariant. ${results.D29.atomic_orders_checked} atomic orders checked.`]
    ];
    for (const [title, summary] of summaries) { const item = text('div', ''); item.append(text('h4', title), text('p', summary)); $('#guest-python-results').append(item); }
    $('#guest-python-provenance').textContent = guest.provenance_limit;
    $('#guest-python').hidden = false;
  }
  $('#next-title').textContent = data.nextP6.title; $('#next-status').textContent = data.nextP6.status; $('#next-result').textContent = data.nextP6.result; $('#next-action').textContent = data.nextP6.next;
  for (const [doc, counts] of Object.entries(data.intake.coverage)) { const stat = text('div', '', 'coverage-stat'); stat.append(text('strong', `${counts.covered_nonblank_lines} / ${counts.nonblank_lines}`), text('span', `${data.documents[doc]} · nonblank lines routed`)); $('#coverage-summary').append(stat); }
  for (const category of [...new Set(data.intake.items.map(x => x.classification))].sort()) { const option = text('option', human(category)); option.value = category; $('#classification').append(option); }
  for (const finding of data.math) { const article = text('article', '', 'math-item'); article.append(text('h3', human(finding.id)), text('p', finding.result), text('p', `Next: ${finding.next}`, 'quiet')); $('#math-list').append(article); }
  renderLedger();
  $('#transcript-scope').textContent = `${data.transcripts.sources_count} source-session prefixes inventoried. ${data.transcripts.scope}`;
  $('#transcript-publication').textContent = data.transcripts.publication;
  for (const source of data.sources) { const li = text('li', ''); if (source.url) { const link = text('a', source.label); link.href = source.url; li.append(link); } else { li.append(text('span', source.label), text('span', ' · publication link pending', 'pending')); } $('#source-list').append(li); }
  $('#evidence').hidden = false;
}).catch(() => { $('#load-error').hidden = false; });
