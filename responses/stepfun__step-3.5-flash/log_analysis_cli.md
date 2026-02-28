### File: pyproject.toml

```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "loglens"
version = "0.1.0"
dependencies = [
    "click>=8.0.0",
]
description = "A command-line tool for analyzing structured JSON log files."
requires-python = ">=3.12"
license = {text = "MIT"}
authors = [{name = "LogLens Team"}]

[project.scripts]
loglens = "loglens.cli:main"

[tool.setuptools]
package-dir = {"" = "src"}
packages = ["loglens"]
```

### File: README.md

```markdown
# LogLens

LogLens is a Python command-line tool for analyzing newline-delimited JSON (NDJSON) log files. It supports filtering, aggregation, and live tailing with a streaming architecture that handles multi-GB files efficiently.

## Installation

```bash
pip install -e .
```

## Usage

### Filter logs

```bash
loglens filter <file> [OPTIONS]
```

### View statistics

```bash
loglens stats <file> [OPTIONS]
```

### Watch logs (tail -f with filters)

```bash
loglens watch <file> [OPTIONS]
```

Run `loglens --help` for more information.
```

### File: src/loglens/__init__.py

```python
__version__ = "0.1.0"
```

### File: src/loglens/types.py

```python
from datetime import datetime
from typing import Literal

#: Valid log levels.
LogLevel = Literal["debug", "info", "warning", "error", "critical"]

#: Timestamp type (timezone-aware datetime).
Timestamp = datetime
```

### File: src/loglens/parser.py

```python
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Generator, TextIO


def parse_iso(ts: str) -> datetime:
    """
    Parse an ISO 8601 timestamp string into a timezone-aware datetime.
    If the string ends with 'Z', it is interpreted as UTC.
    Naive timestamps (without timezone) are assumed to be UTC.
    """
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError as e:
        raise ValueError(f"Invalid ISO 8601 timestamp: {ts}") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@dataclass(slots=True)
class LogEntry:
    """A parsed log entry with typed fields and the original JSON object."""
    timestamp_dt: datetime  # Parsed timestamp as datetime (timezone-aware)
    level: str
    message: str
    fields: dict[str, Any]  # The entire original JSON object


def parse_line(line: str) -> LogEntry | None:
    """Parse a single NDJSON line into a LogEntry. Returns None on failure."""
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    # Check required fields
    if not all(k in obj for k in ("timestamp", "level", "message")):
        return None
    # Parse timestamp
    try:
        ts = parse_iso(obj["timestamp"])
    except ValueError:
        return None
    return LogEntry(
        timestamp_dt=ts,
        level=obj["level"],
        message=obj["message"],
        fields=obj,
    )


def read_logs(source: TextIO) -> Generator[LogEntry, None, None]:
    """
    Stream LogEntry objects from a text source, skipping malformed lines.
    """
    for line_num, line in enumerate(source, start=1):
        line = line.strip()
        if not line:
            continue
        entry = parse_line(line)
        if entry is None:
            print(f"Warning: Skipping malformed or invalid line {line_num}", file=sys.stderr)
            continue
        yield entry


def read_logs_from_file(path: str) -> Generator[LogEntry, None, None]:
    """
    Open a log file (or stdin if path is '-') and stream LogEntry objects.
    Exits with status 2 on file errors.
    """
    if path == "-":
        yield from read_logs(sys.stdin)
    else:
        try:
            with open(path, "r", encoding="utf-8") as f:
                yield from read_logs(f)
        except FileNotFoundError:
            print(f"Error: File not found: {path}", file=sys.stderr)
            sys.exit(2)
        except PermissionError:
            print(f"Error: Permission denied for file: {path}", file=sys.stderr)
            sys.exit(2)
```

### File: src/loglens/filters.py

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Set, Optional

from .parser import LogEntry


@dataclass(slots=True)
class FilterConfig:
    """Configuration for filtering log entries."""
    levels: Set[str] = field(default_factory=set)
    since: Optional[datetime] = None
    until: Optional[datetime] = None
    field_eq: Dict[str, str] = field(default_factory=dict)  # field name -> expected string value
    contains: Optional[str] = None


def matches(entry: LogEntry, config: FilterConfig) -> bool:
    """Check if a log entry satisfies all filter criteria (AND logic)."""
    # Level filter
    if config.levels and entry.level not in config.levels:
        return False
    # Timestamp range filters
    if config.since is not None and entry.timestamp_dt < config.since:
        return False
    if config.until is not None and entry.timestamp_dt >= config.until:
        return False
    # Field equality filters
    for field, expected in config.field_eq.items():
        if field not in entry.fields:
            return False
        if str(entry.fields[field]) != expected:
            return False
    # Message contains filter
    if config.contains is not None:
        if config.contains.lower() not in entry.message.lower():
            return False
    return True
```

### File: src/loglens/aggregator.py

```python
import heapq
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Tuple, Iterable, Optional

from .parser import LogEntry


@dataclass(slots=True)
class StatsResult:
    """Aggregated statistics from a log stream."""
    total: int = 0
    level_counts: Dict[str, int] = field(default_factory=lambda: defaultdict(int))
    earliest: Optional[datetime] = None
    latest: Optional[datetime] = None
    top_messages: List[Tuple[str, int]] = field(default_factory=list)  # (message, count)
    slowest_entries: List[LogEntry] = field(default_factory=list)  # top 5 by duration_ms
    histogram: Dict[str, int] = field(default_factory=dict)  # hour bucket -> count


def compute_stats(entries: Iterable[LogEntry]) -> StatsResult:
    """
    Compute statistics over an iterable of LogEntry objects.
    This function streams and maintains only limited state, so it works with large inputs.
    """
    result = StatsResult()
    # Heap for top 5 slowest entries (min-heap of (duration, entry))
    slowest_heap: List[Tuple[float, LogEntry]] = []
    message_counter = Counter()
    histogram_counter = defaultdict(int)

    for entry in entries:
        result.total += 1
        # Level count
        result.level_counts[entry.level] += 1
        # Earliest / latest
        if result.earliest is None or entry.timestamp_dt < result.earliest:
            result.earliest = entry.timestamp_dt
        if result.latest is None or entry.timestamp_dt > result.latest:
            result.latest = entry.timestamp_dt
        # Message frequency
        message_counter[entry.message] += 1
        # Duration_ms for slowest entries
        if "duration_ms" in entry.fields:
            try:
                dur = float(entry.fields["duration_ms"])
                if len(slowest_heap) < 5:
                    heapq.heappush(slowest_heap, (dur, entry))
                else:
                    if dur > slowest_heap[0][0]:
                        heapq.heapreplace(slowest_heap, (dur, entry))
            except (ValueError, TypeError):
                pass  # ignore non-numeric duration
        # Histogram by hour (bucket start)
        bucket = entry.timestamp_dt.replace(minute=0, second=0, microsecond=0)
        histogram_counter[bucket] += 1

    # Top 10 messages (most common)
    result.top_messages = message_counter.most_common(10)

    # Slowest entries sorted descending by duration
    result.slowest_entries = [entry for (_, entry) in sorted(slowest_heap, key=lambda x: x[0], reverse=True)]

    # Convert histogram bucket datetimes to strings and sort chronologically
    result.histogram = {
        bucket.strftime("%Y-%m-%d %H:%M"): count
        for bucket, count in sorted(histogram_counter.items())
    }

    return result
```

### File: src/loglens/formatters.py

```python
import csv
import io
import json
import sys
from typing import Any, Dict, Generator, List, Iterable

from .parser import LogEntry
from .aggregator import StatsResult


def format_entries(entries: Iterable[LogEntry], output_format: str) -> Generator[str, None, None]:
    """
    Format a stream of LogEntry objects according to the requested output format.
    Yields strings with trailing newlines.
    Supported formats: json, csv, table.
    """
    if output_format == "json":
        for entry in entries:
            yield json.dumps(entry.fields) + "\n"
        return

    if output_format not in ("csv", "table"):
        raise ValueError(f"Unsupported output format: {output_format}")

    # For csv and table we need to determine fieldnames from the first entry.
    it = iter(entries)
    try:
        first = next(it)
    except StopIteration:
        return  # No entries

    # Use sorted keys for deterministic column order.
    fieldnames = sorted(first.fields.keys())

    if output_format == "csv":
        # Use a reusable StringIO buffer to build CSV rows.
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")

        # Write header
        writer.writerow(fieldnames)
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()

        # Helper to write a row and yield its string.
        def write_row(entry: LogEntry):
            row = [str(entry.fields.get(field, "")) for field in fieldnames]
            writer.writerow(row)
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()

        # Process first entry
        yield from write_row(first)

        # Process remaining entries
        for entry in it:
            yield from write_row(entry)

        buffer.close()
    else:  # table
        # Simple pipe-separated table without alignment.
        header = " | ".join(fieldnames) + "\n"
        yield header

        # Row format function
        def format_row(entry: LogEntry) -> str:
            cells = [str(entry.fields.get(field, "")) for field in fieldnames]
            return " | ".join(cells) + "\n"

        yield format_row(first)
        for entry in it:
            yield format_row(entry)


def format_stats_json(result: StatsResult) -> str:
    """Return JSON representation of StatsResult."""
    payload: Dict[str, Any] = {
        "total": result.total,
        "level_counts": dict(result.level_counts),
        "earliest": result.earliest.isoformat() if result.earliest else None,
        "latest": result.latest.isoformat() if result.latest else None,
        "top_messages": [{"message": msg, "count": cnt} for msg, cnt in result.top_messages],
        "slowest_entries": [entry.fields for entry in result.slowest_entries],
        "histogram": result.histogram,
    }
    return json.dumps(payload, indent=2) + "\n"


def format_stats_table(result: StatsResult) -> str:
    """Return a human-readable table representation of StatsResult."""
    lines: List[str] = []

    # Total entries
    lines.append(f"Total entries: {result.total}")
    lines.append("")

    # Level distribution
    lines.append("Level distribution:")
    levels = ["debug", "info", "warning", "error", "critical"]
    rows = [(lvl, result.level_counts.get(lvl, 0)) for lvl in levels]
    col1 = "Level"
    col2 = "Count"
    w1 = max(len(col1), max(len(lvl) for lvl, _ in rows))
    w2 = max(len(col2), max(len(str(cnt)) for _, cnt in rows))
    lines.append(f"{col1:<{w1}}  {col2:>{w2}}")
    for lvl, cnt in rows:
        lines.append(f"{lvl:<{w1}}  {cnt:>{w2}}")
    lines.append("")

    # Timespan
    earliest_str = result.earliest.isoformat() if result.earliest else "N/A"
    latest_str = result.latest.isoformat() if result.latest else "N/A"
    lines.append(f"Earliest: {earliest_str}")
    lines.append(f"Latest: {latest_str}")
    lines.append("")

    # Top 10 messages
    lines.append("Top 10 messages:")
    if not result.top_messages:
        lines.append("(no messages)")
    else:
        hdr1, hdr2 = "Count", "Message"
        rows = [(cnt, msg) for msg, cnt in result.top_messages]
        w1 = max(len(hdr1), max(len(str(cnt)) for cnt, _ in rows))
        w2 = max(len(hdr2), max(len(msg) for _, msg in rows))
        lines.append(f"{hdr1:>{w1}}  {hdr2:{w2}}")
        for cnt, msg in rows:
            lines.append(f"{cnt:>{w1}}  {msg:{w2}}")
    lines.append("")

    # Top 5 slowest entries
    lines.append("Top 5 slowest entries:")
    if not result.slowest_entries:
        lines.append("(no entries with duration_ms)")
    else:
        # Choose columns to display: timestamp, level, message, duration_ms, service, request_id (any present)
        possible_cols = ["timestamp", "level", "message", "duration_ms", "service", "request_id"]
        present = set()
        for entry in result.slowest_entries:
            for col in possible_cols:
                if col in entry.fields:
                    present.add(col)
        cols = [c for c in possible_cols if c in present]
        # Build list of field dicts
        rows = [entry.fields for entry in result.slowest_entries]
        # Compute column widths
        widths = {}
        for col in cols:
            w = len(col)
            for row in rows:
                cell = str(row.get(col, ""))
                if len(cell) > w:
                    w = len(cell)
            widths[col] = w
        # Header
        header_line = "  ".join(col.ljust(widths[col]) for col in cols)
        lines.append(header_line)
        # Rows