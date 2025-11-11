#!/usr/bin/env node

/**
 * Prompt Version Comparison Script
 * Compare performance between two prompt versions
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { evaluateDataset } = require('../evaluators/formatting_evaluator');

async function compareVersions(baseline, candidate, options = {}) {
  const {
    dataset = 'formatting_golden_set.json',
    promptName = 'format-single-chunk',
    useLLMJudge = true
  } = options;

  console.log(`\n🔬 Comparing Prompt Versions:`);
  console.log(`   Baseline: ${baseline}`);
  console.log(`   Candidate: ${candidate}`);
  console.log(`   Dataset: ${dataset}\n`);

  // Load dataset
  const datasetPath = path.join(__dirname, '../datasets', dataset);
  const datasetContent = await fs.readFile(datasetPath, 'utf-8');
  const testCases = JSON.parse(datasetContent);

  // Run baseline evaluation
  console.log(`\n📊 Evaluating baseline (${baseline})...`);
  const baselineResults = await evaluateDataset(testCases, {
    useLLMJudge,
    promptOptions: {
      promptName,
      promptVersion: baseline
    }
  });

  // Run candidate evaluation
  console.log(`\n📊 Evaluating candidate (${candidate})...`);
  const candidateResults = await evaluateDataset(testCases, {
    useLLMJudge,
    promptOptions: {
      promptName,
      promptVersion: candidate
    }
  });

  // Generate comparison report
  const comparison = generateComparison(baselineResults, candidateResults);

  // Print comparison
  printComparison(comparison, baseline, candidate);

  // Save comparison results
  const resultsDir = path.join(__dirname, '../results');
  await fs.mkdir(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `comparison_${baseline}_vs_${candidate}_${timestamp}.json`;
  const resultsPath = path.join(resultsDir, filename);

  await fs.writeFile(
    resultsPath,
    JSON.stringify({
      baseline: baselineResults,
      candidate: candidateResults,
      comparison
    }, null, 2),
    'utf-8'
  );

  console.log(`\n💾 Comparison saved to: ${resultsPath}`);

  return comparison;
}

function generateComparison(baseline, candidate) {
  const baselineScores = baseline.results.map(r => r.overall_score);
  const candidateScores = candidate.results.map(r => r.overall_score);

  const avgBaseline = baseline.summary.average_score;
  const avgCandidate = candidate.summary.average_score;
  const improvement = ((avgCandidate - avgBaseline) / avgBaseline) * 100;

  // Test-by-test comparison
  const testComparisons = baseline.results.map((baseResult, idx) => {
    const candResult = candidate.results[idx];
    return {
      test_id: baseResult.test_id,
      baseline_score: baseResult.overall_score,
      candidate_score: candResult.overall_score,
      delta: candResult.overall_score - baseResult.overall_score,
      improved: candResult.overall_score > baseResult.overall_score,
      regressed: candResult.overall_score < baseResult.overall_score
    };
  });

  const improvements = testComparisons.filter(t => t.improved).length;
  const regressions = testComparisons.filter(t => t.regressed).length;
  const unchanged = testComparisons.length - improvements - regressions;

  return {
    overall: {
      baseline_avg: avgBaseline,
      candidate_avg: avgCandidate,
      improvement_percent: improvement,
      is_better: avgCandidate > avgBaseline
    },
    pass_rates: {
      baseline: baseline.summary.pass_rate,
      candidate: candidate.summary.pass_rate,
      delta: candidate.summary.pass_rate - baseline.summary.pass_rate
    },
    test_changes: {
      improvements,
      regressions,
      unchanged,
      total: testComparisons.length
    },
    test_details: testComparisons
  };
}

function printComparison(comparison, baselineName, candidateName) {
  console.log(`\n\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║            PROMPT VERSION COMPARISON                   ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);

  console.log(`📊 Overall Performance:`);
  console.log(`   Baseline (${baselineName}):  ${(comparison.overall.baseline_avg * 100).toFixed(1)}%`);
  console.log(`   Candidate (${candidateName}): ${(comparison.overall.candidate_avg * 100).toFixed(1)}%`);

  const improvementIcon = comparison.overall.improvement_percent > 0 ? '📈' : '📉';
  const improvementColor = comparison.overall.improvement_percent > 0 ? '+' : '';
  console.log(`   ${improvementIcon} Change: ${improvementColor}${comparison.overall.improvement_percent.toFixed(2)}%\n`);

  console.log(`✅ Pass Rates:`);
  console.log(`   Baseline:  ${(comparison.pass_rates.baseline * 100).toFixed(1)}%`);
  console.log(`   Candidate: ${(comparison.pass_rates.candidate * 100).toFixed(1)}%`);
  console.log(`   Delta: ${comparison.pass_rates.delta > 0 ? '+' : ''}${(comparison.pass_rates.delta * 100).toFixed(1)}%\n`);

  console.log(`📈 Test-by-Test Changes:`);
  console.log(`   Improvements: ${comparison.test_changes.improvements} ✅`);
  console.log(`   Regressions:  ${comparison.test_changes.regressions} ❌`);
  console.log(`   Unchanged:    ${comparison.test_changes.unchanged} ➖\n`);

  // Show biggest improvements and regressions
  const sortedByDelta = [...comparison.test_details].sort((a, b) => b.delta - a.delta);

  console.log(`🎯 Top Improvements:`);
  sortedByDelta.slice(0, 3).forEach((test, idx) => {
    if (test.delta > 0) {
      console.log(`   ${idx + 1}. ${test.test_id}: +${(test.delta * 100).toFixed(1)}%`);
    }
  });

  console.log(`\n⚠️  Top Regressions:`);
  sortedByDelta.slice(-3).reverse().forEach((test, idx) => {
    if (test.delta < 0) {
      console.log(`   ${idx + 1}. ${test.test_id}: ${(test.delta * 100).toFixed(1)}%`);
    }
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Recommendation: ${comparison.overall.is_better ? '✅ DEPLOY CANDIDATE' : '❌ KEEP BASELINE'}`);
  console.log(`${'='.repeat(60)}\n`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Prompt Version Comparison Tool

Usage:
  node compare_prompt_versions.js <baseline> <candidate> [options]

Arguments:
  baseline     Baseline version (e.g., v1, v2)
  candidate    Candidate version to compare (e.g., v3)

Options:
  --dataset <name>      Dataset to use (default: formatting_golden_set.json)
  --prompt <name>       Prompt name (default: format-single-chunk)
  --no-llm-judge        Skip LLM evaluations
  --help, -h            Show this help

Examples:
  # Compare v1 vs v2
  node compare_prompt_versions.js v1 v2

  # Compare with custom dataset
  node compare_prompt_versions.js v2 v3 --dataset custom_tests.json

  # Quick comparison without LLM judge
  node compare_prompt_versions.js v1 v2 --no-llm-judge
    `);
    process.exit(0);
  }

  const baseline = args[0];
  const candidate = args[1];

  const options = {
    dataset: 'formatting_golden_set.json',
    promptName: 'format-single-chunk',
    useLLMJudge: true
  };

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--dataset' && i + 1 < args.length) {
      options.dataset = args[++i];
    } else if (args[i] === '--prompt' && i + 1 < args.length) {
      options.promptName = args[++i];
    } else if (args[i] === '--no-llm-judge') {
      options.useLLMJudge = false;
    }
  }

  try {
    const comparison = await compareVersions(baseline, candidate, options);
    process.exit(comparison.overall.is_better ? 0 : 1);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { compareVersions };
