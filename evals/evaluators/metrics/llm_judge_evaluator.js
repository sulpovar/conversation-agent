/**
 * LLM-as-Judge Evaluator
 * Uses Claude to evaluate subjective quality metrics
 */

const { ChatAnthropic } = require('@langchain/anthropic');

/**
 * Create LLM judge instance
 */
function createJudge() {
  return new ChatAnthropic({
    anthropicApiKey: process.env.CLAUDE_API_KEY,
    modelName: process.env.EVAL_JUDGE_MODEL || 'claude-3-5-haiku-20241022',
    temperature: 0
  });
}

/**
 * Evaluate readability
 * @param {string} output - Formatted output to evaluate
 * @returns {Object} - Score and reasoning
 */
async function evaluateReadability(output) {
  const judge = createJudge();

  const prompt = `You are evaluating the readability of a formatted interview transcription.

Output to evaluate:
---
${output}
---

Rate the readability on a scale of 0-10 based on:
- Clear structure and organization
- Easy to follow conversation flow
- Proper spacing and formatting
- Professional appearance

Respond in JSON format:
{
  "score": <number 0-10>,
  "reasoning": "<brief explanation>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"]
}`;

  try {
    const response = await judge.invoke(prompt);
    const result = JSON.parse(response.content);

    return {
      score: result.score / 10, // Normalize to 0-1
      raw_score: result.score,
      reasoning: result.reasoning,
      strengths: result.strengths,
      improvements: result.improvements
    };
  } catch (error) {
    console.error('Error in readability evaluation:', error.message);
    return {
      score: 0,
      error: error.message
    };
  }
}

/**
 * Evaluate topic segmentation quality
 * @param {string} input - Original input
 * @param {string} output - Formatted output with topics
 * @returns {Object} - Score and reasoning
 */
async function evaluateTopicSegmentation(input, output) {
  const judge = createJudge();

  const prompt = `You are evaluating how well an interview transcription is segmented into topics.

Original input:
---
${input}
---

Formatted output with topics:
---
${output}
---

Rate the topic segmentation on a scale of 0-10 based on:
- Logical grouping of related content
- Appropriate topic labels (headers)
- Clear transitions between topics
- Completeness (all content is in a topic)

Respond in JSON format:
{
  "score": <number 0-10>,
  "reasoning": "<brief explanation>",
  "well_segmented_topics": ["<topic 1>", "<topic 2>"],
  "poorly_segmented_topics": ["<topic 1>"],
  "suggestions": ["<suggestion 1>"]
}`;

  try {
    const response = await judge.invoke(prompt);
    const result = JSON.parse(response.content);

    return {
      score: result.score / 10,
      raw_score: result.score,
      reasoning: result.reasoning,
      well_segmented_topics: result.well_segmented_topics,
      poorly_segmented_topics: result.poorly_segmented_topics,
      suggestions: result.suggestions
    };
  } catch (error) {
    console.error('Error in topic segmentation evaluation:', error.message);
    return {
      score: 0,
      error: error.message
    };
  }
}

/**
 * Evaluate professional tone
 * @param {string} output - Formatted output
 * @returns {Object} - Score and reasoning
 */
async function evaluateProfessionalTone(output) {
  const judge = createJudge();

  const prompt = `You are evaluating the professional tone and appropriateness of a formatted interview transcription.

Output to evaluate:
---
${output}
---

Rate the professional tone on a scale of 0-10 based on:
- Appropriate for business/professional review
- Maintains context and meaning
- Respectful formatting of all speakers
- Free of editorialization or bias

Respond in JSON format:
{
  "score": <number 0-10>,
  "reasoning": "<brief explanation>",
  "tone_assessment": "<professional|casual|inappropriate>",
  "concerns": ["<concern 1>"] or []
}`;

  try {
    const response = await judge.invoke(prompt);
    const result = JSON.parse(response.content);

    return {
      score: result.score / 10,
      raw_score: result.score,
      reasoning: result.reasoning,
      tone_assessment: result.tone_assessment,
      concerns: result.concerns
    };
  } catch (error) {
    console.error('Error in professional tone evaluation:', error.message);
    return {
      score: 0,
      error: error.message
    };
  }
}

/**
 * Comprehensive LLM-based evaluation
 * @param {string} input - Original input
 * @param {string} output - Formatted output
 * @returns {Object} - All LLM evaluation results
 */
async function evaluateWithLLM(input, output) {
  console.log('   Running LLM-as-judge evaluations...');

  const [readability, topicSegmentation, professionalTone] = await Promise.all([
    evaluateReadability(output),
    evaluateTopicSegmentation(input, output),
    evaluateProfessionalTone(output)
  ]);

  // Calculate overall LLM score
  const overallScore = (
    (readability.score * 0.35) +
    (topicSegmentation.score * 0.35) +
    (professionalTone.score * 0.30)
  );

  return {
    score: overallScore,
    passed: overallScore >= 0.7,
    details: {
      readability,
      topic_segmentation: topicSegmentation,
      professional_tone: professionalTone
    }
  };
}

module.exports = {
  evaluateWithLLM,
  evaluateReadability,
  evaluateTopicSegmentation,
  evaluateProfessionalTone
};
