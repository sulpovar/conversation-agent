#!/usr/bin/env node

/**
 * Evaluation Runner Script
 * Run evaluations on formatting quality
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { evaluateDataset } = require('../evaluators/formatting_evaluator');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dataset: 'formatting_golden_set.json',
    promptName: 'format-single-chunk',
    promptVersion: 'v2',
    useLLMJudge: true,
    saveResults: true,
    model: process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dataset' && i + 1 < args.length) {
      options.dataset = args[++i];
    } else if (arg === '--prompt' && i + 1 < args.length) {
      options.promptName = args[++i];
    } else if (arg === '--version' && i + 1 < args.length) {
      options.promptVersion = args[++i];
    } else if (arg === '--no-llm-judge') {
      options.useLLMJudge = false;
    } else if (arg === '--no-save') {
      options.saveResults = false;
    } else if (arg === '--model' && i + 1 < args.length) {
      options.model = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Evaluation Runner

Usage:
  node run_evals.js [options]

Options:
  --dataset <name>      Dataset file to use (default: formatting_golden_set.json)
  --prompt <name>       Prompt name to evaluate (default: format-single-chunk)
  --version <version>   Prompt version (default: v2)
  --model <model>       Claude model to use (default: from .env)
  --no-llm-judge        Skip LLM-as-judge evaluations (faster)
  --no-save             Don't save results to file
  --help, -h            Show this help message

Examples:
  # Run with defaults
  node run_evals.js

  # Test a different prompt version
  node run_evals.js --version v3

  # Quick run without LLM judge
  node run_evals.js --no-llm-judge

  # Test multi-chunk formatting
  node run_evals.js --prompt format-multi-chunk
  `);
}

async function main() {
  console.log('🚀 Interview Transcription Manager - Evaluation Suite\n');

  // Check environment
  if (!process.env.CLAUDE_API_KEY) {
    console.error('❌ Error: CLAUDE_API_KEY not set in environment');
    process.exit(1);
  }

  const options = parseArgs();

  console.log('Configuration:');
  console.log(`  Dataset: ${options.dataset}`);
  console.log(`  Prompt: system_${options.promptName}_${options.promptVersion}`);
  console.log(`  Model: ${options.model}`);
  console.log(`  LLM Judge: ${options.useLLMJudge ? 'enabled' : 'disabled'}`);
  console.log(`  Save Results: ${options.saveResults ? 'yes' : 'no'}`);

  // Load dataset
  const datasetPath = path.join(__dirname, '../datasets', options.dataset);
  let dataset;

  try {
    const datasetContent = await fs.readFile(datasetPath, 'utf-8');
    dataset = JSON.parse(datasetContent);
    console.log(`\n✓ Loaded dataset: ${dataset.length} test cases`);
  } catch (error) {
    console.error(`❌ Error loading dataset from ${datasetPath}:`, error.message);
    process.exit(1);
  }

  // Run evaluations
  try {
    const evalResults = await evaluateDataset(dataset, {
      useLLMJudge: options.useLLMJudge,
      promptOptions: {
        promptName: options.promptName,
        promptVersion: options.promptVersion,
        model: options.model
      }
    });

    // Save results if requested
    if (options.saveResults) {
      const resultsDir = path.join(__dirname, '../results');
      await fs.mkdir(resultsDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `eval_${options.promptName}_${options.promptVersion}_${timestamp}.json`;
      const resultsPath = path.join(resultsDir, filename);

      await fs.writeFile(
        resultsPath,
        JSON.stringify(evalResults, null, 2),
        'utf-8'
      );

      console.log(`\n💾 Results saved to: ${resultsPath}`);
    }

    // Exit with appropriate code
    const exitCode = evalResults.summary.pass_rate >= 0.8 ? 0 : 1;
    console.log(`\n${exitCode === 0 ? '✅ All tests passed!' : '⚠️  Some tests failed'}`);
    process.exit(exitCode);

  } catch (error) {
    console.error('\n❌ Evaluation error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
