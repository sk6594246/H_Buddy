# Health Buddy (H_Buddy)

Family health-claim fact-checker.

- **Live backend (Gradio):** https://huggingface.co/spaces/sk6594246/Healthbuddy  
- **PWA (GitHub Pages):** enable Pages → Deploy from branch → `/docs`

## Pure PWA

Static files live in `docs/` (and mirrored under `frontend/`).

Default API base in the PWA: `https://sk6594246-healthbuddy.hf.space` (Gradio `/check_claim`).

## Local Gradio

```bash
pip install -r requirements.txt
export GROQ_API_KEY=your_key
python app.py
```

## Disclaimer

Educational use only. Not a substitute for professional medical advice.
