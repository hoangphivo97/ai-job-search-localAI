import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { callLocalChat } from './loadClient';


// Helper để làm sạch markdown block nếu model bọc trong ```markdown ... ```
function cleanMarkdown(text: string): string {
    text = text.replace(/^```[a-zA-Z]*\n/, '');
    text = text.replace(/\n```$/, '');
    return text.trim();
}

// 1. Lệnh RANK: Đánh giá độ phù hợp giữa Candidate Profile và Job Description
async function cmdRank(jdPath: string, cvPath?: string) {
    const rootDir = path.resolve(__dirname, '..');
    const profileFile = cvPath 
        ? path.resolve(cvPath) 
        : path.join(rootDir, '.claude/skills/job-application-assistant/01-candidate-profile.md');

    if (!fs.existsSync(profileFile)) {
        console.error(`[-] Profile not found at ${profileFile}`);
        return;
    }

    const jdFile = path.resolve(jdPath);
    if (!fs.existsSync(jdFile)) {
        console.error(`[-] Job description file not found at ${jdPath}`);
        return;
    }

    const profileContent = fs.readFileSync(profileFile, 'utf-8');
    const jdContent = fs.readFileSync(jdFile, 'utf-8');

    const systemPrompt = (
        "You are an expert technical recruiter. Analyze the Candidate Profile against " +
        "the Target Job Description. Provide a match score from 0 to 100, list 3 top alignment points, " +
        "and 1-2 missing requirements. Output strictly in structured Markdown."
    );
    const userPrompt = `### Candidate Profile:\n${profileContent}\n\n### Job Description:\n${jdContent}`;

    console.log(`[*] Evaluating match using local LLM for: ${jdPath}...`);
    const result = await callLocalChat(systemPrompt, userPrompt);
    console.log("\n" + "=".repeat(40));
    console.log(result);
    console.log("=".repeat(40));
}

// 2. Lệnh APPLY: Tạo Cover Letter chuẩn LaTeX và biên dịch ra PDF
async function cmdApply(jdPath: string, company: string, position: string) {
    const rootDir = path.resolve(__dirname, '..');
    const profileFile = path.join(rootDir, '.claude/skills/job-application-assistant/01-candidate-profile.md');
    const templateFile = path.join(rootDir, 'cover_letters/cover_example.tex');
    const coverDir = path.join(rootDir, 'cover_letters');

    if (!fs.existsSync(profileFile) || !fs.existsSync(templateFile)) {
        console.error('[-] Profile or template file missing.');
        return;
    }

    const jdFile = path.resolve(jdPath);
    if (!fs.existsSync(jdFile)) {
        console.error(`[-] Job description file not found at ${jdPath}`);
        return;
    }

    const profileContent = fs.readFileSync(profileFile, 'utf-8');
    const jdContent = fs.readFileSync(jdFile, 'utf-8');

    const systemPrompt = (
        "You are an expert career consultant and technical resume writer. " +
        "Write a tailored, professional 3-paragraph Cover Letter body text matching the Candidate Profile " +
        "to the Target Job Description. Focus strictly on relevant technical experience and proven achievements. " +
        "Do NOT output any greetings (like 'Dear...'), sign-offs, dates, or headers. Output ONLY the 3 body paragraphs separated by empty lines."
    );
    const userPrompt = (
        `Company: ${company}\n` +
        `Position: ${position}\n\n` +
        `### Candidate Profile:\n${profileContent}\n\n` +
        `### Job Description:\n${jdContent}`
    );

    console.log(`[*] Generating tailored Cover Letter for ${company} - ${position}...`);
    let rawBody = await callLocalChat(systemPrompt, userPrompt);
    rawBody = cleanMarkdown(rawBody);

    // Tách các đoạn văn và bọc vào macro \lettercontent{} chuẩn của cover.cls
    const paragraphs = rawBody.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const formattedBodyParts: string[] = [`\\lettercontent{Dear Hiring Team at ${company},}`];
    
    for (const p of paragraphs) {
        if (p.toLowerCase().startsWith('dear ')) continue;
        if (['sincerely', 'kind regards', 'best regards'].some(c => p.toLowerCase().startsWith(c))) continue;
        formattedBodyParts.push(`\\lettercontent{${p}}`);
    }
    formattedBodyParts.push(`\\lettercontent{I look forward to hearing from you.}`);

    const newContentBlock = formattedBodyParts.join('\n\n');

    // Chuẩn bị thư mục output
    const cleanCompany = company.toLowerCase().replace(/[^\w\-]/g, '_');
    const outputDir = path.join(rootDir, `documents/applications/${cleanCompany}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputTex = path.join(outputDir, 'cover_letter.tex');

    // Copy OpenFonts và cover.cls sang thư mục build để fontspec nhận diện chính xác
    const openfontsSrc = path.join(coverDir, 'OpenFonts');
    const openfontsDst = path.join(outputDir, 'OpenFonts');
    if (fs.existsSync(openfontsSrc) && !fs.existsSync(openfontsDst)) {
        fs.cpSync(openfontsSrc, openfontsDst, { recursive: true });
    }

    const clsSrc = path.join(coverDir, 'cover.cls');
    const clsDst = path.join(outputDir, 'cover.cls');
    if (fs.existsSync(clsSrc) && !fs.existsSync(clsDst)) {
        fs.copyFileSync(clsSrc, clsDst);
    }

    // Đọc template gốc và thay thế metadata
    let templateContent = fs.readFileSync(templateFile, 'utf-8');
    const candidateName = "Vo Hoang Phi";
    let tailoredTex = templateContent.replace(/[YOUR NAME]/g, candidateName);

    // Thay thế khối nội dung mẫu bằng nội dung AI vừa sinh ra
    const pattern = /(\\currentdate\{\\today\}\n)([\s\S]*?)(\\begin\{flushright\})/g;
    tailoredTex = tailoredTex.replace(pattern, `$1\n${newContentBlock}\n\n$3`);

    fs.writeFileSync(outputTex, tailoredTex, 'utf-8');
    console.log(`[+] Cover letter source written to: ${outputTex}`);

    // Xóa file PDF cũ nếu có để tránh kẹt file lock
    const pdfPath = path.join(outputDir, 'cover_letter.pdf');
    if (fs.existsSync(pdfPath)) {
        try {
            fs.unlinkSync(pdfPath);
        } catch (err) {
            console.error(`[-] Error: cover_letter.pdf is open in another viewer. Please close it.`);
            return;
        }
    }

    // Biên dịch bằng xelatex
    console.log(`[*] Compiling LaTeX to PDF via xelatex...`);
    const delimiter = process.platform === 'win32' ? ';' : ':';
    const existingTexinputs = process.env.TEXINPUTS || '';
    const texEnv = {
        ...process.env,
        TEXINPUTS: `${path.resolve(coverDir)}//${delimiter}${existingTexinputs}`
    };

    try {
        // stdio: 'inherit' giúp log của xelatex in thẳng ra terminal của bạn
        execSync(`xelatex -interaction=nonstopmode cover_letter.tex`, {
            cwd: outputDir,
            env: texEnv,
            stdio: 'inherit'
        });

        if (fs.existsSync(pdfPath)) {
            console.log(`[+] Successfully compiled new PDF: ${pdfPath}`);
        } else {
            console.log(`[-] LaTeX compilation warning: PDF was not generated.`);
        }
    } catch (error) {
        console.error(`[-] LaTeX compilation failed.`);
    }
}

// CLI Argument Parser đơn giản bằng thuần TypeScript
async function main() {
    const args = process.argv.slice(2);
    const subcommand = args[0];

    if (subcommand === 'rank') {
        const jdPath = args[1];
        const cvIndex = args.indexOf('--cv');
        const cvPath = cvIndex !== -1 ? args[cvIndex + 1] : undefined;
        if (!jdPath) {
            console.error("Usage: npx ts-node tools/local_runner.ts rank <jd_path> [--cv <cv_path>]");
            process.exit(1);
        }
        await cmdRank(jdPath, cvPath);
    } else if (subcommand === 'apply') {
        const jdPath = args[1];
        const companyIndex = args.indexOf('--company');
        const positionIndex = args.indexOf('--position');
        
        const company = companyIndex !== -1 ? args[companyIndex + 1] : undefined;
        const position = positionIndex !== -1 ? args[positionIndex + 1] : undefined;

        if (!jdPath || !company || !position) {
            console.error("Usage: npx ts-node tools/local_runner.ts apply <jd_path> --company <name> --position <role>");
            process.exit(1);
        }
        await cmdApply(jdPath, company, position);
    } else {
        console.log("Available subcommands: rank, apply");
        console.log("Example:");
        console.log("  npx ts-node tools/local_runner.ts apply sample_jd.txt --company \"Tech Innovations\" --position \"Senior Frontend Developer\"");
    }
}

main().catch((err) => {
    console.error("[-] Unexpected error:", err);
    process.exit(1);
});