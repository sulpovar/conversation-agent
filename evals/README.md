# Evaluation Framework for Interview Transcription Manager

This evaluation framework helps you measure and improve the quality of your interview transcription formatting system.

## 📚 Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Dataset Structure](#dataset-structure)
- [Metrics Explained](#metrics-explained)
- [Running Evaluations](#running-evaluations)
- [Comparing Prompt Versions](#comparing-prompt-versions)
- [LangSmith Integration](#langsmith-integration)
- [Creating Custom Datasets](#creating-custom-datasets)
- [CI/CD Integration](#cicd-integration)

## Overview

The evaluation system tests your formatting quality across multiple dimensions:

- **Structure Compliance** (30%): Proper markdown headers, speaker formatting, timestamps
- **Content Preservation** (30%): No information loss, word/phrase preservation
- **LLM-as-Judge** (40%): Readability, topic segmentation, professional tone

## Quick Start

### 1. Run Default Evaluations

```bash
# Full evaluation with all metrics
npm run eval

# Quick evaluation (skip LLM judge for speed)
npm run eval:quick
```

### 2. Compare Prompt Versions

```bash
# Compare v1 vs v2
npm run eval:compare v1 v2

# Example output:
# ╔════════════════════════════════════════════════════════╗
# ║            PROMPT VERSION COMPARISON                   ║
# ╚════════════════════════════════════════════════════════╝
#
# 📊 Overall Performance:
#    Baseline (v1):  82.3%
#    Candidate (v2): 87.1%
#    📈 Change: +5.83%
#
# ✅ Pass Rates:
#    Baseline:  80.0%
#    Candidate: 100.0%
#    Delta: +20.0%
```

### 3. Test Specific Configurations

```bash
# Test a new prompt version
npm run eval -- --version v3

# Test multi-chunk formatting
npm run eval -- --prompt format-multi-chunk --version v2

# Use different model
npm run eval -- --model claude-3-opus-20240229
```

## Dataset Structure

The golden dataset is located in `evals/datasets/formatting_golden_set.json`.

### Example Test Case

```json
{
  "id": "test_001_simple_interview",
  "description": "Simple two-speaker interview with clear topics",
  "input": "[00:00] Interviewer: Hello...",
  "expected_output": "## Introduction\n\n**[00:00] Interviewer:** Hello...",
  "metadata": {
    "speakers": 2,
    "duration_minutes": 2,
    "has_timestamps": true,
    "topics": ["Introduction", "Technical Background"]
  }
}
```

## Metrics Explained

### 1. Structure Compliance (30%)

**What it measures:**
- ✅ Proper `##` headers for topic sections
- ✅ Bold speaker labels (`**Interviewer:**`)
- ✅ Timestamp preservation
- ✅ Valid markdown syntax

**Pass criteria:** Score ≥ 80%

**Example:**
```javascript
{
  "score": 0.95,
  "details": {
    "headers": { "header_count": 4, "score": 1.0 },
    "speakers": { "properly_formatted": 10, "score": 1.0 },
    "timestamps": { "all_preserved": true, "score": 1.0 }
  }
}
```

### 2. Content Preservation (30%)

**What it measures:**
- ✅ All original words preserved
- ✅ Key phrases intact
- ✅ Appropriate length (no major additions/deletions)
- ✅ No spurious content added

**Pass criteria:** Score ≥ 85%

**Example:**
```javascript
{
  "score": 0.92,
  "details": {
    "word_preservation": { "preservation_rate": 0.98 },
    "phrase_preservation": { "preservation_rate": 0.95 },
    "length_consistency": { "ratio": 1.05, "assessment": "appropriate" }
  }
}
```

### 3. LLM-as-Judge (40%)

**What it measures:**
- **Readability** (35%): Clear structure, easy to follow
- **Topic Segmentation** (35%): Logical grouping, appropriate headers
- **Professional Tone** (30%): Business-appropriate formatting

**Pass criteria:** Score ≥ 70%

**Example:**
```javascript
{
  "score": 0.85,
  "details": {
    "readability": {
      "raw_score": 8.5,
      "reasoning": "Clear structure with well-organized sections...",
      "strengths": ["Clear headers", "Good spacing"]
    },
    "topic_segmentation": {
      "raw_score": 8.0,
      "well_segmented_topics": ["Introduction", "Technical Skills"]
    }
  }
}
```

## Running Evaluations

### Command-Line Options

```bash
node evals/scripts/run_evals.js [options]

Options:
  --dataset <name>      Dataset file (default: formatting_golden_set.json)
  --prompt <name>       Prompt name (default: format-single-chunk)
  --version <version>   Prompt version (default: v2)
  --model <model>       Claude model to use
  --no-llm-judge        Skip LLM evaluations (faster, cheaper)
  --no-save             Don't save results to file
  --help, -h            Show help message
```

### Examples

```bash
# Test new v3 prompt
npm run eval -- --version v3

# Quick test without LLM judge (saves API costs)
npm run eval:quick

# Test with Opus model
npm run eval -- --model claude-3-opus-20240229

# Test custom dataset
npm run eval -- --dataset my_custom_tests.json
```

### Understanding Results

```
🧪 Running evaluation on 5 test cases...

  Evaluating: test_001_simple_interview
  Description: Simple two-speaker interview with clear topics
  ✓ Formatting completed in 2.34s
  ✓ Structure compliance: 95.0%
  ✓ Content preservation: 92.5%
  ✓ LLM judge: 85.0%
  ✅ Overall: 90.2%

📊 Evaluation Summary:
   Total tests: 5
   Passed: 5 ✅
   Failed: 0 ❌
   Pass rate: 100.0%
   Average score: 88.3%
   Duration: 15.67s

💾 Results saved to: evals/results/eval_format-single-chunk_v2_2025-01-11_14-30-00.json
```

## Comparing Prompt Versions

### Basic Comparison

```bash
npm run eval:compare v1 v2
```

### Advanced Comparison

```bash
# Compare with custom options
node evals/scripts/compare_prompt_versions.js v2 v3 \
  --dataset custom_tests.json \
  --prompt format-multi-chunk \
  --no-llm-judge
```

### Interpretation

The comparison tool shows:

1. **Overall Performance**: Average score across all tests
2. **Pass Rates**: Percentage of tests passing threshold
3. **Test Changes**: How many tests improved/regressed
4. **Top Changes**: Biggest improvements and regressions
5. **Recommendation**: Deploy or keep baseline

**Decision criteria:**
- ✅ Deploy if: +5% improvement AND no critical regressions
- ⚠️ Review if: Mixed results (some improvements, some regressions)
- ❌ Keep baseline if: Overall regression OR critical failures

## LangSmith Integration

Your evaluation runs are automatically logged to LangSmith when `LANGSMITH_TRACING=true` in your `.env`.

### Viewing in LangSmith

1. Open [LangSmith Dashboard](https://smith.langchain.com)
2. Navigate to your project (default: `interview-transcription-manager`)
3. Filter by tags: `evaluation`, `formatting`, `test_case`
4. Compare runs side-by-side

### Benefits

- 📊 Track eval metrics over time
- 🔍 Debug individual test failures
- 📈 Visualize improvement trends
- 👥 Share results with team

## Creating Custom Datasets

### 1. Create a New Dataset File

```json
[
  {
    "id": "custom_test_001",
    "description": "Your test description",
    "input": "Raw transcription text...",
    "expected_output": "Expected formatted output...",
    "metadata": {
      "speakers": 2,
      "has_timestamps": true,
      "topics": ["Topic 1", "Topic 2"]
    }
  }
]
```

### 2. Run with Custom Dataset

```bash
npm run eval -- --dataset my_custom_tests.json
```

### Best Practices

1. **Diversity**: Include various interview styles, lengths, formats
2. **Edge Cases**: Test overlapping speech, unclear audio, multiple speakers
3. **Real Data**: Use actual transcriptions (anonymized)
4. **Golden Outputs**: Have humans verify expected outputs
5. **Metadata**: Track important characteristics for analysis

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Evaluate Formatting Quality

on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'server.js'

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Run evaluations
        env:
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
          LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}
          LANGSMITH_TRACING: true
        run: npm run eval

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: eval-results
          path: evals/results/*.json
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

if git diff --cached --name-only | grep -q "prompts/.*\.txt$"; then
  echo "🧪 Running quick evaluation on prompt changes..."
  npm run eval:quick

  if [ $? -ne 0 ]; then
    echo "❌ Evaluations failed. Commit aborted."
    exit 1
  fi
fi
```

## Troubleshooting

### Common Issues

**Issue**: "CLAUDE_API_KEY not set"
```bash
# Solution: Set in .env file
echo "CLAUDE_API_KEY=your_key_here" >> .env
```

**Issue**: "Prompt not found: system_format-single-chunk_v3"
```bash
# Solution: Check prompt file exists
ls prompts/system_format-single-chunk_v3_*.txt
```

**Issue**: LLM judge evaluations are slow/expensive
```bash
# Solution: Use --no-llm-judge for quick tests
npm run eval:quick
```

## FAQ

**Q: How long do evaluations take?**
A: ~3-5 seconds per test case with LLM judge, ~1-2 seconds without.

**Q: What's a good passing score?**
A: Overall ≥75% is acceptable, ≥85% is good, ≥90% is excellent.

**Q: Should I always use LLM judge?**
A: Use for final validation and comparisons. Skip for rapid iteration.

**Q: How often should I run evals?**
A: Before any prompt changes, and in CI/CD pipelines.

**Q: Can I add more metrics?**
A: Yes! Add new evaluators in `evals/evaluators/metrics/` directory.

## Contributing

To add new evaluation metrics:

1. Create evaluator in `evals/evaluators/metrics/your_metric.js`
2. Export evaluation function with signature: `(input, output) => { score, details }`
3. Import and use in `formatting_evaluator.js`
4. Update this README with metric documentation

## License

Same as parent project (MIT)
