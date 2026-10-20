import os
import sys
from pathlib import Path

# Ensure local imports work when running from project root
sys.path.insert(0, str(Path(__file__).parent))
from local_client import call_local_chat

def extract_text_from_file(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(str(file_path))
            pages_text = [page.extract_text() or "" for page in reader.pages]
            return "\n".join(pages_text).strip()
        except ImportError:
            print("[-] 'pypdf' is not installed. Please run: pip install pypdf")
            sys.exit(1)
    else:
        return file_path.read_text(encoding="utf-8").strip()

def convert_cv(cv_file_path: str):
    input_path = Path(cv_file_path)
    if not input_path.exists():
        print(f"[-] File not found: {cv_file_path}")
        return

    print(f"[*] Extracting text from {cv_file_path}...")
    raw_cv_text = extract_text_from_file(input_path)

    if not raw_cv_text:
        print("[-] Error: Extracted CV text is empty. If this is a scanned image PDF, text cannot be parsed directly.")
        return

    system_prompt = (
        "You are a technical document parser. Extract and transform the provided "
        "resume text into structured Markdown with the following sections:\n"
        "- ## Core Competencies\n"
        "- ## Technical Skills\n"
        "- ## Professional Experience\n"
        "- ## Education\n"
        "- ## Personal Projects\n"
        "Keep it strictly factual, maintain chronological order, and omit introductory text."
    )

    print("[*] Parsing CV via KoboldCpp...")
    markdown_profile = call_local_chat(system_prompt, raw_cv_text)

    target_file = Path(".claude/skills/job-application-assistant/01-candidate-profile.md")
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text(markdown_profile, encoding="utf-8")

    print(f"[+] Successfully generated and saved to: {target_file}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python tools/import_cv.py <path_to_cv_file>")
    else:
        convert_cv(sys.argv[1])