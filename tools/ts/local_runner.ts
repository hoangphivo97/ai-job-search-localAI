import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { callLocalChat } from './loadClient';

interface CandidateInfo {
    name: string;
    email: string;
    phone: string;
    linkedin: string;
}


// Helper để làm sạch markdown block nếu model bọc trong ```markdown ... ```
function cleanMarkdown(text: string): string {
    text = text.replace(/^```[a-zA-Z]*\n/, '');
    text = text.replace(/\n```$/, '');
    return text.trim();
}

function extractCandidateInfo(profileContent: string): CandidateInfo {
    // 1. Trích xuất tên (thường ở dòng Heading 1: `# Tên của bạn`)
    const nameMatch = profileContent.match(/^#\s+(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : "Vo Hoang Phi";

    // 2. Trích xuất Email bằng Regex chuẩn
    const emailMatch = profileContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch ? emailMatch[0] : "your.email@example.com";

    // 3. Trích xuất Số điện thoại
    const phoneMatch = profileContent.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(\d{1,4}\)|\d{1,4})[\s-]?\d{3,4}[\s-]?\d{3,4}/);
    const phone = phoneMatch ? phoneMatch[0].trim() : "+84 900000000";

    // 4. Trích xuất LinkedIn URL
    const linkedinMatch = profileContent.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[^\s)]+/i);
    const linkedin = linkedinMatch ? linkedinMatch[0] : "https://www.linkedin.com/in/yourprofile";

    return { name, email, phone, linkedin };
}

// 1. Lệnh RANK: Đánh giá độ phù hợp giữa Candidate Profile và Job Description
async function cmdRank(jdPath: string, cvPath?: string) {
    const rootDir = path.resolve(__dirname, '../..');
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

async function cmdSetupProfile(cvPath: string) {
    const rootDir = path.resolve(__dirname, '../..');
    const profileFile = path.join(rootDir, '.claude/skills/job-application-assistant/01-candidate-profile.md');
    const targetCvPath = path.resolve(cvPath);

    if (!fs.existsSync(targetCvPath)) {
        console.error(`[-] CV file not found at ${targetCvPath}`);
        return;
    }

    console.log(`[*] Reading CV content from ${targetCvPath}...`);
    // Nếu CV là file text/markdown, đọc trực tiếp. Nếu là PDF, bạn có thể dùng thư viện như pdf-parse.
    const cvContent = fs.readFileSync(targetCvPath, 'utf-8');

    const systemPrompt = (
        "You are an expert data extraction assistant. " +
        "Extract the candidate's personal details (Name, Location, Phone, Email, LinkedIn, GitHub, Skills, Experience) " +
        "from the provided CV and format them strictly to match the structure of the Candidate Profile template."
    );

    const templateContent = fs.readFileSync(profileFile, 'utf-8');
    const userPrompt = `### Template Structure:\n${templateContent}\n\n### Source CV Content:\n${cvContent}`;

    console.log(`[*] Synchronizing and filling 01-candidate-profile.md using Local AI...`);
    let filledProfile = await callLocalChat(systemPrompt, userPrompt);
    filledProfile = cleanMarkdown(filledProfile);

    fs.writeFileSync(profileFile, filledProfile, 'utf-8');
    console.log(`[+] Successfully updated profile at: ${profileFile}`);
}

// 2. Lệnh APPLY: Tạo Cover Letter chuẩn LaTeX và biên dịch ra PDF
async function cmdApply(jdPath: string, company: string, position: string) {
    const rootDir = path.resolve(__dirname, '../..');
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

    // Tự động trích xuất toàn bộ thông tin cá nhân từ file Profile
    const candidateInfo = extractCandidateInfo(profileContent);
    console.log(`[+] Extracted Candidate Info:`, candidateInfo);

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

    // Đọc template gốc
    let templateContent = fs.readFileSync(templateFile, 'utf-8');

    // 1. Thay thế Tên chính xác trong namesection
    let tailoredTex = templateContent.replace(
        /\\namesection\{\}\{\\Huge\{[YOUR NAME]\}\}/g,
        `\\namesection{}{ \\Huge{${candidateInfo.name}} }`
    );

    // 2. Thay thế Email, Phone, và LinkedIn URL chuẩn xác từ Candidate Info
    tailoredTex = tailoredTex.replace(
        /\\href\{mailto:[^}]+\}\{[^}]+\}/g,
        `\\href{mailto:${candidateInfo.email}}{${candidateInfo.email}}`
    );
    tailoredTex = tailoredTex.replace(
        /\|\s*\[\+XX XXXXXXXXXX\]\s*\|/g,
        `| ${candidateInfo.phone} |`
    );
    tailoredTex = tailoredTex.replace(
        /\\urlstyle\{same\}\\\href\{https:\/\/www\.linkedin\.com\/in\/[^}]+\}\{LinkedIn\}/g,
        `\\urlstyle{same}\\href{${candidateInfo.linkedin}}{LinkedIn}`
    );

    // 3. Thay thế khối nội dung mẫu bằng nội dung AI vừa sinh ra
    const pattern = /(\\currentdate\{\\today\}\n)([\s\S]*?)(\\begin\{flushright\})/g;
    tailoredTex = tailoredTex.replace(pattern, `$1\n${newContentBlock}\n\n$3`);

    // 4. Thay thế chữ ký ở cuối thư
    tailoredTex = tailoredTex.replace(
        /\\signature\{[YOUR NAME]\}/g,
        `\\signature{${candidateInfo.name}}`
    );

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
    } else if (subcommand === 'setup') {
        const cvPath = args[1];
        if (!cvPath) {
            console.error("Usage: npx tsx tools/ts/local_runner.ts setup <path_to_cv>");
            process.exit(1);
        }
        await cmdSetupProfile(cvPath);
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