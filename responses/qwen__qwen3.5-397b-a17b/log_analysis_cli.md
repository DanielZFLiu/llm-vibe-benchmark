### File: pyproject.toml
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "loglens"
version = "1.0.0"
description = "A CLI tool for analyzing structured JSON log files"
readme = "README.md"
requires-python = ">=3.12"
license = {text = "MIT"}
authors = [
    {name = "LogLens Team", email = "loglens@example.com"}
]
keywords = ["logs", "json", "cli", "analysis", "streaming"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Environment :: Console",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Operating System :: OS Independent",
    "Programming Language :: Python :: 3.12",
    "Topic :: Utilities",
]
dependencies = [
    "click>=8.0",
    "rich>=13.0",
]

[project.optional-dependencies]
test = [
    "pytest>=7.0",
    "pytest-cov>=2.0",
]

[project.scripts]
loglens = "loglens.cli:main"

[tool.hatch.build.targets.wheel]
packages = ["src/loglens"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-v --tb=short"
```

### File: README.md
```markdown
# LogLens

A Python command-line tool for analyzing structured JSON log files.

## Features

- **Streaming Architecture**: Processes multi-GB log files efficiently without loading entire files into memory
- **Flexible Filtering**: Filter by log level, timestamp range, field values, and message content
- **Multiple Output Formats**: JSON, CSV, and formatted tables
- **Statistics Aggregation**: Compute counts, histograms, and top values
- **Live Watching**: Tail log files in real-time with filtering

## Installation

```bash
pip install -e .
```

## Usage

### Filter Logs

```bash
loglens filter sample.log --level error --level critical --output table
loglens filter sample.log --since 2025-01-15T00:00:00Z --field service=auth-api
loglens filter - --contains "connection" --output json
```

### Compute Statistics

```bash
loglens stats sample.log --output table
loglens stats sample.log --level error --output json
```

### Watch Live Logs

```bash
loglens watch sample.log --level error --output table
```

## Log Format

Each line must be a JSON object with at least:
- `timestamp`: ISO 8601 string
- `level`: debug, info, warning, error, or critical
- `message`: free-text string

Additional fields are queryable via `--field`.

## Exit Codes

- 0: Success
- 1: User error (invalid arguments, file not found)
- 2: Runtime error (processing failure)
```

### File: src/loglens/__init__.py
```python
"""LogLens - A CLI tool for analyzing structured JSON log files."""

from loglens.parser import LogEntry
from loglens.filters import FilterConfig
from loglens.aggregator import StatsResult

__version__ = "1.0.0"
__all__ = ["LogEntry", "FilterConfig", "StatsResult"]
```

### File: src/loglens/types.py
```python
"""Shared type definitions for LogLens."""

from datetime import datetime
from typing import Protocol, TypeVar, Any

T = TypeVar("T")

class LogEntryProtocol(Protocol):
    """Protocol for log entry objects."""
    timestamp: datetime
    level: str
    message: str
    service: str | None
    request_id: str | None
    duration_ms: int | None
    raw_data: dict[str, Any]

FilterPredicate = callable[[LogEntryProtocol], bool]

OutputFormat = str  # "json", "csv", "table"

LogLevel = str  # "debug", "info", "warning", "error", "critical"

class StatsSummary(Protocol):
    """Protocol for statistics summary."""
    total_entries: int
    level_counts: dict[LogLevel, int]
    earliest_timestamp: datetime | None
    latest_timestamp: datetime | None
    top_messages: list[tuple[str, int]]
    top_slowest: list[tuple[dict[str, Any], int]]
    hourly_histogram: dict[str, int]
```

### File: src/loglens/parser.py
```python
"""NDJSON line parsing and LogEntry dataclass."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Generator, Iterator
import json
import sys

@dataclass(slots=True)
class LogEntry:
    """Represents a parsed log entry."""
    timestamp: datetime
    level: str
    message: str
    service: str | None = None
    request_id: str | None = None
    duration_ms: int | None = None
    raw_data: dict[str, Any] = field(default_factory=dict)
    line_number: int = 0
    
    @classmethod
    def from_dict(cls, data: dict[str, Any], line_number: int) -> LogEntry | None:
        """Create a LogEntry from a dictionary, validating required fields."""
        required_fields = ["timestamp", "level", "message"]
        
        for field_name in required_fields:
            if field_name not in data:
                return None
        
        try:
            timestamp_str = data["timestamp"]
            timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
        
        level = data["level"].lower()
        if level not in {"debug", "info", "warning", "error", "critical"}:
            return None
        
        return cls(
            timestamp=timestamp,
            level=level,
            message=data["message"],
            service=data.get("service"),
            request_id=data.get("request_id"),
            duration_ms=data.get("duration_ms") if isinstance(data.get("duration_ms"), int) else None,
            raw_data=data,
            line_number=line_number
        )

def parse_line(line: str, line_number: int) -> LogEntry | None:
    """Parse a single log line, returning None if malformed."""
    try:
        data = json.loads(line.strip())
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Warning: Malformed JSON at line {line_number}: {e}\n")
        return None
    
    entry = LogEntry.from_dict(data, line_number)
    if entry is None:
        sys.stderr.write(f"Warning: Missing required fields at line {line_number}\n")
        return None
    
    return entry

def read_log_file(path: str) -> Generator[str, None, None]:
    """Stream lines from a log file."""
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            yield line

def read_stdin() -> Generator[str, None, None]:
    """Stream lines from stdin."""
    for line in sys.stdin:
        yield line

def parse_log_stream(lines: Iterator[str]) -> Generator[LogEntry, None, None]:
    """Parse a stream of log lines into LogEntry objects."""
    for line_number, line in enumerate(lines, start=1):
        entry = parse_line(line, line_number)
        if entry is not None:
            yield entry
```

### File: src/loglens/filters.py
```python
"""Filter predicates and FilterConfig for log entries."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Generator, Iterator
import re

from loglens.parser import LogEntry
from loglens.types import FilterPredicate

@dataclass(slots=True)
class FilterConfig:
    """Configuration for filtering log entries."""
    levels: list[str] = field(default_factory=list)
    since: datetime | None = None
    until: datetime | None = None
    fields: dict[str, str] = field(default_factory=dict)
    contains: str | None = None
    
    def create_predicate(self) -> FilterPredicate:
        """Create a filter predicate function based on configuration."""
        predicates: list[Callable[[LogEntry], bool]] = []
        
        if self.levels:
            def level_filter(entry: LogEntry) -> bool:
                return entry.level in self.levels
            predicates.append(level_filter)
        
        if self.since:
            def since_filter(entry: LogEntry) -> bool:
                return entry.timestamp >= self.since
            predicates.append(since_filter)
        
        if self.until:
            def until_filter(entry: LogEntry) -> bool:
                return entry.timestamp < self.until
            predicates.append(until_filter)
        
        if self.fields:
            def field_filter(entry: LogEntry) -> bool:
                for field_name, expected_value in self.fields.items():
                    actual_value = entry.raw_data.get(field_name)
                    if actual_value is None or str(actual_value) != expected_value:
                        return False
                return True
            predicates.append(field_filter)
        
        if self.contains:
            pattern = re.compile(re.escape(self.contains), re.IGNORECASE)
            def contains_filter(entry: LogEntry) -> bool:
                return pattern.search(entry.message) is not None
            predicates.append(contains_filter)
        
        def combined_filter(entry: LogEntry) -> bool:
            return all(pred(entry) for pred in predicates)
        
        return combined_filter

def apply_filter(entries: Iterator[LogEntry], predicate: FilterPredicate) -> Generator[LogEntry, None, None]:
    """Filter entries using a predicate."""
    for entry in entries:
        if predicate(entry):
            yield entry

def limit_entries(entries: Iterator[LogEntry], limit: int | None) -> Generator[LogEntry, None, None]:
    """Limit the number of entries yielded."""
    if limit is None:
        yield from entries
        return
    
    count = 0
    for entry in entries:
        if count >= limit:
            break
        yield entry
        count += 1
```

### File: src/loglens/aggregator.py
```python
"""Statistics aggregation for log entries."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Counter, Generator, Iterator
from collections import Counter

from loglens.parser import LogEntry
from loglens.types import LogLevel

@dataclass(slots=True)
class StatsResult:
    """Result of statistics aggregation."""
    total_entries: int = 0
    level_counts: dict[LogLevel, int] = field(default_factory=dict)
    earliest_timestamp: datetime | None = None
    latest_timestamp: datetime | None = None
    message_counts: Counter = field(default_factory=Counter)
    slowest_entries: list[tuple[dict[str, Any], int]] = field(default_factory=list)
    hourly_histogram: dict[str, int] = field(default_factory=dict)
    
    def to_dict(self) -> dict[str, Any]:
        """Convert stats result to dictionary."""
        return {
            "total_entries": self.total_entries,
            "level_counts": dict(self.level_counts),
            "earliest_timestamp": self.earliest_timestamp.isoformat() if self.earliest_timestamp else None,
            "latest_timestamp": self.latest_timestamp.isoformat() if self.latest_timestamp else None,
            "top_messages": self.message_counts.most_common(10),
            "top_slowest": self.slowest_entries[:5],
            "hourly_histogram": self.hourly_histogram
        }

def aggregate_stats(entries: Iterator[LogEntry]) -> StatsResult:
    """Compute statistics over log entries."""
    result = StatsResult()
    
    level_counter: Counter = Counter()
    message_counter: Counter = Counter()
    duration_entries: list[tuple[LogEntry, int]] = []
    hour_counter: Counter = Counter()
    
    for entry in entries:
        result.total_entries += 1
        
        level_counter[entry.level] += 1
        message_counter[entry.message] += 1
        
        if result.earliest_timestamp is None or entry.timestamp < result.earliest_timestamp:
            result.earliest_timestamp = entry.timestamp
        
        if result.latest_timestamp is None or entry.timestamp > result.latest_timestamp:
            result.latest_timestamp = entry.timestamp
        
        if entry.duration_ms is not None:
            duration_entries.append((entry, entry.duration_ms))
        
        hour_key = entry.timestamp.strftime("%Y-%m-%d %H:00")
        hour_counter[hour_key] += 1
    
    result.level_counts = dict(level_counter)
    result.message_counts = message_counter
    
    duration_entries.sort(key=lambda x: x[1], reverse=True)
    result.slowest_entries = [(entry.raw_data, duration) for entry, duration in duration_entries[:5]]
    
    result.hourly_histogram = dict(hour_counter)
    
    return result

def aggregate_stream(entries: Iterator[LogEntry]) -> Generator[StatsResult, None, None]:
    """Aggregate stats and yield result as single item."""
    yield aggregate_stats(entries)
```

### File: src/loglens/formatters.py
```python
"""Output formatting for log entries and statistics."""

from datetime import datetime
from typing import Any, Generator, Iterator, Protocol
import json
import csv
import io
from rich.table import Table
from rich.console import Console
from rich import print as rprint

from loglens.parser import LogEntry
from loglens.aggregator import StatsResult
from loglens.types import OutputFormat

class OutputFormatter(Protocol):
    """Protocol for output formatters."""
    def format_entry(self, entry: LogEntry) -> str: ...
    def format_stats(self, stats: StatsResult) -> str: ...

class JSONFormatter:
    """Format output as JSON."""
    
    def format_entry(self, entry: LogEntry) -> str:
        """Format a single log entry as JSON."""
        return json.dumps(entry.raw_data, ensure_ascii=False)
    
    def format_entries(self, entries: Iterator[LogEntry]) -> Generator[str, None, None]:
        """Format multiple entries as JSON lines."""
        for entry in entries:
            yield self.format_entry(entry)
    
    def format_stats(self, stats: StatsResult) -> str:
        """Format statistics as JSON."""
        return json.dumps(stats.to_dict(), ensure_ascii=False, indent=2)

class CSVFormatter:
    """Format output as CSV."""
    
    def format_entry(self, entry: LogEntry) -> str:
        """Format a single log entry as CSV row."""
        output = io.StringIO()
        writer = csv.writer(output)
        
        row = [
            entry.timestamp.isoformat(),
            entry.level,
            entry.message,
            entry.service or "",
            entry.request_id or "",
            str(entry.duration_ms) if entry.duration_ms is not None else ""
        ]
        
        writer.writerow(row)
        return output.getvalue().strip()
    
    def format_entries(self, entries: Iterator[LogEntry]) -> Generator[str, None, None]:
        """Format multiple entries as CSV."""
        output = io.StringIO()
        writer = csv.writer(output)
        
        writer.writerow(["timestamp", "level", "message", "service", "request_id", "duration_ms"])
        
        for entry in entries:
            row = [
                entry.timestamp.isoformat(),
                entry.level,
                entry.message,
                entry.service or "",
                entry.request_id or "",
                str(entry.duration_ms) if entry.duration_ms is not None else ""
            ]
            writer.writerow(row)
        
        return output.getvalue()
    
    def format_stats(self, stats: StatsResult) -> str:
        """Format statistics as CSV."""
        output = io.StringIO()
        writer = csv.writer(output)
        
        writer.writerow(["metric", "value"])
        writer.writerow(["total_entries", stats.total_entries])
        
        for level, count in stats.level_counts.items():
            writer.writerow([f"level_{level}", count])
        
        if stats.earliest_timestamp:
            writer.writerow(["earliest_timestamp", stats.earliest_timestamp.isoformat()])
        
        if stats.latest_timestamp:
            writer.writerow(["latest_timestamp", stats.latest_timestamp.isoformat()])
        
        for message, count in stats.message_counts.most_common(10):
            writer.writerow([f"message_{message}", count])
        
        return output.getvalue()

class TableFormatter:
    """Format output as rich tables."""
    
    def format_entry(self, entry: LogEntry) -> str:
        """Format a single log entry as table row."""
        timestamp = entry.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        level = entry.level.upper()
        message = entry.message[:50] + "..." if len(entry.message) > 50 else entry.message
        
        return f"{timestamp} | {level} | {message}"
    
    def format_entries(self, entries: Iterator[LogEntry]) -> Generator[str, None, None]:
        """Format multiple entries as table."""
        table = Table(title="Log Entries")
        table.add_column("Timestamp", style="cyan")
        table.add_column("Level", style="magenta")
        table.add_column("Message", style="white")
        table.add_column("Service", style="green")
        table.add_column("Duration", style="yellow")
        
        for entry in entries:
            timestamp = entry.timestamp.strftime("%Y-%m-%d %H:%M:%S")
            level = entry.level.upper()
            message = entry.message[:50] + "..." if len(entry.message) > 50 else entry.message
            service = entry.service or "-"
            duration = f"{entry.duration_ms}ms" if entry.duration_ms is not None else "-"
            
            table.add_row(timestamp, level, message, service, duration)
        
        console = Console()
        with console.capture() as capture:
            console.print(table)
        
        return capture.get()
    
    def format_stats(self, stats: StatsResult) -> str:
        """Format statistics as table."""
        output_parts: list[str] = []
        
        summary_table = Table(title="Summary")
        summary_table.add_column("Metric", style="cyan")
        summary_table.add_column("Value", style="white")
        
        summary_table.add_row("Total Entries", str(stats.total_entries))
        
        if stats.earliest_timestamp:
            summary_table.add_row("Earliest", stats.earliest_timestamp.strftime("%Y-%m-%d %H:%M:%S"))
        
        if stats.latest_timestamp:
            summary_table.add_row("Latest", stats.latest_timestamp.strftime("%Y-%m-%d %H:%M:%S"))
        
        console = Console()
        with console.capture() as capture:
            console.print(summary_table)
        output_parts.append(capture.get())
        
        level_table = Table(title="Level Distribution")
        level_table.add_column("Level", style="magenta")
        level_table.add_column("Count", style="white")
        
        for level, count in sorted(stats.level_counts.items()):
            level_table.add_row(level.upper(), str(count))
        
        with console.capture() as capture:
            console.print(level_table)
        output_parts.append(capture.get())
        
        message_table = Table(title="Top 10 Messages")
        message_table.add_column("Message", style="white")
        message_table.add_column("Count", style="yellow")
        
        for message, count in stats.message_counts.most_common(10):
            message_display = message[:40] + "..." if len(message) > 40 else message
            message_table.add_row(message_display, str(count))
        
        with console.capture() as capture:
            console.print(message_table)
        output_parts.append(capture.get())
        
        if stats.slowest_entries:
            slow_table = Table(title="Top 5 Slowest Entries")
            slow_table.add_column("Duration (ms)", style="red")
            slow_table.add_column("Message", style="white")
            
            for entry_data, duration in stats.slowest_entries[:5]:
                message = entry_data.get("message", "unknown")[:40]
                slow_table.add_row(str(duration), message)
            
            with console.capture() as capture:
                console.print(slow_table)
            output_parts.append(capture.get())
        
        histogram_table = Table(title="Hourly Histogram")
        histogram_table.add_column("Hour", style="cyan")
        histogram_table.add_column("Entries", style="white")
        histogram_table.add_column("Bar", style="green")
        
        if stats.hourly_histogram:
            max_count = max(stats.hourly_histogram.values()) if stats.hourly_histogram else 1
            
            for hour, count in sorted(stats.hourly_histogram.items()):
                bar_length = int((count / max_count) * 20)
                bar = "█" * bar_length
                histogram_table.add_row(hour, str(count), bar)
            
            with console.capture() as capture:
                console.print(histogram_table)
            output_parts.append(capture.get())
        
        return "\n".join(output_parts)

def get_formatter(format_type: OutputFormat) -> OutputFormatter:
    """Get the appropriate formatter for the output format."""
    match format_type:
        case "json":
            return JSONFormatter()
        case "csv":
            return CSVFormatter()
        case "table":
            return TableFormatter()
        case _:
            return JSONFormatter()

def write_output(output: str, format_type: OutputFormat) -> None:
    """Write formatted output to stdout."""
    if format_type == "table":
        rprint(output)
    else:
        print(output)
```

### File: src/loglens/watcher.py
```python
"""File tail/watch logic for streaming new log entries."""

from pathlib import Path
from typing import Generator, Iterator
import time
import os

from loglens.parser import LogEntry, parse_log_stream
from loglens.filters import FilterConfig, apply_filter, limit_entries

def watch_file(path: str, predicate: FilterConfig | None = None, limit: int | None = None) -> Generator[LogEntry, None, None]:
    """Watch a file and yield new log entries as they are appended."""
    if not Path(path).exists():
        raise FileNotFoundError(f"File not found: {path}")
    
    last_position = 0
    
    while True:
        try:
            with open(path, "r", encoding="utf-8") as f:
                current_size = os.path.getsize(path)
                
                if current_size > last_position:
                    f.seek(last_position)
                    new_lines = f.readlines()
                    
                    for line in new_lines:
                        if line.strip():
                            entry = parse_line(line, 0)
                            if entry:
                                if predicate is None or predicate(entry):
                                    if limit is None or limit > 0:
                                        yield entry
                                        if limit:
                                            limit -= 1
                
                last_position = current_size
                
        except (IOError, OSError) as e:
            import sys
            sys.stderr.write(f"Error reading file: {e}\n")
        
        time.sleep(0.5)

def parse_line(line: str, line_number: int) -> LogEntry | None:
    """Parse a single line (imported from parser for watch module)."""
    from loglens.parser import parse_line as parser_parse_line
    return parser_parse_line(line, line_number)

def watch_stream(path: str, config: FilterConfig, limit: int | None = None) -> Generator[LogEntry, None, None]:
    """Watch a file with filtering applied."""
    predicate = config.create_predicate()
    
    for entry in watch_file(path):
        if predicate(entry):
            yield entry
            
            if limit and limit <= 0:
                break
            
            if limit:
                limit -= 1
```

### File: src/loglens/cli.py
```python
"""Click command definitions for LogLens CLI."""

from datetime import datetime
from pathlib import Path
from typing import Any, Optional
import sys
import click

from loglens.parser import parse_log_stream, read_log_file, read_stdin
from loglens.filters import FilterConfig, apply_filter, limit_entries
from loglens.aggregator import aggregate_stats
from loglens.formatters import get_formatter, write_output
from loglens.watcher import watch_stream

@click.group()
def main() -> None:
    """LogLens - Analyze structured JSON log files."""
    pass

@main.command()
@click.argument("file", required=False)
@click.option("--level", multiple=True, help="Filter by log level (repeatable)")
@click.option("--since", help="Only entries at or after this timestamp (ISO 8601)")
@click.option("--until", help="Only entries before this timestamp (ISO 8601)")
@click.option("--field", multiple=True, help="Match entries where field equals value (FIELD=VALUE)")
@click.option("--contains", help="Match entries whose message contains TEXT")
@click.option("--output", type=click.Choice(["json", "csv", "table"]), default="json", help="Output format")
@click.option("--limit", type=int, help="Stop after N matching entries")
@click.pass_context
def filter(ctx: click.Context, file: Optional[str], level: tuple[str, ...], since: Optional[str], 
           until: Optional[str], field: tuple[str, ...], contains: Optional[str], 
           output: str, limit: Optional[int]) -> None:
    """Stream log entries matching criteria to stdout."""
    
    config = FilterConfig(
        levels=list(level),
        since=parse_datetime(since) if since else None,
        until=parse_datetime(until) if until else None,
        fields=parse_field_pairs(field),
        contains=contains
    )
    
    predicate = config.create_predicate()
    
    if file == "-":
        lines = read_stdin()
    elif file:
        if not Path(file).exists():
            click.echo(f"Error: File not found: {file}", err=True)
            ctx.exit(1)
        lines = read_log_file(file)
    else:
        click.echo("Error: File argument required", err=True)
        ctx.exit(1)
    
    entries = parse_log_stream(lines)
    filtered = apply_filter(entries, predicate)
    limited = limit_entries(filtered, limit)
    
    formatter = get_formatter(output)
    
    if output == "csv":
        write_output(formatter.format_entries(limited), output)
    elif output == "table":
        write_output(formatter.format_entries(limited), output)
    else:
        for entry in limited:
            print(formatter.format_entry(entry))

@main.command()
@click.argument("file", required=False)
@click.option("--level", multiple=True, help="Filter by log level (repeatable)")
@click.option("--since", help="Only entries at or after this timestamp (ISO 8601)")
@click.option("--until", help="Only entries before this timestamp (ISO 8601)")
@click.option("--field", multiple=True, help="Match entries where field equals value (FIELD=VALUE)")
@click.option("--contains", help="Match entries whose message contains TEXT")
@click.option("--output", type=click.Choice(["json", "table"]), default="json", help="Output format")
@click.pass_context
def stats(ctx: click.Context, file: Optional[str], level: tuple[str, ...], since: Optional[str],
          until: Optional[str], field: tuple[str, ...], contains: Optional[str],
          output: str) -> None:
    """Compute aggregations over log entries."""
    
    config = FilterConfig(
        levels=list(level),
        since=parse_datetime(since) if since else None,
        until=parse_datetime(until) if until else None,
        fields=parse_field_pairs(field),
        contains=contains
    )
    
    predicate = config.create_predicate()
    
    if file == "-":
        lines = read_stdin()
    elif file:
        if not Path(file).exists():
            click.echo(f"Error: File not found: {file}", err=True)
            ctx.exit(1)
        lines = read_log_file(file)
    else:
        click.echo("Error: File argument required", err=True)
        ctx.exit(1)
    
    entries = parse_log_stream(lines)
    filtered = apply_filter(entries, predicate)
    
    stats_result = aggregate_stats(filtered)
    
    formatter = get_formatter(output)
    write_output(formatter.format_stats(stats_result), output)

@main.command()
@click.argument("file")
@click.option("--level", multiple=True, help="Filter by log level (repeatable)")
@click.option("--since", help="Only entries at or after this timestamp (ISO 8601)")
@click.option("--until", help="Only entries before this timestamp (ISO 8601)")
@click.option("--field", multiple=True, help="Match entries where field equals value (FIELD=VALUE)")
@click.option("--contains", help="Match entries whose message contains TEXT")
@click.option("--output", type=click.Choice(["json", "table"]), default="json", help="Output format")
@click.option("--limit", type=int, help="Stop after N matching entries")
@click.pass_context
def watch(ctx: click.Context, file: str, level: tuple[str, ...], since: Optional[str],
          until: Optional[str], field: tuple[str, ...], contains: Optional[str],
          output: str, limit: Optional[int]) -> None:
    """Tail a file and stream new matching entries."""
    
    config = FilterConfig(
        levels=list(level),
        since=parse_datetime(since) if since else None,
        until=parse_datetime(until) if until else None,
        fields=parse_field_pairs(field),
        contains=contains
    )
    
    if not Path(file).exists():
        click.echo(f"Error: File not found: {file}", err=True)
        ctx.exit(1)
    
    formatter = get_formatter(output)
    
    try:
        for entry in watch_stream(file, config, limit):
            if output == "table":
                print(formatter.format_entry(entry))
            else:
                print(formatter.format_entry(entry))
    except KeyboardInterrupt:
        ctx.exit(0)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        ctx.exit(2)

def parse_datetime(value: str) -> datetime:
    """Parse ISO 8601 datetime string."""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise click.BadParameter(f"Invalid datetime format: {value}")

def parse_field_pairs(field_pairs: tuple[str, ...]) -> dict[str, str]:
    """Parse FIELD=VALUE pairs into dictionary."""
    result: dict[str, str] = {}
    
    for pair in field_pairs:
        if "=" not in pair:
            raise click.BadParameter(f"Invalid field pair: {pair} (must be FIELD=VALUE)")
        
        parts = pair.split("=", 1)
        result[parts[0]] = parts[1]
    
    return result

if __name__ == "__main__":
    main()
```

### File: tests/conftest.py
```python
"""Shared fixtures for LogLens tests."""

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import pytest
import json
import tempfile

from loglens.parser import LogEntry

@pytest.fixture
def sample_log_entry() -> LogEntry:
    """Create a sample log entry."""
    data = {
        "timestamp": "2025-01-15T08:23:41.012Z",
        "level": "error",
        "message": "Connection refused",
        "service": "auth-api",
        "request_id": "abc-123",
        "duration_ms": 342
    }
    return LogEntry.from_dict(data, 1)

@pytest.fixture
def sample_log_lines() -> list[str]:
    """Sample log lines for testing."""
    entries = [
        {"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "Service started", "service": "api"},
        {"timestamp": "2025-01-15T08:01:00.000Z", "level": "debug", "message": "Processing request", "service": "api"},
        {"timestamp": "2025-01-15T08:02:00.000Z", "level": "warning", "message": "High memory usage", "service": "api"},
        {"timestamp": "2025-01-15T08:03:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "duration_ms": 342},
        {"timestamp": "2025-01-15T08:04:00.000Z", "level": "error", "message": "Database timeout", "service": "db", "duration_ms": 5000},
        {"timestamp": "2025-01-15T08:05:00.000Z", "level": "critical", "message": "Service crashed", "service": "api"},
        {"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "Service restarted", "service": "api"},
        {"timestamp": "2025-01-15T09:01:00.000Z", "level": "info", "message": "Processing request", "service": "api"},
        {"timestamp": "2025-01-15T09:02:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "duration_ms": 100},
        {"timestamp": "2025-01-15T09:03:00.000Z", "level": "info", "message": "Request completed", "service": "api"},
    ]
    
    return [json.dumps(entry) for entry in entries]

@pytest.fixture
def temp_log_file(sample_log_lines: list[str]) -> Path:
    """Create a temporary log file with sample data."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
        for line in sample_log_lines:
            f.write(line + "\n")
        path = Path(f.name)
    
    return path

@pytest.fixture
def malformed_log_file() -> Path:
    """Create a log file with malformed entries."""
    lines = [
        "not json at all",
        json.dumps({"timestamp": "2025-01-15T08:00:00.000Z", "level": "info"}),  # missing message
        json.dumps({"timestamp": "invalid", "level": "info", "message": "test"}),  # invalid timestamp
        json.dumps({"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "valid"}),
    ]
    
    with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
        for line in lines:
            f.write(line + "\n")
        path = Path(f.name)
    
    return path

@pytest.fixture
def empty_log_file() -> Path:
    """Create an empty log file."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
        path = Path(f.name)
    
    return path

@pytest.fixture
def filter_config_factory() -> callable:
    """Factory for creating filter configurations."""
    from loglens.filters import FilterConfig
    
    def create_config(**kwargs: Any) -> FilterConfig:
        return FilterConfig(**kwargs)
    
    return create_config
```

### File: tests/test_parser.py
```python
"""Tests for log parser module."""

from datetime import datetime, timezone
import json

from loglens.parser import LogEntry, parse_line, parse_log_stream, read_log_file

def test_parse_valid_entry(sample_log_entry: LogEntry) -> None:
    """Test parsing a valid log entry."""
    assert sample_log_entry.timestamp.year == 2025
    assert sample_log_entry.level == "error"
    assert sample_log_entry.message == "Connection refused"
    assert sample_log_entry.service == "auth-api"
    assert sample_log_entry.duration_ms == 342

def test_parse_line_valid(sample_log_lines: list[str]) -> None:
    """Test parsing a valid log line."""
    entry = parse_line(sample_log_lines[0], 1)
    assert entry is not None
    assert entry.level == "info"
    assert entry.message == "Service started"

def test_parse_line_malformed_json() -> None:
    """Test parsing malformed JSON."""
    entry = parse_line("not json", 1)
    assert entry is None

def test_parse_line_missing_required_field() -> None:
    """Test parsing entry with missing required field."""
    data = {"timestamp": "2025-01-15T08:00:00.000Z", "level": "info"}
    line = json.dumps(data)
    entry = parse_line(line, 1)
    assert entry is None

def test_parse_line_invalid_timestamp() -> None:
    """Test parsing entry with invalid timestamp."""
    data = {"timestamp": "invalid", "level": "info", "message": "test"}
    line = json.dumps(data)
    entry = parse_line(line, 1)
    assert entry is None

def test_parse_line_invalid_level() -> None:
    """Test parsing entry with invalid level."""
    data = {"timestamp": "2025-01-15T08:00:00.000Z", "level": "unknown", "message": "test"}
    line = json.dumps(data)
    entry = parse_line(line, 1)
    assert entry is None

def test_parse_log_stream(sample_log_lines: list[str]) -> None:
    """Test parsing a stream of log lines."""
    entries = list(parse_log_stream(sample_log_lines))
    assert len(entries) == 10
    assert entries[0].level == "info"
    assert entries[3].level == "error"

def test_parse_log_stream_with_malformed(malformed_log_file: Path) -> None:
    """Test parsing stream with malformed entries."""
    lines = read_log_file(str(malformed_log_file))
    entries = list(parse_log_stream(lines))
    assert len(entries) == 1  # Only one valid entry

def test_parse_empty_stream(empty_log_file: Path) -> None:
    """Test parsing empty file."""
    lines = read_log_file(str(empty_log_file))
    entries = list(parse_log_stream(lines))
    assert len(entries) == 0

def test_parse_line_number_tracking(sample_log_lines: list[str]) -> None:
    """Test that line numbers are tracked correctly."""
    entries = list(parse_log_stream(sample_log_lines))
    assert entries[0].line_number == 1
    assert entries[9].line_number == 10

def test_parse_timezone_handling() -> None:
    """Test timezone parsing in timestamps."""
    data = {"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test"}
    line = json.dumps(data)
    entry = parse_line(line, 1)
    assert entry is not None
    assert entry.timestamp.tzinfo is not None

def test_parse_duration_ms_types() -> None:
    """Test duration_ms field type handling."""
    data = {"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "test", "duration_ms": "not_int"}
    line = json.dumps(data)
    entry = parse_line(line, 1)
    assert entry is not None
    assert entry.duration_ms is None
    
    data["duration_ms"] = 500
    line = json.dumps(data)
    entry = parse_line(line, 1)
    assert entry.duration_ms == 500
```

### File: tests/test_filters.py
```python
"""Tests for filter module."""

from datetime import datetime, timezone
from typing import Any

from loglens.filters import FilterConfig, apply_filter, limit_entries
from loglens.parser import LogEntry, parse_log_stream

def test_filter_by_level(sample_log_lines: list[str]) -> None:
    """Test filtering by log level."""
    config = FilterConfig(levels=["error"])
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 3
    assert all(entry.level == "error" for entry in filtered)

def test_filter_by_multiple_levels(sample_log_lines: list[str]) -> None:
    """Test filtering by multiple log levels."""
    config = FilterConfig(levels=["error", "critical"])
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 4

def test_filter_by_since(sample_log_lines: list[str]) -> None:
    """Test filtering by since timestamp."""
    since = datetime.fromisoformat("2025-01-15T09:00:00+00:00")
    config = FilterConfig(since=since)
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 4
    assert all(entry.timestamp >= since for entry in filtered)

def test_filter_by_until(sample_log_lines: list[str]) -> None:
    """Test filtering by until timestamp."""
    until = datetime.fromisoformat("2025-01-15T08:03:00+00:00")
    config = FilterConfig(until=until)
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 3
    assert all(entry.timestamp < until for entry in filtered)

def test_filter_by_field(sample_log_lines: list[str]) -> None:
    """Test filtering by field value."""
    config = FilterConfig(fields={"service": "auth-api"})
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 2
    assert all(entry.service == "auth-api" for entry in filtered)

def test_filter_by_multiple_fields(sample_log_lines: list[str]) -> None:
    """Test filtering by multiple field values."""
    config = FilterConfig(fields={"service": "auth-api", "level": "error"})
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 2

def test_filter_by_contains(sample_log_lines: list[str]) -> None:
    """Test filtering by message contains."""
    config = FilterConfig(contains="Connection")
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 2
    assert all("Connection" in entry.message for entry in filtered)

def test_filter_combined(sample_log_lines: list[str]) -> None:
    """Test combined filters."""
    config = FilterConfig(
        levels=["error"],
        since=datetime.fromisoformat("2025-01-15T08:00:00+00:00"),
        fields={"service": "auth-api"}
    )
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 2

def test_limit_entries(sample_log_lines: list[str]) -> None:
    """Test limiting entries."""
    entries = parse_log_stream(sample_log_lines)
    limited = list(limit_entries(entries, 5))
    
    assert len(limited) == 5

def test_limit_entries_no_limit(sample_log_lines: list[str]) -> None:
    """Test no limit on entries."""
    entries = parse_log_stream(sample_log_lines)
    limited = list(limit_entries(entries, None))
    
    assert len(limited) == 10

def test_filter_no_criteria(sample_log_lines: list[str]) -> None:
    """Test filter with no criteria (all entries pass)."""
    config = FilterConfig()
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 10

def test_filter_empty_result(sample_log_lines: list[str]) -> None:
    """Test filter that results in no matches."""
    config = FilterConfig(fields={"service": "nonexistent"})
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 0

def test_filter_case_insensitive_contains(sample_log_lines: list[str]) -> None:
    """Test case-insensitive contains filter."""
    config = FilterConfig(contains="connection")
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = list(apply_filter(entries, predicate))
    
    assert len(filtered) == 2
```

### File: tests/test_aggregator.py
```python
"""Tests for aggregator module."""

from datetime import datetime
from collections import Counter

from loglens.aggregator import aggregate_stats, StatsResult
from loglens.parser import parse_log_stream

def test_aggregate_total_count(sample_log_lines: list[str]) -> None:
    """Test total entry count aggregation."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    assert stats.total_entries == 10

def test_aggregate_level_counts(sample_log_lines: list[str]) -> None:
    """Test level counts aggregation."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    assert stats.level_counts["info"] == 5
    assert stats.level_counts["error"] == 3
    assert stats.level_counts["debug"] == 1
    assert stats.level_counts["warning"] == 1
    assert stats.level_counts["critical"] == 1

def test_aggregate_timestamp_range(sample_log_lines: list[str]) -> None:
    """Test timestamp range aggregation."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    assert stats.earliest_timestamp is not None
    assert stats.latest_timestamp is not None
    assert stats.earliest_timestamp < stats.latest_timestamp

def test_aggregate_top_messages(sample_log_lines: list[str]) -> None:
    """Test top messages aggregation."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    top_messages = stats.message_counts.most_common(10)
    assert len(top_messages) <= 10
    
    message_counts = Counter(entry.message for entry in parse_log_stream(sample_log_lines))
    assert stats.message_counts == message_counts

def test_aggregate_top_slowest(sample_log_lines: list[str]) -> None:
    """Test top slowest entries aggregation."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    assert len(stats.slowest_entries) <= 5
    
    if stats.slowest_entries:
        durations = [entry[1] for entry in stats.slowest_entries]
        assert durations == sorted(durations, reverse=True)

def test_aggregate_hourly_histogram(sample_log_lines: list[str]) -> None:
    """Test hourly histogram aggregation."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    assert len(stats.hourly_histogram) > 0
    
    hour_08 = "2025-01-15 08:00"
    hour_09 = "2025-01-15 09:00"
    
    assert stats.hourly_histogram.get(hour_08, 0) == 6
    assert stats.hourly_histogram.get(hour_09, 0) == 4

def test_aggregate_empty_entries(empty_log_file: Path) -> None:
    """Test aggregation with empty file."""
    from loglens.parser import read_log_file
    
    lines = read_log_file(str(empty_log_file))
    entries = parse_log_stream(lines)
    stats = aggregate_stats(entries)
    
    assert stats.total_entries == 0
    assert stats.level_counts == {}
    assert stats.earliest_timestamp is None
    assert stats.latest_timestamp is None

def test_aggregate_stats_to_dict(sample_log_lines: list[str]) -> None:
    """Test stats result to_dict method."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    result_dict = stats.to_dict()
    
    assert "total_entries" in result_dict
    assert "level_counts" in result_dict
    assert "top_messages" in result_dict
    assert "top_slowest" in result_dict
    assert "hourly_histogram" in result_dict

def test_aggregate_filtered_entries(sample_log_lines: list[str]) -> None:
    """Test aggregation with filtered entries."""
    from loglens.filters import FilterConfig, apply_filter
    
    config = FilterConfig(levels=["error"])
    predicate = config.create_predicate()
    
    entries = parse_log_stream(sample_log_lines)
    filtered = apply_filter(entries, predicate)
    stats = aggregate_stats(filtered)
    
    assert stats.total_entries == 3
    assert stats.level_counts == {"error": 3}

def test_aggregate_malformed_entries(malformed_log_file: Path) -> None:
    """Test aggregation with malformed entries."""
    from loglens.parser import read_log_file
    
    lines = read_log_file(str(malformed_log_file))
    entries = parse_log_stream(lines)
    stats = aggregate_stats(entries)
    
    assert stats.total_entries == 1

def test_aggregate_duration_ms_none(sample_log_lines: list[str]) -> None:
    """Test aggregation when duration_ms is None."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    slowest_with_duration = [entry for entry, duration in stats.slowest_entries if duration is not None]
    assert len(slowest_with_duration) <= 5
```

### File: tests/test_formatters.py
```python
"""Tests for formatter module."""

import json
import csv
import io

from loglens.formatters import JSONFormatter, CSVFormatter, TableFormatter, get_formatter
from loglens.aggregator import StatsResult, aggregate_stats
from loglens.parser import parse_log_stream

def test_json_formatter_entry(sample_log_entry: LogEntry) -> None:
    """Test JSON formatter for single entry."""
    formatter = JSONFormatter()
    output = formatter.format_entry(sample_log_entry)
    
    data = json.loads(output)
    assert data["level"] == "error"
    assert data["message"] == "Connection refused"

def test_json_formatter_stats(sample_log_lines: list[str]) -> None:
    """Test JSON formatter for stats."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    formatter = JSONFormatter()
    output = formatter.format_stats(stats)
    
    data = json.loads(output)
    assert data["total_entries"] == 10
    assert "level_counts" in data

def test_csv_formatter_entry(sample_log_entry: LogEntry) -> None:
    """Test CSV formatter for single entry."""
    formatter = CSVFormatter()
    output = formatter.format_entry(sample_log_entry)
    
    reader = csv.reader(io.StringIO(output))
    rows = list(reader)
    
    assert len(rows) == 1
    assert rows[0][1] == "error"

def test_csv_formatter_entries(sample_log_lines: list[str]) -> None:
    """Test CSV formatter for multiple entries."""
    entries = parse_log_stream(sample_log_lines)
    
    formatter = CSVFormatter()
    output = formatter.format_entries(entries)
    
    reader = csv.reader(io.StringIO(output))
    rows = list(reader)
    
    assert len(rows) == 11  # Header + 10 entries
    assert rows[0] == ["timestamp", "level", "message", "service", "request_id", "duration_ms"]

def test_csv_formatter_stats(sample_log_lines: list[str]) -> None:
    """Test CSV formatter for stats."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    formatter = CSVFormatter()
    output = formatter.format_stats(stats)
    
    reader = csv.reader(io.StringIO(output))
    rows = list(reader)
    
    assert len(rows) > 1
    assert rows[0] == ["metric", "value"]

def test_table_formatter_entry(sample_log_entry: LogEntry) -> None:
    """Test table formatter for single entry."""
    formatter = TableFormatter()
    output = formatter.format_entry(sample_log_entry)
    
    assert "2025-01-15" in output
    assert "ERROR" in output

def test_table_formatter_stats(sample_log_lines: list[str]) -> None:
    """Test table formatter for stats."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    formatter = TableFormatter()
    output = formatter.format_stats(stats)
    
    assert "Total Entries" in output or "total_entries" in output
    assert "Level Distribution" in output or "level" in output.lower()

def test_get_formatter_json() -> None:
    """Test getting JSON formatter."""
    formatter = get_formatter("json")
    assert isinstance(formatter, JSONFormatter)

def test_get_formatter_csv() -> None:
    """Test getting CSV formatter."""
    formatter = get_formatter("csv")
    assert isinstance(formatter, CSVFormatter)

def test_get_formatter_table() -> None:
    """Test getting table formatter."""
    formatter = get_formatter("table")
    assert isinstance(formatter, TableFormatter)

def test_get_formatter_default() -> None:
    """Test default formatter is JSON."""
    formatter = get_formatter("unknown")
    assert isinstance(formatter, JSONFormatter)

def test_json_formatter_preserves_all_fields(sample_log_entry: LogEntry) -> None:
    """Test JSON formatter preserves all fields."""
    formatter = JSONFormatter()
    output = formatter.format_entry(sample_log_entry)
    
    data = json.loads(output)
    assert "timestamp" in data
    assert "level" in data
    assert "message" in data
    assert "service" in data
    assert "request_id" in data
    assert "duration_ms" in data

def test_csv_formatter_handles_none_values(sample_log_lines: list[str]) -> None:
    """Test CSV formatter handles None values."""
    entries = parse_log_stream(sample_log_lines)
    
    formatter = CSVFormatter()
    output = formatter.format_entries(entries)
    
    reader = csv.reader(io.StringIO(output))
    rows = list(reader)
    
    for row in rows[1:]:
        assert len(row) == 6

def test_stats_result_serialization(sample_log_lines: list[str]) -> None:
    """Test stats result can be serialized."""
    entries = parse_log_stream(sample_log_lines)
    stats = aggregate_stats(entries)
    
    result_dict = stats.to_dict()
    
    json_output = json.dumps(result_dict)
    assert json_output is not None
    
    parsed = json.loads(json_output)
    assert parsed["total_entries"] == 10
```

### File: sample.log
```json
{"timestamp": "2025-01-15T08:00:00.000Z", "level": "info", "message": "Service started", "service": "api", "request_id": "req-001"}
{"timestamp": "2025-01-15T08:01:00.000Z", "level": "debug", "message": "Processing request", "service": "api", "request_id": "req-002", "duration_ms": 50}
{"timestamp": "2025-01-15T08:02:00.000Z", "level": "warning", "message": "High memory usage", "service": "api", "request_id": "req-003"}
{"timestamp": "2025-01-15T08:03:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "request_id": "req-004", "duration_ms": 342}
{"timestamp": "2025-01-15T08:04:00.000Z", "level": "error", "message": "Database timeout", "service": "db", "request_id": "req-005", "duration_ms": 5000}
{"timestamp": "2025-01-15T08:05:00.000Z", "level": "critical", "message": "Service crashed", "service": "api", "request_id": "req-006"}
{"timestamp": "2025-01-15T08:10:00.000Z", "level": "info", "message": "Service restarted", "service": "api", "request_id": "req-007"}
{"timestamp": "2025-01-15T08:15:00.000Z", "level": "info", "message": "Processing request", "service": "api", "request_id": "req-008", "duration_ms": 100}
{"timestamp": "2025-01-15T08:20:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "request_id": "req-009", "duration_ms": 200}
{"timestamp": "2025-01-15T08:25:00.000Z", "level": "info", "message": "Request completed", "service": "api", "request_id": "req-010", "duration_ms": 75}
{"timestamp": "2025-01-15T09:00:00.000Z", "level": "info", "message": "Batch job started", "service": "batch", "request_id": "req-011"}
{"timestamp": "2025-01-15T09:05:00.000Z", "level": "debug", "message": "Processing batch item", "service": "batch", "request_id": "req-012", "duration_ms": 150}
{"timestamp": "2025-01-15T09:10:00.000Z", "level": "warning", "message": "Slow batch processing", "service": "batch", "request_id": "req-013", "duration_ms": 3000}
{"timestamp": "2025-01-15T09:15:00.000Z", "level": "error", "message": "Batch item failed", "service": "batch", "request_id": "req-014", "duration_ms": 100}
{"timestamp": "2025-01-15T09:20:00.000Z", "level": "info", "message": "Batch job completed", "service": "batch", "request_id": "req-015"}
{"timestamp": "2025-01-15T10:00:00.000Z", "level": "info", "message": "Health check passed", "service": "api", "request_id": "req-016"}
{"timestamp": "2025-01-15T10:05:00.000Z", "level": "debug", "message": "Cache refreshed", "service": "api", "request_id": "req-017", "duration_ms": 25}
{"timestamp": "2025-01-15T10:10:00.000Z", "level": "info", "message": "New user registered", "service": "auth-api", "request_id": "req-018"}
{"timestamp": "2025-01-15T10:15:00.000Z", "level": "error", "message": "Authentication failed", "service": "auth-api", "request_id": "req-019", "duration_ms": 50}
{"timestamp": "2025-01-15T10:20:00.000Z", "level": "critical", "message": "Security breach detected", "service": "auth-api", "request_id": "req-020"}
{"timestamp": "2025-01-15T10:25:00.000Z", "level": "info", "message": "Security response initiated", "service": "auth-api", "request_id": "req-021"}
{"timestamp": "2025-01-15T10:30:00.000Z", "level": "info", "message": "System stabilized", "service": "api", "request_id": "req-022"}
{"timestamp": "2025-01-15T10:35:00.000Z", "level": "debug", "message": "Metrics collected", "service": "api", "request_id": "req-023", "duration_ms": 10}
{"timestamp": "2025-01-15T10:40:00.000Z", "level": "info", "message": "Daily report generated", "service": "batch", "request_id": "req-024"}
{"timestamp": "2025-01-15T10:45:00.000Z", "level": "info", "message": "Shutdown initiated", "service": "api", "request_id": "req-025"}
```