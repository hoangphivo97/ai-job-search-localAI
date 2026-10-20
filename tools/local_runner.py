import os
import sys
import argparse
import subprocess
import re
import shutil
from pathlib import Path

# Ensure local imports work regardless of execution directory
sys.path.insert(0, str(Path(__file__).resolve().parent))
from local_client import call_local_chat

def cmd_rank(jd_path: str, cv_path: str = None):
    root_dir = Path(__file__).resolve().parent.parent
    profile_file = Path(cv_path) if cv_path else root_dir / ".claude/skills/job-application-assistant/01-candidate-profile.md"
    
    if not profile_file.exists():
        print(f"[-] Profile not found at {profile_file}")
        return
        
    jd_file = Path(jd_path)
    if not jd_file.exists():
        print(f"[-] Job description file not found at {jd_path}")
        return

    profile_content = profile_file.read_text(encoding="utf-8")
    jd_content = jd_file.read_text(encoding="utf-8")

    system_prompt = (
        "You are an expert technical recruiter. Analyze the Candidate Profile against "
        "the Target Job Description. Provide a match score from 0 to 100, list 3 top alignment points, "
        "and 1-2 missing requirements. Output strictly in structured Markdown."
    )
    user_prompt = f"### Candidate Profile:\n{profile_content}\n\n### Job Description:\n{jd_content}"

    print(f"[*] Evaluating match using local LLM for: {jd_path}...")
    result = call_local_chat(system_prompt, user_prompt)
    print("\n" + "="*40)
    print(result)
    print("="*40)

def cmd_apply(jd_path: str, company: str, position: str):
    root_dir = Path(__file__).resolve().parent.parent
    profile_file = root_dir / ".claude/skills/job-application-assistant/01-candidate-profile.md"
    template_file = root_dir / "cover_letters/cover_example.tex"
    cover_dir = root_dir / "cover_letters"
    
    if not profile_file.exists():
        print(f"[-] Profile not found at {profile_file}")
        return
    if not template_file.exists():
        print(f"[-] Template not found at {template_file}")
        return
    
    jd_file = Path(jd_path)
    if not jd_file.exists():
        print(f"[-] Job description file not found at {jd_path}")
        return

    profile_content = profile_file.read_text(encoding="utf-8")
    jd_content = jd_file.read_text(encoding="utf-8")

    system_prompt = (
        "You are an expert career consultant and technical resume writer. "
        "Write a tailored, professional 3-paragraph Cover Letter body text matching the Candidate Profile "
        "to the Target Job Description. Focus strictly on relevant technical experience and proven achievements. "
        "Do NOT output any greetings (like 'Dear...'), sign-offs, dates, or headers. Output ONLY the 3 body paragraphs separated by empty lines."
    )
    user_prompt = (
        f"Company: {company}\n"
        f"Position: {position}\n\n"
        f"### Candidate Profile:\n{profile_content}\n\n"
        f"### Job Description:\n{jd_content}"
    )

    print(f"[*] Generating tailored Cover Letter for {company} - {position}...")
    raw_body = call_local_chat(system_prompt, user_prompt)

    # 1. Clean markdown formatting
    raw_body = re.sub(r"^```[a-zA-Z]*\n", "", raw_body)
    raw_body = re.sub(r"\n```$", "", raw_body).strip()

    # 2. Escape special LaTeX characters
    raw_body = raw_body.replace(r"\%", "%").replace("%", r"\%")
    raw_body = raw_body.replace(r"\&", "&").replace("&", r"\&")
    raw_body = raw_body.replace(r"\$", "$").replace("$", r"\$")
    raw_body = raw_body.replace(r"\#", "#").replace("#", r"\#")
    raw_body = raw_body.replace(r"\_", "_").replace("_", r"\_")

    # 3. Format paragraphs into \lettercontent{} commands
    paragraphs = [p.strip() for p in raw_body.split("\n\n") if p.strip()]
    formatted_body_parts = [f"\\lettercontent{{Dear Hiring Team at {company},}}"]
    for p in paragraphs:
        # Avoid nesting breaking salutations/closings if model generated them
        if p.lower().startswith("dear "):
            continue
        if any(p.lower().startswith(c) for c in ["sincerely", "kind regards", "best regards"]):
            continue
        formatted_body_parts.append(f"\\lettercontent{{{p}}}")
    formatted_body_parts.append("\\lettercontent{I look forward to hearing from you.}")

    new_content_block = "\n\n".join(formatted_body_parts)

    # Prepare output directory
    clean_company = re.sub(r"[^\w\-]", "_", company.lower())
    output_dir = root_dir / f"documents/applications/{clean_company}"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_tex = output_dir / "cover_letter.tex"

    # Copy OpenFonts to build directory
    openfonts_src = cover_dir / "OpenFonts"
    openfonts_dst = output_dir / "OpenFonts"
    if openfonts_src.exists() and not openfonts_dst.exists():
        shutil.copytree(openfonts_src, openfonts_dst)

    # Copy class file
    cls_src = cover_dir / "cover.cls"
    cls_dst = output_dir / "cover.cls"
    if cls_src.exists() and not cls_dst.exists():
        shutil.copy2(cls_src, cls_dst)

    # Read base template
    template_content = template_file.read_text(encoding="utf-8")

    # Replace Name
    candidate_name = "Vo Hoang Phi"
    tailored_tex = template_content.replace("[YOUR NAME]", candidate_name)

    # Replace the whole boilerplate content block between \currentdate{\today} and \begin{flushright}
    pattern = r"(\\currentdate\{\\today\}\n)(.*?)(\\begin\{flushright\})"
    replacement = r"\1\n" + new_content_block.replace("\\", "\\\\") + r"\n\n\3"
    tailored_tex = re.sub(pattern, replacement, tailored_tex, flags=re.DOTALL)

    output_tex.write_text(tailored_tex, encoding="utf-8")
    print(f"[+] Cover letter source written to: {output_tex}")

    # Remove old PDF if exists
    pdf_path = output_dir / "cover_letter.pdf"
    if pdf_path.exists():
        try:
            pdf_path.unlink()
        except PermissionError:
            print(f"[-] Error: {pdf_path.name} is currently open. Please close it.")
            return

    # Compile via xelatex
    print("[*] Compiling LaTeX to PDF via xelatex...")
    tex_env = os.environ.copy()
    cover_dir_abs = str(cover_dir.resolve())
    delimiter = ";" if os.name == "nt" else ":"
    existing_texinputs = tex_env.get("TEXINPUTS", "")
    tex_env["TEXINPUTS"] = f"{cover_dir_abs}//{delimiter}{existing_texinputs}"

    proc = subprocess.run(
        ["xelatex", "-interaction=nonstopmode", output_tex.name],
        cwd=str(output_dir),
        env=tex_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False
    )

    if pdf_path.exists():
        print(f"[+] Successfully compiled new PDF: {pdf_path}")
    else:
        print("[-] LaTeX compilation failed! Error log snippet:")
        for line in proc.stdout.splitlines()[-25:]:
            print("    " + line)

def main():
    parser = argparse.ArgumentParser(description="Local AI Runner for ai-job-search")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # Rank command
    rank_parser = subparsers.add_parser("rank", help="Evaluate and rank job match")
    rank_parser.add_argument("jd", help="Path to the job description file")
    rank_parser.add_argument("--cv", help="Optional path to custom CV file", default=None)

    # Apply command
    apply_parser = subparsers.add_parser("apply", help="Tailor application documents and compile")
    apply_parser.add_argument("jd", help="Path to the job description file")
    apply_parser.add_argument("--company", required=True, help="Target company name")
    apply_parser.add_argument("--position", required=True, help="Target role title")

    args = parser.parse_args()

    if args.subcommand == "rank":
        cmd_rank(args.jd, args.cv)
    elif args.subcommand == "apply":
        cmd_apply(args.jd, args.company, args.position)

if __name__ == "__main__":
    main()