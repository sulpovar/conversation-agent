/**
 * Main Formatting Evaluator
 * Coordinates all evaluation metrics for formatting quality
 */

const { evaluateStructureCompliance } = require('./metrics/structure_compliance');
const { evaluateContentPreservation } = require('./metrics/content_preservation');
const { evaluateWithLLM } = require('./metrics/llm_judge_evaluator');
const { ChatAnthropic } = require('@langchain/anthropic');
const path = require('path');
const fs = require('fs').promises;

/**
 * Format a transcription using the system
 * @param {string} inputText - Raw transcription text
 * @param {Object} options - Formatting options
 * @returns {string} - Formatted output
 */
async function formatTranscription(inputText, options = {}) {
  const {
    promptName = 'format-single-chunk',
    promptVersion = 'v2',
    model = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022'
  } = options;

  // Load the prompt template
  const PROMPTS_DIR = process.env.PROMPTS_DIR || './prompts';
  const promptFiles = await fs.readdir(PROMPTS_DIR);
  const promptFile = promptFiles.find(f =>
    f.startsWith(`system_${promptName}_${promptVersion}_`) && f.endsWith('.txt')
  );

  if (!promptFile) {
    throw new Error(`Prompt not found: system_${promptName}_${promptVersion}`);
  }

  const promptPath = path.join(PROMPTS_DIR, promptFile);
  const promptTemplate = await fs.readFile(promptPath, 'utf-8');

  // Fill in the template
  const prompt = promptTemplate.replace('{content}', inputText);

  // Call Claude
  const llm = new ChatAnthropic({
    anthropicApiKey: process.env.CLAUDE_API_KEY,
    modelName: model,
    temperature: 0
  });

  const response = await llm.invoke(prompt, {
    maxTokens: parseInt(process.env.MAX_TOKENS_TRANSCRIPTION || '4096')
  });

  return response.content;
}

/**
 * Evaluate a single test case
 * @param {Object} testCase - Test case from dataset
 * @param {Object} options - Evaluation options
 * @returns {Object} - Evaluation results
 */
async function evaluateTestCase(testCase, options = {}) {
  const {
    useLLMJudge = true,
    promptOptions = {}
  } = options;

  console.log(`\n  Evaluating: ${testCase.id}`);
  console.log(`  Description: ${testCase.description}`);

  try {
    // Format the input
    const startTime = Date.now();
    const actualOutput = await formatTranscription(testCase.input, promptOptions);
    const duration = Date.now() - startTime;

    console.log(`  ✓ Formatting completed in ${(duration / 1000).toFixed(2)}s`);

    // Run evaluations
    const structureResult = evaluateStructureCompliance(testCase.input, actualOutput);
    console.log(`  ✓ Structure compliance: ${(structureResult.score * 100).toFixed(1)}%`);

    const contentResult = evaluateContentPreservation(testCase.input, actualOutput);
    console.log(`  ✓ Content preservation: ${(contentResult.score * 100).toFixed(1)}%`);

    let llmResult = null;
    if (useLLMJudge) {
      llmResult = await evaluateWithLLM(testCase.input, actualOutput);
      console.log(`  ✓ LLM judge: ${(llmResult.score * 100).toFixed(1)}%`);
    }

    // Calculate overall score
    const weights = useLLMJudge
      ? { structure: 0.3, content: 0.3, llm: 0.4 }
      : { structure: 0.5, content: 0.5, llm: 0 };

    const overallScore =
      (structureResult.score * weights.structure) +
      (contentResult.score * weights.content) +
      (llmResult ? llmResult.score * weights.llm : 0);

    const passed = overallScore >= 0.75;

    console.log(`  ${passed ? '✅' : '❌'} Overall: ${(overallScore * 100).toFixed(1)}%`);

    return {
      test_id: testCase.id,
      description: testCase.description,
      passed: passed,
      overall_score: overallScore,
      duration_ms: duration,
      metrics: {
        structure_compliance: structureResult,
        content_preservation: contentResult,
        llm_evaluation: llmResult
      },
      input: testCase.input,
      expected_output: testCase.expected_output,
      actual_output: actualOutput,
      metadata: testCase.metadata
    };

  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    return {
      test_id: testCase.id,
      description: testCase.description,
      passed: false,
      overall_score: 0,
      error: error.message,
      error_stack: error.stack
    };
  }
}

/**
 * Run evaluation on a dataset
 * @param {Array} dataset - Array of test cases
 * @param {Object} options - Evaluation options
 * @returns {Object} - Complete evaluation results
 */
async function evaluateDataset(dataset, options = {}) {
  console.log(`\n🧪 Running evaluation on ${dataset.length} test cases...`);
  console.log(`Options:`, JSON.stringify(options, null, 2));

  const startTime = Date.now();
  const results = [];

  for (const testCase of dataset) {
    const result = await evaluateTestCase(testCase, options);
    results.push(result);
  }

  const totalDuration = Date.now() - startTime;

  // Calculate summary statistics
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  const avgScore = results.reduce((sum, r) => sum + (r.overall_score || 0), 0) / results.length;

  const summary = {
    total_tests: results.length,
    passed: passedCount,
    failed: failedCount,
    pass_rate: passedCount / results.length,
    average_score: avgScore,
    total_duration_ms: totalDuration,
    timestamp: new Date().toISOString()
  };

  console.log(`\n📊 Evaluation Summary:`);
  console.log(`   Total tests: ${summary.total_tests}`);
  console.log(`   Passed: ${summary.passed} ✅`);
  console.log(`   Failed: ${summary.failed} ❌`);
  console.log(`   Pass rate: ${(summary.pass_rate * 100).toFixed(1)}%`);
  console.log(`   Average score: ${(summary.average_score * 100).toFixed(1)}%`);
  console.log(`   Duration: ${(totalDuration / 1000).toFixed(2)}s`);

  return {
    summary,
    results,
    options
  };
}

module.exports = {
  formatTranscription,
  evaluateTestCase,
  evaluateDataset
};
