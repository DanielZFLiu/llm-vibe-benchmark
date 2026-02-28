const isTTY = process.stderr.isTTY ?? false;

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

export class ProgressBar {
    private total: number;
    private done = 0;
    private skipped = 0;
    private failed = 0;
    private inflight = 0;
    private startTime: number;
    private lastRender = "";

    constructor(total: number) {
        this.total = total;
        this.startTime = Date.now();
    }

    private get processed(): number {
        return this.done + this.skipped + this.failed;
    }

    /** Log an event line, then redraw the progress bar beneath it. */
    log(message: string): void {
        if (isTTY) {
            this.clear();
        }
        process.stderr.write(message + "\n");
        if (isTTY) {
            this.render();
        }
    }

    /** Mark one item as started (in-flight). */
    start(): void {
        this.inflight++;
        if (isTTY) this.render();
    }

    /** Increment the done counter and redraw. */
    succeed(): void {
        this.done++;
        this.inflight = Math.max(0, this.inflight - 1);
        if (isTTY) this.render();
    }

    /** Increment the skipped counter and redraw. */
    skip(): void {
        this.skipped++;
        this.inflight = Math.max(0, this.inflight - 1);
        if (isTTY) this.render();
    }

    /** Increment the failed counter and redraw. */
    fail(): void {
        this.failed++;
        this.inflight = Math.max(0, this.inflight - 1);
        if (isTTY) this.render();
    }

    /** Clear the progress bar line and print a final summary. */
    finish(): void {
        if (isTTY) this.clear();
    }

    private clear(): void {
        if (this.lastRender) {
            process.stderr.write("\x1b[2K\r");
            this.lastRender = "";
        }
    }

    private render(): void {
        const elapsed = Date.now() - this.startTime;
        const fraction = this.total > 0 ? this.processed / this.total : 1;
        const percent = Math.round(fraction * 100);

        // ETA
        let eta = "";
        if (fraction > 0 && fraction < 1) {
            const remaining = (elapsed / fraction) * (1 - fraction);
            eta = ` | ~${formatDuration(remaining)} remaining`;
        }

        // Bar
        const cols = process.stderr.columns ?? 80;
        const barWidth = Math.max(10, Math.min(30, cols - 60));
        const filled = Math.round(barWidth * fraction);
        const bar = "█".repeat(filled) + "─".repeat(barWidth - filled);

        const status =
            this.inflight > 0
                ? ` | waiting on ${this.inflight} call${this.inflight > 1 ? "s" : ""}`
                : fraction >= 1
                  ? " | done"
                  : "";

        const line = `  [${bar}] ${this.processed}/${this.total} (${percent}%) | ${formatDuration(elapsed)} elapsed${eta}${status}`;

        process.stderr.write("\x1b[2K\r" + line);
        this.lastRender = line;
    }
}
