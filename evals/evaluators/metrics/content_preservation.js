/**
 * Content Preservation Metric
 * Evaluates whether the formatted output preserves all original content
 */

/**
 * Calculate word count
 * @param {string} text - Text to count words in
 * @returns {number} - Word count
 */
function countWords(text) {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Extract content words (excluding formatting markers)
 * @param {string} text - Text to extract from
 * @returns {Array} - Array of words
 */
function extractContentWords(text) {
  // Remove markdown formatting, timestamps, and common labels
  const cleaned = text
    .replace(/\[[\d:]+\]/g, '') // Remove timestamps
    .replace(/\*\*/g, '') // Remove bold markers
    .replace(/^#+\s/gm, '') // Remove headers
    .replace(/Interviewer:|Candidate:|Speaker \d+:/gi, ''); // Remove speaker labels

  return cleaned.toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2)
    .map(word => word.replace(/[^\w]/g, ''));
}

/**
 * Check if all input words appear in output
 * @param {string} input - Original input
 * @param {string} output - Formatted output
 * @returns {Object} - Score and details
 */
function checkWordPreservation(input, output) {
  const inputWords = extractContentWords(input);
  const outputWords = extractContentWords(output);

  const outputWordSet = new Set(outputWords);
  const preservedWords = inputWords.filter(word => outputWordSet.has(word));

  const score = inputWords.length > 0 ? preservedWords.length / inputWords.length : 1.0;

  return {
    input_word_count: inputWords.length,
    output_word_count: outputWords.length,
    preserved_word_count: preservedWords.length,
    preservation_rate: score,
    score: score
  };
}

/**
 * Check for key phrase preservation
 * @param {string} input - Original input
 * @param {string} output - Formatted output
 * @returns {Object} - Score and details
 */
function checkKeyPhrasePreservation(input, output) {
  // Extract potential key phrases (3-4 word sequences)
  const extractPhrases = (text) => {
    const words = text.toLowerCase().split(/\s+/);
    const phrases = [];

    for (let i = 0; i < words.length - 2; i++) {
      phrases.push(words.slice(i, i + 3).join(' '));
    }

    return phrases;
  };

  const inputPhrases = extractPhrases(input);
  const outputPhrases = extractPhrases(output);

  const outputPhraseSet = new Set(outputPhrases);
  const preservedPhrases = inputPhrases.filter(phrase => outputPhraseSet.has(phrase));

  const score = inputPhrases.length > 0 ? preservedPhrases.length / inputPhrases.length : 1.0;

  return {
    input_phrases: inputPhrases.length,
    output_phrases: outputPhrases.length,
    preserved_phrases: preservedPhrases.length,
    preservation_rate: score,
    score: score
  };
}

/**
 * Check for information loss (comparing lengths)
 * @param {string} input - Original input
 * @param {string} output - Formatted output
 * @returns {Object} - Score and details
 */
function checkLengthConsistency(input, output) {
  const inputLength = countWords(input);
  const outputLength = countWords(output);

  // Output should be similar length (allowing for formatting additions)
  // Expected output to be 80-120% of input length
  const ratio = outputLength / inputLength;
  let score = 1.0;

  if (ratio < 0.8) {
    score = ratio / 0.8; // Penalize if too short
  } else if (ratio > 1.3) {
    score = Math.max(0, 1.0 - ((ratio - 1.3) * 0.5)); // Penalize if too long
  }

  return {
    input_words: inputLength,
    output_words: outputLength,
    ratio: ratio,
    score: score,
    assessment: ratio < 0.8 ? 'too_short' : ratio > 1.3 ? 'too_long' : 'appropriate'
  };
}

/**
 * Check for spurious additions (content not in input)
 * @param {string} input - Original input
 * @param {string} output - Formatted output
 * @returns {Object} - Score and details
 */
function checkForAdditions(input, output) {
  const inputWords = new Set(extractContentWords(input));
  const outputWords = extractContentWords(output);

  const additions = outputWords.filter(word => !inputWords.has(word));

  // Some additions are expected (formatting, section labels)
  // Penalize if > 10% of output is new content
  const additionRate = additions.length / outputWords.length;
  const score = additionRate > 0.1 ? Math.max(0, 1.0 - (additionRate - 0.1) * 2) : 1.0;

  return {
    addition_count: additions.length,
    addition_rate: additionRate,
    score: score,
    examples: additions.slice(0, 10)
  };
}

/**
 * Main content preservation evaluator
 * @param {string} input - Original input
 * @param {string} output - Formatted output
 * @returns {Object} - Comprehensive evaluation results
 */
function evaluateContentPreservation(input, output) {
  const wordCheck = checkWordPreservation(input, output);
  const phraseCheck = checkKeyPhrasePreservation(input, output);
  const lengthCheck = checkLengthConsistency(input, output);
  const additionsCheck = checkForAdditions(input, output);

  // Calculate overall score (weighted average)
  const weights = {
    words: 0.3,
    phrases: 0.3,
    length: 0.2,
    additions: 0.2
  };

  const overallScore =
    (wordCheck.score * weights.words) +
    (phraseCheck.score * weights.phrases) +
    (lengthCheck.score * weights.length) +
    (additionsCheck.score * weights.additions);

  return {
    score: overallScore,
    passed: overallScore >= 0.85,
    details: {
      word_preservation: wordCheck,
      phrase_preservation: phraseCheck,
      length_consistency: lengthCheck,
      spurious_additions: additionsCheck
    }
  };
}

module.exports = {
  evaluateContentPreservation,
  checkWordPreservation,
  checkKeyPhrasePreservation,
  checkLengthConsistency,
  checkForAdditions,
  extractContentWords
};
