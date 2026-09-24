---
title: Health Buddy
emoji: 🩺
colorFrom: green
colorTo: gray
sdk: gradio
sdk_version: 4.44.0
app_file: app.py
pinned: false
license: mit
---

# Health Buddy

Simple **Health Claim Fact-Checker** for families.  
Paste a health claim → get a calm, cited verdict (educational use only).

**Live repo:** https://github.com/sk6594246/H_Buddy

## Features
- Gradio UI (free on Hugging Face Spaces)
- RAG over a small curated medical corpus
- Structured verdicts (VERIFIED TRUE → VERIFIED FALSE)
- “Copy for family chat” text
- Powered by free Groq LLM (`llama-3.1-8b-instant`)

## Required secret
In the Space → **Settings** → **Variables and secrets** add:

```
GROQ_API_KEY = your_key_from_console.groq.com
```

Optional:
```
DAILY_LIMIT = 10
```

## Local run
```bash
pip install -r requirements.txt
export GROQ_API_KEY=your_key
python app.py
```

## Disclaimer
Educational use only. Not a substitute for professional medical advice.

## License
MIT
