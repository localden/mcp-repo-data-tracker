/**
 * CLI output utilities with spinners and progress indicators
 */

// ANSI escape codes
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const BLUE = `${ESC}34m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const CYAN = `${ESC}36m`;
const MAGENTA = `${ESC}35m`;
const GRAY = `${ESC}90m`;

// Cursor control
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_LINE = `${ESC}2K`;
const MOVE_UP = `${ESC}1A`;
const MOVE_TO_START = `${ESC}0G`;

// Spinner frames (braille dots)
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Progress bar characters
const PROGRESS_FILLED = '█';
const PROGRESS_EMPTY = '░';

export interface SpinnerOptions {
  text: string;
  color?: string;
}

export class Spinner {
  private frameIndex = 0;
  private interval: NodeJS.Timeout | null = null;
  private text: string;
  private color: string;
  private startTime: number = 0;

  constructor(options: SpinnerOptions) {
    this.text = options.text;
    this.color = options.color || CYAN;
  }

  start(): this {
    this.startTime = Date.now();
    process.stdout.write(HIDE_CURSOR);
    this.render();
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.render();
    }, 80);
    return this;
  }

  private render(): void {
    const frame = SPINNER_FRAMES[this.frameIndex];
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    process.stdout.write(`${MOVE_TO_START}${CLEAR_LINE}${this.color}${frame}${RESET} ${this.text} ${GRAY}${elapsed}s${RESET}`);
  }

  update(text: string): this {
    this.text = text;
    return this;
  }

  succeed(text?: string): void {
    this.stop();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`${MOVE_TO_START}${CLEAR_LINE}${GREEN}✓${RESET} ${text || this.text} ${GRAY}${elapsed}s${RESET}`);
  }

  fail(text?: string): void {
    this.stop();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`${MOVE_TO_START}${CLEAR_LINE}${RED}✗${RESET} ${text || this.text} ${GRAY}${elapsed}s${RESET}`);
  }

  warn(text?: string): void {
    this.stop();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`${MOVE_TO_START}${CLEAR_LINE}${YELLOW}⚠${RESET} ${text || this.text} ${GRAY}${elapsed}s${RESET}`);
  }

  info(text?: string): void {
    this.stop();
    console.log(`${MOVE_TO_START}${CLEAR_LINE}${BLUE}ℹ${RESET} ${text || this.text}`);
  }

  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(SHOW_CURSOR);
  }
}

export function spinner(text: string): Spinner {
  return new Spinner({ text });
}

export function progressBar(current: number, total: number, width: number = 30): string {
  const percent = Math.min(1, current / total);
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = PROGRESS_FILLED.repeat(filled) + PROGRESS_EMPTY.repeat(empty);
  const percentStr = `${Math.round(percent * 100)}%`.padStart(4);
  return `${GRAY}[${RESET}${GREEN}${bar}${RESET}${GRAY}]${RESET} ${percentStr}`;
}

// Styled output helpers
export const style = {
  bold: (text: string) => `${BOLD}${text}${RESET}`,
  dim: (text: string) => `${DIM}${text}${RESET}`,
  italic: (text: string) => `${ITALIC}${text}${RESET}`,
  blue: (text: string) => `${BLUE}${text}${RESET}`,
  green: (text: string) => `${GREEN}${text}${RESET}`,
  yellow: (text: string) => `${YELLOW}${text}${RESET}`,
  red: (text: string) => `${RED}${text}${RESET}`,
  cyan: (text: string) => `${CYAN}${text}${RESET}`,
  magenta: (text: string) => `${MAGENTA}${text}${RESET}`,
  gray: (text: string) => `${GRAY}${text}${RESET}`,
};

export function header(text: string): void {
  console.log();
  console.log(`${BOLD}${CYAN}${text}${RESET}`);
  console.log(`${GRAY}${'─'.repeat(text.length)}${RESET}`);
}

export function subheader(text: string): void {
  console.log();
  console.log(`${BOLD}${text}${RESET}`);
}

export function success(text: string): void {
  console.log(`${GREEN}✓${RESET} ${text}`);
}

export function error(text: string): void {
  console.log(`${RED}✗${RESET} ${text}`);
}

export function warning(text: string): void {
  console.log(`${YELLOW}⚠${RESET} ${text}`);
}

export function info(text: string): void {
  console.log(`${BLUE}ℹ${RESET} ${text}`);
}

export function bullet(text: string, indent: number = 2): void {
  console.log(`${' '.repeat(indent)}${GRAY}•${RESET} ${text}`);
}

export function keyValue(key: string, value: string | number, indent: number = 2): void {
  console.log(`${' '.repeat(indent)}${GRAY}${key}:${RESET} ${BOLD}${value}${RESET}`);
}

export function table(rows: string[][], headers?: string[]): void {
  // Calculate column widths
  const allRows = headers ? [headers, ...rows] : rows;
  const colWidths = allRows[0].map((_, i) =>
    Math.max(...allRows.map(row => (row[i] || '').length))
  );

  // Print header
  if (headers) {
    const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
    console.log(`  ${BOLD}${headerLine}${RESET}`);
    console.log(`  ${GRAY}${colWidths.map(w => '─'.repeat(w)).join('──')}${RESET}`);
  }

  // Print rows
  for (const row of rows) {
    const line = row.map((cell, i) => cell.padEnd(colWidths[i])).join('  ');
    console.log(`  ${line}`);
  }
}

export function box(title: string, content: string[]): void {
  const maxLen = Math.max(title.length, ...content.map(c => c.length));
  const width = maxLen + 4;

  console.log(`${GRAY}┌${'─'.repeat(width)}┐${RESET}`);
  console.log(`${GRAY}│${RESET}  ${BOLD}${title.padEnd(maxLen)}${RESET}  ${GRAY}│${RESET}`);
  console.log(`${GRAY}├${'─'.repeat(width)}┤${RESET}`);
  for (const line of content) {
    console.log(`${GRAY}│${RESET}  ${line.padEnd(maxLen)}  ${GRAY}│${RESET}`);
  }
  console.log(`${GRAY}└${'─'.repeat(width)}┘${RESET}`);
}

export function divider(): void {
  console.log(`${GRAY}${'─'.repeat(50)}${RESET}`);
}

export function newline(): void {
  console.log();
}

// Format numbers nicely
export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

// Format duration
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}
