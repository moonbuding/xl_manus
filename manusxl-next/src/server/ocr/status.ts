import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeOutput(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface OcrStatus {
  engine: "tesseract";
  available: boolean;
  version?: string;
  languages: string[];
  missingLanguages: string[];
  recommendedLanguages: string[];
  installHint: string;
  reason?: string;
}

export async function getOcrStatus(): Promise<OcrStatus> {
  const recommendedLanguages = ["eng", "chi_sim"];
  const installHint = "macOS 可用 Homebrew 安装：brew install tesseract tesseract-lang";

  try {
    const versionResult = (await execFileAsync("tesseract", ["--version"], {
      timeout: 3000,
      maxBuffer: 128 * 1024
    })) as { stdout: string; stderr: string };
    const version = normalizeOutput(versionResult.stdout || versionResult.stderr).split("\n")[0];
    let languages: string[] = [];

    try {
      const languageResult = (await execFileAsync("tesseract", ["--list-langs"], {
        timeout: 3000,
        maxBuffer: 128 * 1024
      })) as { stdout: string; stderr: string };
      languages = normalizeOutput(languageResult.stdout || languageResult.stderr)
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line && !line.toLowerCase().includes("list of available languages"));
    } catch {
      languages = [];
    }

    return {
      engine: "tesseract",
      available: true,
      version: version || "tesseract",
      languages,
      recommendedLanguages,
      missingLanguages: recommendedLanguages.filter((language) => !languages.includes(language)),
      installHint
    };
  } catch (error) {
    return {
      engine: "tesseract",
      available: false,
      languages: [],
      recommendedLanguages,
      missingLanguages: recommendedLanguages,
      installHint,
      reason: error instanceof Error ? error.message : "tesseract command is not available"
    };
  }
}
