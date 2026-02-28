### File: pyproject.toml
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "loglens"
version = "0.1.0"
description = "A CLI tool for analyzing structured JSON log files"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "click>=8.0",
]

[project.scripts]
loglens = "loglens.cli:cli"

[tool.hatch.build.targets.wheel]
packages = ["src/loglens"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

### File: README.md
```markdown
# LogLens

LogLens is a high-performance command-line tool for analyzing structured JSON log files (NDJSON format). It streams multi-GB files with constant memory usage, filters by complex criteria, computes aggregations, and watches files for live updates.

## Installation

```bash
pip install -e .
```

## Usage

### Filter entries
```bash
loglens filter sample.log --level error --since 2025-01-15T00:00:00Z --output table
cat sample.log | loglens filter - --level info --limit 10
```

### Compute statistics
```bash
loglens stats sample.log --level error --output table
```

### Watch live logs
```bash
loglens watch /var/log/app.log --level critical --output table
```

## Log Format

Expected JSON structure per line:
```json
{
  "timestamp": "2025-01-15T08:23:41.012Z",
  "level": "error",
  "message": "Connection refused",
  "service": "auth-api",
  "request_id": "abc-123",
  "duration_ms": 342
}
```
```

### File: src/loglens/__init__.py
```python
"""LogLens - Structured JSON Log Analyzer."""

__version__ = "0.1.0"
```

### File: src/loglens/types.py
```python
"""Shared type definitions for LogLens."""

from typing import Any, Protocol
from datetime import datetime

# Modern Python 3.12+ type aliases
type JSON = dict[str, Any]
type Timestamp = datetime


class LogSource(Protocol):
    """Protocol for log entry sources."""
    def __iter__(self) -> "LogSource": ...
    def __next__(self) -> str: ...
```

### File: src/loglens/parser.py
```python
"""NDJSON parsing and LogEntry representation."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Self, TextIO, Generator

from .types import JSON


@dataclass(slots=True, frozen=True)
class LogEntry:
    """Represents a single structured log entry."""
    timestamp: datetime
    level: str
    message: str
    service: str | None = None
    request_id: str | None = None
    duration_ms: int | None = None
    extra: dict[str, Any] = field(default_factory=dict, repr=False)
    
    def get_field(self, name: str) -> Any:
        """Retrieve field value by name, including extra fields."""
        match name:
            case "timestamp":
                return self.timestamp
            case "level":
                return self.level
            case "message":
                return self.message
            case "service":
                return self.service
            case "request_id":
                return self.request_id
            case "duration_ms":
                return self.duration_ms
            case _:
                return self.extra.get(name)
    
    @classmethod
    def from_json(cls, line: str, line_no: int, source: str) -> Self | None:
        """Parse a JSON line into LogEntry.
        
        Returns None if parsing fails or required fields are missing.
        Warnings are printed to stderr.
        """
        try:
            data: JSON = json.loads(line)
        except json.JSONDecodeError as e:
            print(
                f"Warning: {source}:{line_no}: Malformed JSON: {e}",
                file=sys.stderr
            )
            return None
        
        required = ["timestamp", "level", "message"]
        missing = [f for f in required if f not in data]
        if missing:
            print(
                f"Warning: {source}:{line_no}: Missing required fields: {missing}",
                file=sys.stderr
            )
            return None
        
        # Parse timestamp with timezone handling
        ts_str = data.pop("timestamp")
        try:
            if isinstance(ts_str, str):
                if ts_str.endswith("Z"):
                    ts_str = ts_str[:-1] + "+00:00"
                timestamp = datetime.fromisoformat(ts_str)
                if timestamp.tzinfo is None:
                    timestamp = timestamp.replace(tzinfo=timezone.utc)
            else:
                raise ValueError("Timestamp must be string")
        except (ValueError, TypeError) as e:
            print(
                f"Warning: {source}:{line_no}: Invalid timestamp '{ts_str}': {e}",
                file=sys.stderr
            )
            return None
        
        # Extract standard fields
        level = str(data.pop("level"))
        message = str(data.pop("message"))
        service = data.pop("service", None)
        request_id = data.pop("request_id", None)
        duration_ms = data.pop("duration_ms", None)
        
        if duration_ms is not None:
            try:
                duration_ms = int(duration_ms)
            except (ValueError, TypeError):
                duration_ms = None
        
        # Remaining fields go to extra
        extra = {k: v for k, v in data.items()}
        
        return cls(
            timestamp=timestamp,
            level=level,
            message=message,
            service=service,
            request_id=request_id,
            duration_ms=duration_ms,
            extra=extra
        )


def parse_log_stream(
    stream: TextIO,
    source_name: str = "<stream>"
) -> Generator[LogEntry, None, None]:
    """Stream-parse NDJSON lines into LogEntry objects."""
    for line_no, line in enumerate(stream, start=1):
        line = line.rstrip('\n\r')
        if not line:
            continue
        entry = LogEntry.from_json(line, line_no, source_name)
        if entry is not None:
            yield entry
```

### File: src/loglens/filters.py
```python
"""Filtering logic for log entries."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from .parser import LogEntry

type Predicate = Callable[["LogEntry"], bool]


@dataclass(slots=True, frozen=True)
class FilterConfig:
    """Configuration for filtering log entries."""
    levels: frozenset[str] = field(default_factory=frozenset)
    since: datetime | None = None
    until: datetime | None = None
    field_matches: dict[str, str] = field(default_factory=dict)
    contains: str | None = None
    
    def matches(self, entry: "LogEntry") -> bool:
        """Check if entry satisfies all filter conditions."""
        if self.levels and entry.level not in self.levels:
            return False
        
        if self.since is not None and entry.timestamp < self.since:
            return False
        
        if self.until is not None and entry.timestamp >= self.until:
            return False
        
        for field_name, expected in self.field_matches.items():
            actual = entry.get_field(field_name)
            if actual is None or str(actual) != expected:
                return False
        
        if self.contains is not None:
            if self.contains.lower() not in entry.message.lower():
                return False
        
        return True
    
    def to_predicate(self) -> Predicate:
        """Convert config to callable predicate."""
        return self.matches
```

### File: src/loglens/aggregator.py
```python
"""Statistics aggregation for log entries."""

from __future__ import annotations

import heapq
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Iterable

if TYPE_CHECKING:
    from .parser import LogEntry


@dataclass(slots=True)
class StatsResult:
    """Container for aggregated log statistics."""
    total: int = 0
    level_counts: Counter = field(default_factory=Counter)
    earliest: datetime | None = None
    latest: datetime | None = None
    top_messages: list[tuple[str, int]] = field(default_factory=list)
    slowest_entries: list[tuple[int, LogEntry]] = field(default_factory=list)
    hourly_histogram: dict[str, int] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        """Serialize to dictionary for JSON output."""
        return {
            "total": self.total,
            "level_counts": dict(self.level_counts),
            "earliest": self.earliest.isoformat() if self.earliest else None,
            "latest": self.latest.isoformat() if self.latest else None,
            "top_messages": [
                {"message": msg, "count": cnt} 
                for msg, cnt in self.top_messages
            ],
            "slowest_entries": [
                {
                    "duration_ms": dur,
                    "level": entry.level,
                    "message": entry.message[:100],
                    "timestamp": entry.timestamp.isoformat()
                }
                for dur, entry in self.slowest_entries
            ],
            "hourly_histogram": self.hourly_histogram
        }


def compute_stats(entries: Iterable[LogEntry]) -> StatsResult:
    """Compute statistics over log entry stream.
    
    Uses bounded memory via counters and fixed-size heaps.
    """
    result = StatsResult()
    message_counts: Counter = Counter()
    
    # Min-heap storing (-duration, unique_id, entry) to track top 5 slowest
    slowest_heap: list[tuple[int, int, LogEntry]] = []
    unique_counter = 0
    
    for entry in entries:
        result.total += 1
        result.level_counts[entry.level] += 1
        
        # Time tracking
        if result.earliest is None or entry.timestamp < result.earliest:
            result.earliest = entry.timestamp
        if result.latest is None or entry.timestamp > result.latest:
            result.latest = entry.timestamp
        
        # Message frequency
        message_counts[entry.message] += 1
        
        # Duration tracking (max-heap simulation)
        if entry.duration_ms is not None:
            heap_item = (-entry.duration_ms, unique_counter, entry)
            if len(slowest_heap) < 5:
                heapq.heappush(slowest_heap, heap_item)
            else:
                # Compare negative durations
                if heap_item < slowest_heap[0]:
                    heapq.heapreplace(slowest_heap, heap_item)
            unique_counter += 1
        
        # Hourly bucket
        hour_key = entry.timestamp.strftime("%Y-%m-%d %H:00")
        result.hourly_histogram[hour_key] = result.hourly_histogram.get(hour_key, 0) + 1
    
    # Extract top 10 messages
    result.top_messages = message_counts.most_common(10)
    
    # Extract slowest entries sorted by duration desc
    sorted_slowest = sorted(slowest_heap, key=lambda x: x[0])
    result.slowest_entries = [(-neg_dur, entry) for neg_dur, _, entry in sorted_slowest]
    
    return result
```

### File: src/loglens/formatters.py
```python
"""Output formatting for various target formats."""

import csv
import json
import sys
from typing import TYPE_CHECKING, Iterable, TextIO

if TYPE_CHECKING:
    from .parser import LogEntry
    from .aggregator import StatsResult


def format_json_entries(entries: Iterable[LogEntry], out: TextIO) -> None:
    """Stream entries as newline-delimited JSON."""
    for entry in entries:
        obj = {
            "timestamp": entry.timestamp.isoformat(),
            "level": entry.level,
            "message": entry.message,
        }
        if entry.service:
            obj["service"] = entry.service
        if entry.request_id:
            obj["request_id"] = entry.request_id
        if entry.duration_ms is not None:
            obj["duration_ms"] = entry.duration_ms
        if entry.extra:
            obj.update(entry.extra)
        
        out.write(json.dumps(obj, ensure_ascii=False) + "\n")
        out.flush()


def format_csv_entries(entries: Iterable[LogEntry], out: TextIO) -> None:
    """Stream entries as CSV."""
    writer = csv.writer(out)
    writer.writerow(["timestamp", "level", "message", "service", "request_id", "duration_ms"])
    
    for entry in entries:
        writer.writerow([
            entry.timestamp.isoformat(),
            entry.level,
            entry.message,
            entry.service or "",
            entry.request_id or "",
            entry.duration_ms if entry.duration_ms is not None else ""
        ])


def format_table_entries(entries: Iterable[LogEntry], out: TextIO) -> None:
    """Format entries as aligned text table."""
    headers = ["Timestamp", "Level", "Service", "Message"]
    widths = [26, 10, 15, 40]
    
    header_line = " | ".join(h.ljust(w) for h, w in zip(headers, widths))
    out.write(header_line + "\n")
    out.write("-" * len(header_line) + "\n")
    
    for entry in entries:
        msg = entry.message[:widths[3]-3] + "..." if len(entry.message) > widths[3] else entry.message
        
        line = " | ".join([
            entry.timestamp.isoformat().ljust(widths[0]),
            entry.level.ljust(widths[1]),
            (entry.service or "").ljust(widths[2]),
            msg.ljust(widths[3])
        ])
        out.write(line + "\n")


def format_json_stats(stats: StatsResult, out: TextIO) -> None:
    """Output stats as formatted JSON."""
    json.dump(stats.to_dict(), out, indent=2, ensure_ascii=False)
    out.write("\n")


def format_table_stats(stats: StatsResult, out: TextIO) -> None:
    """Output stats as formatted text tables."""
    out.write("=== Log Statistics ===\n\n")
    out.write(f"Total entries: {stats.total}\n")
    
    if stats.earliest and stats.latest:
        duration = stats.latest - stats.earliest
        out.write(f"Time range: {stats.earliest.isoformat()} to {stats.latest.isoformat()}\n")
        out.write(f"Duration: {duration}\n")
    
    out.write("\n--- Level Distribution ---\n")
    for level in ["debug", "info", "warning", "error", "critical"]:
        count = stats.level_counts.get(level, 0)
        bar = "█" * min(count // max(stats.total // 50, 1), 40)
        out.write(f"  {level:10s}: {count:4d} {bar}\n")
    
    out.write("\n--- Top 10 Messages ---\n")
    for msg, count in stats.top_messages:
        truncated = msg[:60] + "..." if len(msg) > 60 else msg
        out.write(f"  {count:4d}x  {truncated}\n")
    
    if stats.slowest_entries:
        out.write("\n--- 5 Slowest Operations ---\n")
        out.write(f"  {'Duration':>10s} | {'Level':>8s} | Message\n")
        for dur, entry in stats.slowest_entries:
            msg = entry.message[:50] + "..." if len(entry.message) > 50 else entry.message
            out.write(f"  {dur:>10d}ms | {entry.level:>8s} | {msg}\n")
    
    if stats.hourly_histogram:
        out.write("\n--- Hourly Activity ---\n")
        max_count = max(stats.hourly_histogram.values()) if stats.hourly_histogram else 1
        for hour in sorted(stats.hourly_histogram.keys()):
            count = stats.hourly_histogram[hour]
            bar_width = 30
            bar = "█" * int((count / max_count) * bar_width)
            out.write(f"  {hour} | {count:4d} {bar}\n")
```

### File: src/loglens/watcher.py
```python
"""File watching and tailing functionality."""

import time
from pathlib import Path
from typing import Generator


def watch_file_lines(path: Path, poll_interval: float = 0.1) -> Generator[str, None, None]:
    """Yield new lines appended to file, similar to tail -f.
    
    Starts at current end of file and yields lines as they appear.
    Handles log rotation by detecting file truncation.
    """
    with open(path, "r") as f:
        # Seek to end
        f.seek(0, 2)
        last_inode = None
        last_size = 0
        
        try:
            last_inode = path.stat().st_ino
            last_size = path.stat().st_size
        except FileNotFoundError:
            pass
        
        while True:
            line = f.readline()
            if not line:
                # Check for file changes
                try:
                    current_stat = path.stat()
                    if current_stat.st_ino != last_inode:
                        # File rotated
                        f.close()
                        f = open(path, "r")
                        last_inode = current_stat.st_ino
                        last_size = 0
                    elif current_stat.st_size < last_size:
                        # File truncated
                        f.seek(0)
                        last_size = current_stat.st_size
                    else:
                        # No new data, wait
                        time.sleep(poll_interval)
                        last_size = current_stat.st_size
                except FileNotFoundError:
                    # File deleted, wait for recreation
                    time.sleep(poll_interval)
                    continue
            else:
                yield line
```

### File: src/loglens/cli.py
```python
"""Click CLI interface for LogLens."""

from __future__ import annotations

import itertools
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO

import click

from loglens import __version__
from .parser import parse_log_stream, LogEntry
from .filters import FilterConfig
from .aggregator import compute_stats
from .formatters import (
    format_json_entries,
    format_csv_entries,
    format_table_entries,
    format_json_stats,
    format_table_stats,
)
from .watcher import watch_file_lines


def parse_datetime(value: str | None) -> datetime | None:
    """Parse ISO 8601 datetime string to timezone-aware datetime."""
    if value is None:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError as e:
        raise click.BadParameter(f"Invalid datetime: {e}")


def parse_field_filters(values: tuple[str, ...]) -> dict[str, str]:
    """Parse --field key=value arguments."""
    result: dict[str, str] = {}
    for val in values:
        if "=" not in val:
            raise click.BadParameter(f"Field filter must be 'key=value': {val}")
        key, value = val.split("=", 1)
        result[key] = value
    return result


def common_filter_options(f: Any) -> Any:
    """Decorator adding common filter options."""
    f = click.option(
        "--level",
        multiple=True,
        help="Filter by log level (repeatable)",
    )(f)
    f = click.option(
        "--since",
        callback=lambda ctx, param, val: parse_datetime(val),
        help="Include entries >= this ISO 8601 timestamp",
    )(f)
    f = click.option(
        "--until",
        callback=lambda ctx, param, val: parse_datetime(val),
        help="Include entries < this ISO 8601 timestamp",
    )(f)
    f = click.option(
        "--field",
        multiple=True,
        help="Filter by field=value (repeatable)",
    )(f)
    f = click.option(
        "--contains",
        help="Case-insensitive message substring match",
    )(f)
    return f


@click.group()
@click.version_option(version=__version__)
def cli() -> None:
    """LogLens: Stream-process structured JSON logs."""


@cli.command(name="filter")
@click.argument("file", type=click.File("r", encoding="utf-8"))
@common_filter_options
@click.option(
    "--output",
    type=click.Choice(["json", "csv", "table"], case_sensitive=False),
    default="json",
)
@click.option("--limit", type=int, help="Maximum entries to output")
def filter_cmd(
    file: TextIO,
    level: tuple[str, ...],
    since: datetime | None,
    until: datetime | None,
    field: tuple[str, ...],
    contains: str | None,
    output: str,
    limit: int | None,
) -> None:
    """Filter log entries and stream to stdout."""
    config = FilterConfig(
        levels=frozenset(level),
        since=since,
        until=until,
        field_matches=parse_field_filters(field),
        contains=contains,
    )
    
    try:
        source = file.name if hasattr(file, "name") else "<stdin>"
        entries = parse_log_stream(file, source)
        filtered = (e for e in entries if config.matches(e))
        
        if limit:
            filtered = itertools.islice(filtered, limit)
        
        match output.lower():
            case "json":
                format_json_entries(filtered, sys.stdout)
            case "csv":
                format_csv_entries(filtered, sys.stdout)
            case "table":
                format_table_entries(filtered, sys.stdout)
                
    except BrokenPipeError:
        sys.stderr.close()
        sys.exit(0)
    except IOError as e:
        click.echo(f"I/O error: {e}", err=True)
        sys.exit(2)


@cli.command(name="stats")
@click.argument("file", type=click.File("r", encoding="utf-8"))
@common_filter_options
@click.option(
    "--output",
    type=click.Choice(["json", "table"], case_sensitive=False),
    default="json",
)
def stats_cmd(
    file: TextIO,
    level: tuple[str, ...],
    since: datetime | None,
    until: datetime | None,
    field: tuple[str, ...],
    contains: str | None,
    output: str,
) -> None:
    """Compute aggregate statistics."""
    config = FilterConfig(
        levels=frozenset(level),
        since=since,
        until=until,
        field_matches=parse_field_filters(field),
        contains=contains,
    )
    
    try:
        source = file.name if hasattr(file, "name") else "<stdin>"
        entries = parse_log_stream(file, source)
        filtered = (e for e in entries if config.matches(e))
        stats = compute_stats(filtered)
        
        match output.lower():
            case "json":
                format_json_stats(stats, sys.stdout)
            case "table":
                format_table_stats(stats, sys.stdout)
                
    except BrokenPipeError:
        sys.stderr.close()
        sys.exit(0)
    except IOError as e:
        click.echo(f"I/O error: {e}", err=True)
        sys.exit(2)


@cli.command(name="watch")
@click.argument("file_path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@common_filter_options
@click.option(
    "--output",
    type=click.Choice(["json", "table"], case_sensitive=False),
    default="json",
)
def watch_cmd(
    file_path: Path,
    level: tuple[str, ...],
    since: datetime | None,
    until: datetime | None,
    field: tuple[str, ...],
    contains: str | None,
    output: str,
) -> None:
    """Watch file for new entries (tail -f with filters)."""
    config = FilterConfig(
        levels=frozenset(level),
        since=since,
        until=until,
        field_matches=parse_field_filters(field),
        contains=contains,
    )
    
    def parse_lines(line_gen):
        for line_no, line in enumerate(line_gen, 1):
            entry = LogEntry.from_json(line, line_no, str(file_path))
            if entry and config.matches(entry):
                yield entry
    
    try:
        lines = watch_file_lines(file_path)
        entries = parse_lines(lines)
        
        match output.lower():
            case "json":
                format_json_entries(entries, sys.stdout)
            case "table":
                format_table_entries(entries, sys.stdout)
                
    except KeyboardInterrupt:
        sys.exit(0)
    except BrokenPipeError:
        sys.stderr.close()
        sys.exit(0)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(2)
```

### File: sample.log
```json
{"timestamp": "2025-01-15T08:23:41.012Z", "level": "info", "message": "Server started", "service": "api-gateway", "request_id": "req-001"}
{"timestamp": "2025-01-15T08:24:15.123Z", "level": "info", "message": "Request processed", "service": "auth-api", "request_id": "req-002", "duration_ms": 45}
{"timestamp": "2025-01-15T08:25:33.456Z", "level": "warning", "message": "High latency detected", "service": "payment-api", "request_id": "req-003", "duration_ms": 2500}
{"timestamp": "2025-01-15T08:26:10.789Z", "level": "error", "message": "Connection refused", "service": "auth-api", "request_id": "req-004", "duration_ms": 342}
{"timestamp": "2025-01-15T08:26:11.001Z", "level": "error", "message": "Connection refused", "service": "auth-api", "request_id": "req-005", "duration_ms": 310}
{"timestamp": "2025-01-15T08:30:00.000Z", "level": "info", "message": "Health check passed", "service": "api-gateway", "request_id": "req-006", "duration_ms": 12}
{"timestamp": "2025-01-15T08:45:22.111Z", "level": "debug", "message": "Cache miss for user:12345", "service": "user-service", "request_id": "req-007"}
{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "Hourly backup started", "service": "backup-service", "request_id": "req-008"}
{"timestamp": "2025-01-15T09:05:15.222Z", "level": "error", "message": "Database timeout", "service": "payment-api", "request_id": "req-009", "duration_ms": 5000}
{"timestamp": "2025-01-15T09:10:30.333Z", "level": "critical", "message": "Disk space critically low", "service": "monitoring", "request_id": "req-010"}
{"timestamp": "2025-01-15T09:15:45.444Z", "level": "info", "message": "Request processed", "service": "frontend", "request_id": "req-011", "duration_ms": 89}
{"timestamp": "2025-01-15T09:20:12.555Z", "level": "warning", "message": "Deprecation warning: old API version", "service": "api-gateway", "request_id": "req-012"}
{"timestamp": "2025-01-15T09:25:18.666Z", "level": "info", "message": "User login successful", "service": "auth-api", "request_id": "req-013", "duration_ms": 120, "user_id": "user-999"}
{"timestamp": "2025-01-15T09:30:22.777Z", "level": "error", "message": "Invalid token provided", "service": "auth-api", "request_id": "req-014", "duration_ms": 5}
{"timestamp": "2025-01-15T09:45:33.888Z", "level": "debug", "message": "Request processed", "service": "internal-service", "request_id": "req-015", "duration_ms": 3}
{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "Daily report generated", "service": "reporting", "request_id": "req-016", "duration_ms": 15000}
{"timestamp": "2025-01-15T10:15:44.999Z", "level": "warning", "message": "High latency detected", "service": "payment-api", "request_id": "req-017", "duration_ms": 3200}
{"timestamp": "2025-01-15T10:30:55.000Z", "level": "error", "message": "Connection refused", "service": "payment-api", "request_id": "req-018", "duration_ms": 280}
{"timestamp": "2025-01-15T10:45:11.111Z", "level": "critical", "message": "Service restarted due to memory limit", "service": "payment-api", "request_id": "req-019"}
{"timestamp": "2025-01-15T11:00:00.000Z", "level": "info", "message": "Maintenance window started", "service": "ops", "request_id": "req-020"}
{"timestamp": "2025-01-15T11:15:22.222Z", "level": "info", "message": "Maintenance completed", "service": "ops", "request_id": "req-021", "duration_ms": 900000}
{"timestamp": "2025-01-15T11:30:33.333Z", "level": "debug", "message": "Cache warmed", "service": "frontend", "request_id": "req-022"}
{"timestamp": "2025-01-15T11:45:44.444Z", "level": "info", "message": "Request processed", "service": "frontend", "request_id": "req-023", "duration_ms": 67}
{"timestamp": "2025-01-15T12:00:00.000Z", "level": "info", "message": "Server shutting down", "service": "api-gateway", "request_id": "req-024"}
{"timestamp": "2025-01-15T12:01:00.000Z", "level": "error", "message": "Force shutdown initiated", "service": "api-gateway", "request_id": "req-025"}
```

### File: tests/conftest.py
```python
"""Shared test fixtures."""

import json
import pytest
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from loglens.parser import LogEntry


@pytest.fixture
def valid_entry() -> LogEntry:
    return LogEntry(
        timestamp=datetime(2025, 1, 15, 8, 23, 41, 12000, tzinfo=timezone.utc),
        level="error",
        message="Connection refused",
        service="auth-api",
        request_id="abc-123",
        duration_ms=342
    )


@pytest.fixture
def make_entry():
    """Factory for creating LogEntry objects."""
    def _make(**kwargs):
        defaults = {
            "timestamp": datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc),
            "level": "info",
            "message": "Test message",
        }
        defaults.update(kwargs)
        return LogEntry(**defaults)
    return _make


@pytest.fixture
def temp_log_file(tmp_path: Path) -> Path:
    """Create a temporary log file with varied entries."""
    log_file = tmp_path / "test.log"
    lines = [
        '{"timestamp": "2025-01-15T08:00:00Z", "level": "info", "message": "Start", "service": "api"}',
        '{"timestamp": "2025-01-15T08:30:00Z", "level": "error", "message": "Error 1", "service": "auth", "duration_ms": 100}',
        '{"timestamp": "2025-01-15T09:00:00Z", "level": "warning", "message": "Warn 1", "service": "api"}',
        '{"timestamp": "2025-01-15T09:30:00Z", "level": "error", "message": "Error 2", "service": "auth", "duration_ms": 200}',
        '{"timestamp": "2025-01-15T10:00:00Z", "level": "critical", "message": "Critical 1", "service": "api", "duration_ms": 50}',
        '{"timestamp": "2025-01-15T10:30:00Z", "level": "debug", "message": "Debug msg", "service": "auth"}',
        '{"timestamp": "2025-01-15T11:00:00Z", "level": "info", "message": "End", "service": "api"}',
    ]
    log_file.write_text("\n".join(lines))
    return log_file


@pytest.fixture
def malformed_log_file(tmp_path: Path) -> Path:
    """Create a log file with some malformed lines."""
    log_file = tmp_path / "malformed.log"
    lines = [
        '{"timestamp": "2025-01-15T08:00:00Z", "level": "info", "message": "Valid"}',
        "this is not json",
        '{"timestamp": "2025-01-15T09:00:00Z", "level": "error"}',  # missing message
        '{"timestamp": "invalid-date", "level": "info", "message": "Bad date"}',
        '{"timestamp": "2025-01-15T10:00:00Z", "level": "warning", "message": "Valid 2"}',
    ]
    log_file.write_text("\n".join(lines))
    return log_file
```

### File: tests/test_parser.py
```python
"""Tests for NDJSON parsing."""

import json
from datetime import datetime, timezone
from io import StringIO

import pytest

from loglens.parser import LogEntry, parse_log_stream


class TestLogEntry:
    def test_from_json_valid(self):
        line = json.dumps({
            "timestamp": "2025-01-15T08:23:41.012Z",
            "level": "error",
            "message": "Test error",
            "service": "test-svc",
            "duration_ms": 150
        })
        entry = LogEntry.from_json(line, 1, "test")
        assert entry is not None
        assert entry.level == "error"
        assert entry.message == "Test error"
        assert entry.service == "test-svc"
        assert entry.duration_ms == 150
        assert entry.timestamp.year == 2025

    def test_from_json_missing_required(self, capsys):
        line = json.dumps({"timestamp": "2025-01-15T08:00:00Z", "level": "info"})
        entry = LogEntry.from_json(line, 5, "test.log")
        assert entry is None
        captured = capsys.readouterr()
        assert "Missing required fields" in captured.err
        assert "test.log:5" in captured.err

    def test_from_json_malformed_json(self, capsys):
        line = "not valid json {"
        entry = LogEntry.from_json(line, 10, "test.log")
        assert entry is None
        captured = capsys.readouterr()
        assert "Malformed JSON" in captured.err

    def test_from_json_invalid_timestamp(self, capsys):
        line = json.dumps({
            "timestamp": "not-a-date",
            "level": "info",
            "message": "test"
        })
        entry = LogEntry.from_json(line, 3, "test.log")
        assert entry is None
        captured = capsys.readouterr()
        assert "Invalid timestamp" in captured.err

    def test_from_json_extra_fields(self):
        line = json.dumps({
            "timestamp": "2025-01-15T08:00:00+00:00",
            "level": "info",
            "message": "test",
            "custom_field": "custom_value",
            "nested": {"key": "val"}
        })
        entry = LogEntry.from_json(line, 1, "test")
        assert entry.extra.get("custom_field") == "custom_value"
        assert entry.get_field("custom_field") == "custom_value"

    def test_get_field_standard(self, valid_entry: LogEntry):
        assert valid_entry.get_field("level") == "error"
        assert valid_entry.get_field("service") == "auth-api"
        assert valid_entry.get_field("nonexistent") is None

    def test_datetime_with_z_suffix(self):
        line = json.dumps({
            "timestamp": "2025-01-15T08:23:41Z",
            "level": "info",
            "message": "test"
        })
        entry = LogEntry.from_json(line, 1, "test")
        assert entry is not None
        assert entry.timestamp.tzinfo == timezone.utc


class TestParseLogStream:
    def test_parse_stream_valid(self, temp_log_file: Path):
        with open(temp_log_file) as f:
            entries = list(parse_log_stream(f, "test"))
        assert len(entries) == 7
        assert entries[0].level == "info"
        assert entries[-1].message == "End"

    def test_parse_stream_skips_empty_lines(self):
        data = "\n\n{\"timestamp\": \"2025-01-15T08:00:00Z\", \"level\": \"info\", \"message\": \"test\"}\n\n"
        stream = StringIO(data)
        entries = list(parse_log_stream(stream, "test"))
        assert len(entries) == 1

    def test_parse_stream_handles_malformed(self, malformed_log_file: Path, capsys):
        with open(malformed_log_file) as f:
            entries = list(parse_log_stream(f, "malformed.log"))
        # Should have 2 valid entries
        assert len(entries) == 2
        captured = capsys.readouterr()
        assert "malformed" in captured.err.lower() or "Malformed JSON" in captured.err
```

### File: tests/test_filters.py
```python
"""Tests for filtering logic."""

from datetime import datetime, timezone

import pytest

from loglens.filters import FilterConfig
from loglens.parser import LogEntry


class TestFilterConfig:
    def test_empty_config_matches_all(self, make_entry):
        config = FilterConfig()
        entry = make_entry()
        assert config.matches(entry) is True

    def test_filter_by_level(self, make_entry):
        config = FilterConfig(levels=frozenset(["error", "critical"]))
        error_entry = make_entry(level="error")
        info_entry = make_entry(level="info")
        assert config.matches(error_entry) is True
        assert config.matches(info_entry) is False

    def test_filter_by_since(self, make_entry):
        config = FilterConfig(
            since=datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
        )
        early = make_entry(timestamp=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc))
        late = make_entry(timestamp=datetime(2025, 1, 15, 11, 0, 0, tzinfo=timezone.utc))
        assert config.matches(early) is False
        assert config.matches(late) is True

    def test_filter_by_until(self, make_entry):
        config = FilterConfig(
            until=datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
        )
        early = make_entry(timestamp=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc))
        late = make_entry(timestamp=datetime(2025, 1, 15, 11, 0, 0, tzinfo=timezone.utc))
        assert config.matches(early) is True
        assert config.matches(late) is False

    def test_filter_by_time_range(self, make_entry):
        config = FilterConfig(
            since=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc),
            until=datetime(2025, 1, 15, 11, 0, 0, tzinfo=timezone.utc)
        )
        early = make_entry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc))
        middle = make_entry(timestamp=datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc))
        late = make_entry(timestamp=datetime(2025, 1, 15, 12, 0, 0, tzinfo=timezone.utc))
        assert config.matches(early) is False
        assert config.matches(middle) is True
        assert config.matches(late) is False

    def test_filter_by_field_match(self, make_entry):
        config = FilterConfig(field_matches={"service": "auth-api"})
        entry_match = make_entry(service="auth-api")
        entry_no_match = make_entry(service="payment-api")
        assert config.matches(entry_match) is True
        assert config.matches(entry_no_match) is False

    def test_filter_by_field_missing(self, make_entry):
        config = FilterConfig(field_matches={"service": "auth-api"})
        entry_no_service = make_entry(service=None)
        assert config.matches(entry_no_service) is False

    def test_filter_by_contains_case_insensitive(self, make_entry):
        config = FilterConfig(contains="ERROR")
        entry_upper = make_entry(message="An ERROR occurred")
        entry_lower = make_entry(message="an error occurred")
        entry_no_match = make_entry(message="success")
        assert config.matches(entry_upper) is True
        assert config.matches(entry_lower) is True
        assert config.matches(entry_no_match) is False

    def test_combined_filters(self, make_entry):
        config = FilterConfig(
            levels=frozenset(["error"]),
            since=datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc),
            field_matches={"service": "api"}
        )
        match = make_entry(
            level="error",
            timestamp=datetime(2025, 1, 15, 11, 0, 0, tzinfo=timezone.utc),
            service="api"
        )
        wrong_level = make_entry(level="info")
        wrong_time = make_entry(
            level="error",
            timestamp=datetime(2025, 1, 15, 9, 0, 0, tzinfo=timezone.utc)
        )
        wrong_service = make_entry(level="error", service="auth")
        assert config.matches(match) is True
        assert config.matches(wrong_level) is False
        assert config.matches(wrong_time) is False
        assert config.matches(wrong_service) is False
```

### File: tests/test_aggregator.py
```python
"""Tests for statistics aggregation."""

from datetime import datetime, timezone

import pytest

from loglens.aggregator import compute_stats, StatsResult
from loglens.parser import LogEntry


class TestComputeStats:
    def test_empty_stream(self):
        stats = compute_stats([])
        assert stats.total == 0
        assert stats.earliest is None
        assert stats.latest is None

    def test_total_count(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc), level="info", message="m1"),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 1, 0, tzinfo=timezone.utc), level="error", message="m2"),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 2, 0, tzinfo=timezone.utc), level="info", message="m3"),
        ]
        stats = compute_stats(entries)
        assert stats.total == 3

    def test_level_counts(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc), level="info", message="m"),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 1, 0, tzinfo=timezone.utc), level="error", message="m"),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 2, 0, tzinfo=timezone.utc), level="info", message="m"),
        ]
        stats = compute_stats(entries)
        assert stats.level_counts["info"] == 2
        assert stats.level_counts["error"] == 1

    def test_time_range(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc), level="info", message="m"),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc), level="info", message="m"),
            LogEntry(timestamp=datetime(2025, 1, 15, 12, 0, 0, tzinfo=timezone.utc), level="info", message="m"),
        ]
        stats = compute_stats(entries)
        assert stats.earliest == datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc)
        assert stats.latest == datetime(2025, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

    def test_top_messages(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, i, 0, tzinfo=timezone.utc), level="info", message="common")
            for i in range(5)
        ] + [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, i, 0, tzinfo=timezone.utc), level="info", message="rare")
            for i in range(5, 7)
        ]
        stats = compute_stats(entries)
        assert len(stats.top_messages) == 2
        assert stats.top_messages[0] == ("common", 5)
        assert stats.top_messages[1] == ("rare", 2)

    def test_slowest_entries(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, i, 0, tzinfo=timezone.utc), level="info", message=f"m{i}", duration_ms=d)
            for i, d in enumerate([100, 500, 50, 1000, 200, 3000, 150])
        ]
        stats = compute_stats(entries)
        assert len(stats.slowest_entries) == 5
        durations = [d for d, _ in stats.slowest_entries]
        assert durations == [3000, 1000, 500, 200, 150]

    def test_hourly_histogram(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 30, 0, tzinfo=timezone.utc), level="info", message="m"),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 45, 0, tzinfo=timezone.utc), level="info", message="m"),
            LogEntry(timestamp=datetime(2025, 1, 15, 9, 10, 0, tzinfo=timezone.utc), level="info", message="m"),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc), level="info", message="m"),
        ]
        stats = compute_stats(entries)
        assert stats.hourly_histogram["2025-01-15 08:00"] == 3
        assert stats.hourly_histogram["2025-01-15 09:00"] == 1

    def test_handles_null_duration(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc), level="info", message="m1", duration_ms=100),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 1, 0, tzinfo=timezone.utc), level="info", message="m2", duration_ms=None),
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 2, 0, tzinfo=timezone.utc), level="info", message="m3", duration_ms=200),
        ]
        stats = compute_stats(entries)
        assert len(stats.slowest_entries) == 2
        assert stats.slowest_entries[0][0] == 200
```

### File: tests/test_formatters.py
```python
"""Tests for output formatters."""

import json
from datetime import datetime, timezone
from io import StringIO

from loglens.aggregator import StatsResult
from loglens.formatters import (
    format_json_entries,
    format_csv_entries,
    format_table_entries,
    format_json_stats,
    format_table_stats,
)
from loglens.parser import LogEntry


class TestFormatJsonEntries:
    def test_outputs_ndjson(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc), level="info", message="test"),
        ]
        out = StringIO()
        format_json_entries(entries, out)
        lines = out.getvalue().strip().split("\n")
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["level"] == "info"
        assert data["message"] == "test"

    def test_includes_optional_fields(self):
        entries = [
            LogEntry(
                timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc),
                level="error",
                message="msg",
                service="svc",
                request_id="req-123",
                duration_ms=50
            ),
        ]
        out = StringIO()
        format_json_entries(entries, out)
        data = json.loads(out.getvalue())
        assert data["service"] == "svc"
        assert data["request_id"] == "req-123"
        assert data["duration_ms"] == 50


class TestFormatCsvEntries:
    def test_outputs_header_and_rows(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc), level="info", message="test", service="api"),
        ]
        out = StringIO()
        format_csv_entries(entries, out)
        lines = out.getvalue().strip().split("\n")
        assert len(lines) == 2
        assert "timestamp,level,message" in lines[0]
        assert "info,test,api" in lines[1]


class TestFormatTableEntries:
    def test_outputs_table_format(self):
        entries = [
            LogEntry(timestamp=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc), level="info", message="test message", service="api"),
        ]
        out = StringIO()
        format_table_entries(entries, out)
        output = out.getvalue()
        assert "Timestamp" in output
        assert "Level" in output
        assert "info" in output
        assert "test message" in output


class TestFormatJsonStats:
    def test_outputs_valid_json(self):
        stats = StatsResult(
            total=10,
            hourly_histogram={"2025-01-15 08:00": 5}
        )
        out = StringIO()
        format_json_stats(stats, out)
        data = json.loads(out.getvalue())
        assert data["total"] == 10
        assert data["hourly_histogram"]["2025-01-15 08:00"] == 5

    def test_serializes_datetime(self):
        stats = StatsResult(
            earliest=datetime(2025, 1, 15, 8, 0, 0, tzinfo=timezone.utc),
            latest=datetime(2025, 1, 15, 10, 0, 0, tzinfo=timezone.utc)
        )
        out = StringIO()
        format_json_stats(stats, out)
        data = json.loads(out.getvalue())
        assert "2025-01-15T08:00:00" in data["earliest"]


class TestFormatTableStats:
    def test_outputs_text_summary(self):
        stats = StatsResult(
            total=100,
            level_counts={"error": 10, "info": 90}
        )
        out = StringIO()
        format_table_stats(stats, out)
        output = out.getvalue()
        assert "100" in output
        assert "error" in output
        assert "info" in output
```