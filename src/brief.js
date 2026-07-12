export function createWeekendBrief({ startDate, endDate, generatedAt = new Date(), rankedCandidates, minimumUtility }) {
  const recommendations = rankedCandidates.filter((candidate) => !candidate.ranking.excluded && candidate.ranking.utility >= minimumUtility).slice(0, 5);
  const verdict = recommendations.length > 0 ? 'go out' : 'do not waste your time this weekend';
  return {
    schemaVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    window: { startDate, endDate },
    verdict,
    recommendations,
    rejectedCount: rankedCandidates.length - recommendations.length
  };
}

export function renderBriefMarkdown(brief) {
  const lines = [
    `# Taste Engine: ${brief.window.startDate} to ${brief.window.endDate}`,
    '',
    `**Verdict:** ${brief.verdict}`,
    '',
    `Generated ${brief.generatedAt}.`,
    ''
  ];

  if (brief.recommendations.length === 0) {
    lines.push('Nothing cleared the current personal-value threshold. Save the weekend for something better.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('## Top picks', '');
  for (const [index, candidate] of brief.recommendations.entries()) {
    const ranking = candidate.ranking;
    const venue = [candidate.venue.name, candidate.venue.city].filter(Boolean).join(', ');
    lines.push(`${index + 1}. **${candidate.title}** — ${candidate.startLocal ?? 'time TBD'}`);
    lines.push(`   - ${venue || 'venue TBD'} · [Tickets/source](${candidate.sourceUrl})`);
    lines.push(`   - Why you: ${ranking.whyYou}`);
    lines.push(`   - Hassle ${ranking.hassleScore}/10: ${ranking.hassleReasons.join('; ') || 'details still sparse'}`);
    lines.push(`   - Ticket urgency: ${ranking.urgency} · Confidence: ${ranking.confidence}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
