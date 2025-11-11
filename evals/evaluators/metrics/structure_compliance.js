/**
 * Structure Compliance Metric
 * Evaluates whether the formatted output follows markdown structure rules
 */

/**
 * Check if output has proper ## headers for topics
 * @param {string} output - The formatted markdown output
 * @returns {Object} - Score and details
 */
function checkHeaderStructure(output) {
  const lines = output.split('\n');
  const h2Headers = lines.filter(line => line.trim().startsWith('## '));

  return {
    has_headers: h2Headers.length > 0,
    header_count: h2Headers.length,
    headers: h2Headers.map(h => h.trim()),
    score: h2Headers.length > 0 ? 1.0 : 0.0
  };
}

/**
 * Check if speakers are properly formatted with bold
 * @param {string} output - The formatted markdown output
 * @returns {Object} - Score and details
 */
function checkSpeakerFormatting(output) {
  const lines = output.split('\n');

  // Look for patterns like **Interviewer:** or **[00:00] Interviewer:**
  const speakerPattern = /^\*\*(\[[\d:]+\]\s)?([A-Za-z\s]+):\*\*/;
  const speakerLines = lines.filter(line => speakerPattern.test(line.trim()));

  // Also count lines that should be speaker lines but aren't formatted
  const potentialSpeakerPattern = /^(\[[\d:]+\]\s)?([A-Za-z]+):/;
  const potentialSpeakers = lines.filter(line => {
    const trimmed = line.trim();
    return potentialSpeakerPattern.test(trimmed) && !speakerPattern.test(trimmed);
  });

  const total = speakerLines.length + potentialSpeakers.length;
  const score = total > 0 ? speakerLines.length / total : 1.0;

  return {
    properly_formatted: speakerLines.length,
    missing_formatting: potentialSpeakers.length,
    score: score,
    examples: speakerLines.slice(0, 3)
  };
}

/**
 * Check if timestamps are preserved (if present in input)
 * @param {string} input - Original input
 * @param {string} output - Formatted output
 * @returns {Object} - Score and details
 */
function checkTimestampPreservation(input, output) {
  const timestampPattern = /\[[\d:]+\]/g;
  const inputTimestamps = (input.match(timestampPattern) || []).length;
  const outputTimestamps = (output.match(timestampPattern) || []).length;

  if (inputTimestamps === 0) {
    return {
      applicable: false,
      score: 1.0,
      message: 'No timestamps in input'
    };
  }

  const score = outputTimestamps / inputTimestamps;

  return {
    applicable: true,
    input_timestamps: inputTimestamps,
    output_timestamps: outputTimestamps,
    score: score,
    all_preserved: score === 1.0
  };
}

/**
 * Check overall markdown validity
 * @param {string} output - The formatted markdown output
 * @returns {Object} - Score and details
 */
function checkMarkdownValidity(output) {
  const issues = [];

  // Check for unmatched bold markers
  const boldMatches = output.match(/\*\*/g) || [];
  if (boldMatches.length % 2 !== 0) {
    issues.push('Unmatched bold markers (**)');
  }

  // Check for consistent heading levels (should start with ##, not ###)
  const lines = output.split('\n');
  const firstHeading = lines.find(line => line.trim().startsWith('#'));
  if (firstHeading && firstHeading.trim().startsWith('###')) {
    issues.push('Headings should start with ## (level 2), not ###');
  }

  // Check for empty headers
  const emptyHeaders = lines.filter(line => /^##\s*$/.test(line.trim()));
  if (emptyHeaders.length > 0) {
    issues.push(`Found ${emptyHeaders.length} empty header(s)`);
  }

  return {
    is_valid: issues.length === 0,
    issues: issues,
    score: issues.length === 0 ? 1.0 : Math.max(0, 1.0 - (issues.length * 0.25))
  };
}

/**
 * Main structure compliance evaluator
 * @param {string} input - Original input
 * @param {string} output - Formatted output
 * @returns {Object} - Comprehensive evaluation results
 */
function evaluateStructureCompliance(input, output) {
  const headerCheck = checkHeaderStructure(output);
  const speakerCheck = checkSpeakerFormatting(output);
  const timestampCheck = checkTimestampPreservation(input, output);
  const validityCheck = checkMarkdownValidity(output);

  // Calculate overall score (weighted average)
  const weights = {
    headers: 0.3,
    speakers: 0.3,
    timestamps: 0.2,
    validity: 0.2
  };

  const overallScore =
    (headerCheck.score * weights.headers) +
    (speakerCheck.score * weights.speakers) +
    (timestampCheck.score * weights.timestamps) +
    (validityCheck.score * weights.validity);

  return {
    score: overallScore,
    passed: overallScore >= 0.8,
    details: {
      headers: headerCheck,
      speakers: speakerCheck,
      timestamps: timestampCheck,
      validity: validityCheck
    }
  };
}

module.exports = {
  evaluateStructureCompliance,
  checkHeaderStructure,
  checkSpeakerFormatting,
  checkTimestampPreservation,
  checkMarkdownValidity
};
