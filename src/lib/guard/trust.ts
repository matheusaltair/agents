// Trust: varredura de prompt injection (em entradas não confiáveis, como o texto
// de uma issue) e de vulnerabilidades (no diff produzido pelo desenvolvedor).
// A interface TrustScanner permite trocar a implementação local pelo Switch Trust.

import type { TrustFinding } from "@/lib/db/types";

export interface TrustReport {
  score: number; // 0-100, quanto maior mais confiável
  findings: TrustFinding[];
  blocked: boolean;
}

export interface TrustScanner {
  scanPrompt(text: string, source: string): Promise<TrustReport>;
  scanCode(files: { path: string; content: string }[]): Promise<TrustReport>;
}

interface Rule {
  rule: string;
  severity: TrustFinding["severity"];
  pattern: RegExp;
  message: string;
}

const PROMPT_RULES: Rule[] = [
  {
    rule: "ignore-instructions",
    severity: "high",
    pattern: /\b(ignore|disregard|forget|esque[cç]a|ignore)\b.{0,40}\b(previous|prior|above|all|anteriores|todas)\b.{0,20}\b(instructions?|rules|prompts?|instru[cç][oõ]es|regras)\b/i,
    message: "Tenta anular as instruções do agente",
  },
  {
    rule: "role-override",
    severity: "high",
    pattern: /\b(you are now|from now on you|act as|pretend to be|voc[eê] agora [eé]|a partir de agora voc[eê])\b/i,
    message: "Tenta redefinir o papel do agente",
  },
  {
    rule: "fake-system-tag",
    severity: "high",
    pattern: /<\/?\s*(system|assistant|instructions?)\s*>|\[\s*(system|INST)\s*\]|^\s*system\s*:/im,
    message: "Contém marcações que imitam mensagens de sistema",
  },
  {
    rule: "secret-exfiltration",
    severity: "critical",
    pattern: /\b(print|reveal|send|post|exfiltrate|mostre|envie|revele)\b.{0,60}\b(api[_ -]?key|token|secret|password|senha|credenciais|env(ironment)? var|\.env)\b/i,
    message: "Pede para expor segredos ou credenciais",
  },
  {
    rule: "external-callback",
    severity: "medium",
    pattern: /\b(curl|wget|fetch|webhook)\b.{0,40}https?:\/\//i,
    message: "Pede chamadas para URLs externas",
  },
  {
    rule: "hidden-text",
    severity: "medium",
    pattern: /[​-‏‪-‮⁠-⁤﻿]|<!--[\s\S]*?(ignore|instru|system)[\s\S]*?-->/i,
    message: "Contém texto oculto (caracteres invisíveis ou comentários HTML)",
  },
];

const CODE_RULES: Rule[] = [
  {
    rule: "hardcoded-secret",
    severity: "critical",
    pattern: /(sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{8,}["'])/i,
    message: "Segredo ou credencial no código",
  },
  {
    rule: "dynamic-eval",
    severity: "high",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    message: "Execução dinâmica de código (eval / new Function)",
  },
  {
    rule: "shell-injection",
    severity: "high",
    pattern: /\b(exec|execSync|spawn)\s*\(\s*[`"'][^`"']*\$\{|child_process.*\+\s*req\./,
    message: "Comando de shell montado com entrada externa",
  },
  {
    rule: "sql-concat",
    severity: "high",
    pattern: /\b(select|insert|update|delete)\b[^;\n]{0,80}["'`]\s*\+\s*\w+|\b(query|execute)\s*\(\s*`[^`]*\$\{/i,
    message: "SQL montado por concatenação (risco de SQL injection)",
  },
  {
    rule: "unsafe-html",
    severity: "medium",
    pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=/,
    message: "HTML inserido sem sanitização (risco de XSS)",
  },
  {
    rule: "tls-disabled",
    severity: "high",
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/,
    message: "Verificação TLS desativada",
  },
];

const WEIGHT: Record<TrustFinding["severity"], number> = { low: 5, medium: 15, high: 35, critical: 60 };

function score(findings: TrustFinding[]): number {
  return Math.max(0, 100 - findings.reduce((sum, f) => sum + WEIGHT[f.severity], 0));
}

function apply(rules: Rule[], text: string, location?: string): TrustFinding[] {
  return rules
    .filter((r) => r.pattern.test(text))
    .map((r) => ({ rule: r.rule, severity: r.severity, message: r.message, location }));
}

export class LocalTrustScanner implements TrustScanner {
  /** Abaixo deste score a execução é bloqueada e o cartão vai para revisão humana. */
  constructor(private readonly minScore = 60) {}

  private report(findings: TrustFinding[]): TrustReport {
    const s = score(findings);
    return {
      score: s,
      findings,
      blocked: s < this.minScore || findings.some((f) => f.severity === "critical"),
    };
  }

  async scanPrompt(text: string, source: string): Promise<TrustReport> {
    return this.report(apply(PROMPT_RULES, text, source));
  }

  async scanCode(files: { path: string; content: string }[]): Promise<TrustReport> {
    return this.report(files.flatMap((f) => apply(CODE_RULES, f.content, f.path)));
  }
}

let scanner: TrustScanner = new LocalTrustScanner();

/** Ponto de troca: registre aqui um adaptador do Switch Trust quando houver SDK/credenciais. */
export function setTrustScanner(s: TrustScanner) {
  scanner = s;
}

export function getTrustScanner(): TrustScanner {
  return scanner;
}
