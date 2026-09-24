"""
Health Buddy – Gradio version for free Hugging Face Spaces
Re-uses the same RAG + Groq logic from backend/
"""

import os
import sys
from pathlib import Path

# Make backend importable
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))

import gradio as gr
from rag import rag_engine
from llm import get_verdict

EXAMPLE_CLAIMS = [
    "You need to drink eight glasses of water every day.",
    "Vaccines cause autism.",
    "Vitamin C supplements prevent the common cold.",
    "Cracking your knuckles causes arthritis.",
    "A juice cleanse will detox your liver.",
]

VERDICT_COLORS = {
    "VERIFIED TRUE": "#1f5c45",
    "MOSTLY TRUE": "#1f5c45",
    "UNVERIFIED / MIXED": "#6b5424",
    "MOSTLY FALSE": "#8b3a32",
    "VERIFIED FALSE": "#8b3a32",
}


async def check_claim(claim: str):
    claim = (claim or "").strip()
    if len(claim) < 8:
        return "Please write a longer claim (at least 8 characters).", ""

    retrieved = rag_engine.retrieve(claim)
    chunks = [c for c, src, dist in retrieved]

    result = await get_verdict(claim, chunks)

    verdict = result.get("verdict", "UNVERIFIED / MIXED")
    color = VERDICT_COLORS.get(verdict, "#6b5424")
    conf = round(float(result.get("confidence_score", 0)) * 100)

    summary = result.get("summary", "")
    breakdown = result.get("detailed_breakdown", [])
    if isinstance(breakdown, str):
        breakdown = [b.strip() for b in breakdown.split("\n") if b.strip()]
    sources = result.get("trusted_sources", [])

    bullets = "".join(f"<li>{b}</li>" for b in breakdown)
    source_lines = ""
    for s in sources:
        org = s.get("organization", "")
        topic = s.get("topic_or_guideline", "")
        url = s.get("url", "")
        if url:
            source_lines += f'<li><a href="{url}" target="_blank">{org}</a> – {topic}</li>'
        else:
            source_lines += f"<li>{org} – {topic}</li>"

    html = f"""
    <div style="font-family: system-ui, sans-serif; line-height: 1.5;">
      <div style="display:inline-block; padding:4px 12px; border-radius:999px;
                  background:{color}22; color:{color}; font-weight:600; font-size:0.85rem;
                  letter-spacing:0.05em; text-transform:uppercase; margin-bottom:12px;">
        {verdict}
      </div>
      <h2 style="margin:0 0 8px; font-size:1.4rem;">{summary}</h2>
      <p style="color:#555; margin:0 0 16px;">Confidence: <b>{conf}%</b></p>
      <h3 style="font-size:0.9rem; text-transform:uppercase; letter-spacing:0.08em; color:#888;">Why this verdict</h3>
      <ul style="padding-left:1.2rem;">{bullets}</ul>
      <h3 style="font-size:0.9rem; text-transform:uppercase; letter-spacing:0.08em; color:#888; margin-top:20px;">Trusted sources</h3>
      <ul style="padding-left:1.2rem;">{source_lines}</ul>
      <p style="margin-top:24px; font-size:0.8rem; color:#888; border-top:1px solid #ddd; padding-top:12px;">
        {result.get("disclaimer", "Educational use only. Not medical advice.")}
      </p>
    </div>
    """

    plain = f"""Health Buddy verdict: {verdict}
Claim: “{claim}”

{summary}

Confidence: {conf}%

Why this verdict:
""" + "\n".join(f"• {b}" for b in breakdown)

    if sources:
        plain += "\n\nSources: " + ", ".join(s.get("organization", "") for s in sources)

    plain += "\n\n" + result.get("disclaimer", "Educational use only. Not medical advice.")

    return html, plain


with gr.Blocks(title="Health Buddy") as demo:
    gr.Markdown(
        """
        # 🩺 Health Buddy
        **Family fact-checker** — paste a health claim and get a calm, cited verdict.
        """
    )

    claim_box = gr.Textbox(
        label="Health claim",
        placeholder="Paste a claim — a text from a relative, a post, a headline…",
        lines=4,
        max_lines=8,
    )

    with gr.Row():
        check_btn = gr.Button("Check this claim", variant="primary")
        clear_btn = gr.Button("Clear")

    gr.Examples(
        examples=[[c] for c in EXAMPLE_CLAIMS],
        inputs=claim_box,
        label="Try an example",
    )

    result_html = gr.HTML(label="Verdict")
    result_text = gr.Textbox(
        label="Copy for family chat",
        lines=10,
        interactive=False,
    )

    check_btn.click(
        fn=check_claim,
        inputs=claim_box,
        outputs=[result_html, result_text],
    )
    clear_btn.click(
        fn=lambda: ("", "", ""),
        inputs=None,
        outputs=[claim_box, result_html, result_text],
    )

    gr.Markdown(
        """
        ---
        *Educational use only. Not a diagnosis or substitute for professional medical advice.*  
        Powered by a small curated medical corpus + Groq LLM.
        """
    )

# Hugging Face Spaces will call launch() for us.
# Only launch locally when running this file directly.
if __name__ == "__main__":
    demo.queue().launch()
