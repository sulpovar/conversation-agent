# Evaluation Framework - Quick Start Guide

Get started with evaluations in 5 minutes!

## Step 1: Verify Setup

Ensure your `.env` has the required API key:

```bash
# Check if CLAUDE_API_KEY is set
cat .env | grep CLAUDE_API_KEY
```

If not set:

```bash
echo "CLAUDE_API_KEY=your_api_key_here" >> .env
```

## Step 2: Run Your First Evaluation

```bash
# Run full evaluation suite
npm run eval
```

You should see output like:

```
🚀 Interview Transcription Manager - Evaluation Suite

Configuration:
  Dataset: formatting_golden_set.json
  Prompt: system_format-single-chunk_v2
  Model: claude-3-5-haiku-20241022
  LLM Judge: enabled

✓ Loaded dataset: 5 test cases

🧪 Running evaluation on 5 test cases...

  Evaluating: test_001_simple_interview
  ✓ Formatting completed in 2.14s
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
```

## Step 3: Compare Prompt Versions

If you have multiple prompt versions (v1, v2, etc.):

```bash
# Compare v1 vs v2
npm run eval:compare v1 v2
```

This shows which version performs better.

## Step 4: Quick Iteration Mode

When testing changes rapidly:

```bash
# Skip expensive LLM judge evaluations
npm run eval:quick
```

This is 3-5x faster and uses less API credits.

## Step 5: Review Results

Results are saved in `evals/results/`:

```bash
# View latest results
ls -lt evals/results/ | head -n 3

# Pretty-print JSON results
cat evals/results/eval_*.json | jq '.summary'
```

## Common Workflows

### Before Making Prompt Changes

```bash
# 1. Run baseline evaluation
npm run eval -- --version v2 --no-save > baseline.txt

# 2. Make your changes to prompts/system_*_v3_*.txt

# 3. Test new version
npm run eval -- --version v3

# 4. Compare
npm run eval:compare v2 v3
```

### Testing Different Models

```bash
# Test with Haiku (fast, cheap)
npm run eval -- --model claude-3-5-haiku-20241022

# Test with Sonnet (balanced)
npm run eval -- --model claude-3-5-sonnet-20241022

# Test with Opus (highest quality)
npm run eval -- --model claude-3-opus-20240229
```

### Creating a Custom Test

1. Add to `evals/datasets/formatting_golden_set.json`:

```json
{
  "id": "my_custom_test",
  "description": "Test description",
  "input": "Your raw transcription...",
  "expected_output": "Expected formatted result...",
  "metadata": {
    "speakers": 2,
    "has_timestamps": true
  }
}
```

2. Run evaluation:

```bash
npm run eval
```

## Understanding Scores

- **90%+**: Excellent - ready to deploy
- **80-89%**: Good - minor improvements possible
- **70-79%**: Acceptable - review failures
- **<70%**: Needs work - investigate issues

## Next Steps

- Read full documentation: `evals/README.md`
- Add more test cases to improve coverage
- Set up CI/CD integration (see README)
- Enable LangSmith for tracking (set `LANGSMITH_TRACING=true`)

## Troubleshooting

**Evaluation fails with "Prompt not found"**
```bash
# List available prompts
ls prompts/system_*

# Specify exact version
npm run eval -- --version v2
```

**Slow evaluations**
```bash
# Use quick mode (no LLM judge)
npm run eval:quick

# Or reduce dataset size
# Edit: evals/datasets/formatting_golden_set.json
# Keep only first 2-3 test cases for rapid testing
```

**API rate limits**
```bash
# Add delays between tests (if needed)
# Or use smaller dataset during development
```

## Help

```bash
# Show all options
npm run eval -- --help

# Show comparison options
npm run eval:compare -- --help
```

## Tips

1. **Start with quick mode** during development
2. **Run full evaluation** before committing changes
3. **Compare versions** to validate improvements
4. **Save baseline results** for reference
5. **Add edge cases** as you find formatting issues

---

Happy evaluating! 🚀
