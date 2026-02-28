### File: pyproject.toml
```toml
[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "loglens"
version = "1.0.0"
description = "A command-line tool for analyzing structured JSON log files"
readme = "README.md"
requires-python = ">=3.12"
license = { text = "MIT" }
authors = [
    { name = "LogLens Team", email = "team@loglens.example.com" }
]
classifiers = [
    "Development Status :: 4 - Beta",
    "Environment :: Console",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3.12",
    "Topic :: System :: Logging",
    "Topic :: Utilities",
]

dependencies = [
    "click>=8.1.0",
    "rich>=13.0.0",
]

[project.scripts]
loglens = "loglens.cli:cli"

[project.urls]
Homepage = "https://github.com/example/loglens"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = "test_*.py"
python_classes = "Test*"
python_functions = "test_*"
```

### File: README.md
```markdown
# LogLens

A command-line tool for analyzing structured JSON log files with streaming architecture.

## Features

- **Streaming processing**: Handles large log files without loading entire files into memory
- **Flexible filtering**: Filter by log level, time range, field values, and message content
- **Statistics**: Compute aggregations and histograms
- **Real-time monitoring**: Watch log files for new entries
- **Multiple output formats**: JSON, CSV, and formatted tables

## Installation

```bash
pip install -e .
```

## Usage

### Filter logs

```bash
loglens filter sample.log --level error --since 2025-01-15T00:00:00Z --output table
```

### Compute statistics

```bash
loglens stats sample.log --output table
```

### Watch a log file

```bash
loglens watch sample.log --level error --output json
```

## Log Format

LogLens expects newline-delimited JSON (NDJSON) files. Each line must be a JSON object with at least these fields:

```json
{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "Connection refused"}
```

Additional fields are allowed and can be used for filtering.

## Examples

See `sample.log` for example log entries.

## Development

Run tests with:

```bash
pytest
```
```

### File: src/loglens/__init__.py
```python
"""LogLens: A command-line tool for analyzing structured JSON log files."""

__version__ = "1.0.0"
```

### File: src/loglens/types.py
```python
"""Shared type definitions for LogLens."""

from typing import Any, Protocol, TypeAlias
from datetime import datetime

LogEntryDict: TypeAlias = dict[str, Any]


class LogEntryLike(Protocol):
    """Protocol for log-like objects."""
    timestamp: str
    level: str
    message: str


TimestampRange: TypeAlias = tuple[datetime | None, datetime | None]
FieldFilter: TypeAlias = tuple[str, str]
LevelSet: TypeAlias = set[str]
```

### File: src/loglens/parser.py
```python
"""Parsing NDJSON log files into structured data."""

import json
import sys
from dataclasses import dataclass
from typing import Iterator, Optional, TextIO

from .types import LogEntryDict


@dataclass(slots=True)
class LogEntry:
    """Represents a parsed log entry."""
    timestamp: str
    level: str
    message: str
    data: LogEntryDict  # Original JSON data including all fields

    @property
    def to_dict(self) -> LogEntryDict:
        """Convert back to dictionary format."""
        return self.data


class ParseError(Exception):
    """Raised when a line cannot be parsed."""
    pass


def parse_line(line: str, line_number: int) -> Optional[LogEntry]:
    """Parse a single NDJSON line into a LogEntry.
    
    Returns None if the line is malformed or missing required fields.
    """
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        print(f"Warning: Malformed JSON on line {line_number}", file=sys.stderr)
        return None
    
    if not isinstance(data, dict):
        print(f"Warning: Line {line_number} is not a JSON object", file=sys.stderr)
        return None
    
    # Check required fields
    required = {"timestamp", "level", "message"}
    missing = required - set(data.keys())
    if missing:
        print(f"Warning: Line {line_number} missing required field(s): {missing}", file=sys.stderr)
        return None
    
    return LogEntry(
        timestamp=data["timestamp"],
        level=data["level"],
        message=data["message"],
        data=data
    )


def read_ndjson(file_path: str | None) -> Iterator[Optional[LogEntry]]:
    """Read NDJSON from a file or stdin, yielding parsed entries."""
    if file_path == "-" or file_path is None:
        # Read from stdin
        stream: TextIO = sys.stdin
        for line_number, line in enumerate(stream, 1):
            yield parse_line(line.rstrip("\n"), line_number)
    else:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                for line_number, line in enumerate(f, 1):
                    yield parse_line(line.rstrip("\n"), line_number)
        except FileNotFoundError:
            print(f"Error: File not found: {file_path}", file=sys.stderr)
            sys.exit(1)
        except PermissionError:
            print(f"Error: Permission denied: {file_path}", file=sys.stderr)
            sys.exit(1)
```

### File: src/loglens/filters.py
```python
"""Filter predicates and configuration."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional

from .types import FieldFilter, LevelSet, LogEntryLike, TimestampRange


@dataclass(slots=True)
class FilterConfig:
    """Configuration for filtering log entries."""
    levels: LevelSet = field(default_factory=set)
    time_range: TimestampRange = (None, None)
    field_filters: list[FieldFilter] = field(default_factory=list)
    contains: Optional[str] = None
    limit: Optional[int] = None
    
    def compile(self) -> Callable[[LogEntryLike], bool]:
        """Compile filter configuration into a predicate function."""
        predicates: list[Callable[[LogEntryLike], bool]] = []
        
        # Level filter
        if self.levels:
            levels = self.levels
            predicates.append(lambda e: e.level in levels)
        
        # Time range filter
        since, until = self.time_range
        if since:
            since_ts = since
            predicates.append(lambda e: datetime.fromisoformat(
                e.timestamp.replace("Z", "+00:00")
            ) >= since_ts)
        if until:
            until_ts = until
            predicates.append(lambda e: datetime.fromisoformat(
                e.timestamp.replace("Z", "+00:00")
            ) < until_ts)
        
        # Field equality filters
        for field_name, expected_value in self.field_filters:
            predicates.append(
                lambda e, fn=field_name, ev=expected_value: self._field_matches(e, fn, ev)
            )
        
        # Message contains filter (case-insensitive)
        if self.contains:
            pattern = re.compile(re.escape(self.contains), re.IGNORECASE)
            predicates.append(lambda e: bool(pattern.search(e.message)))
        
        # Combine all predicates with AND logic
        def filter_func(entry: LogEntryLike) -> bool:
            return all(predicate(entry) for predicate in predicates)
        
        return filter_func
    
    @staticmethod
    def _field_matches(entry: LogEntryLike, field_name: str, expected_value: str) -> bool:
        """Check if a field in the entry matches the expected value."""
        if hasattr(entry, 'data') and isinstance(entry.data, dict):
            data = entry.data
        else:
            data = vars(entry) if hasattr(entry, '__dict__') else {}
        
        if field_name in data:
            return str(data[field_name]) == expected_value
        return False


def apply_filters(
    entries: Iterator[Optional[LogEntryLike]],
    filter_config: FilterConfig
) -> Iterator[LogEntryLike]:
    """Apply filters to a stream of log entries."""
    filter_func = filter_config.compile()
    count = 0
    
    for entry in entries:
        if entry is None:
            continue
        
        if filter_func(entry):
            yield entry
            count += 1
            
            if filter_config.limit and count >= filter_config.limit:
                break
```

### File: src/loglens/aggregator.py
```python
"""Statistics computation and aggregation."""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterator, Optional

from .types import LogEntryLike


@dataclass(slots=True)
class StatsResult:
    """Container for aggregated statistics."""
    total_entries: int = 0
    count_by_level: dict[str, int] = field(default_factory=Counter)
    earliest_timestamp: Optional[datetime] = None
    latest_timestamp: Optional[datetime] = None
    message_frequencies: dict[str, int] = field(default_factory=Counter)
    slowest_entries: list[tuple[LogEntryLike, float]] = field(default_factory=list)
    entries_per_hour: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    
    def update(self, entry: LogEntryLike) -> None:
        """Update statistics with a single entry."""
        self.total_entries += 1
        
        # Count by level
        self.count_by_level[entry.level] += 1
        
        # Timestamps
        entry_time = datetime.fromisoformat(entry.timestamp.replace("Z", "+00:00"))
        if self.earliest_timestamp is None or entry_time < self.earliest_timestamp:
            self.earliest_timestamp = entry_time
        if self.latest_timestamp is None or entry_time > self.latest_timestamp:
            self.latest_timestamp = entry_time
        
        # Message frequencies
        self.message_frequencies[entry.message] += 1
        
        # Slowest entries by duration_ms (if present)
        if hasattr(entry, 'data') and 'duration_ms' in entry.data:
            try:
                duration = float(entry.data['duration_ms'])
                self._update_slowest(entry, duration)
            except (ValueError, TypeError):
                pass
        
        # Hourly histogram
        hour = entry_time.hour
        self.entries_per_hour[hour] += 1
    
    def _update_slowest(self, entry: LogEntryLike, duration: float) -> None:
        """Maintain top 5 slowest entries."""
        self.slowest_entries.append((entry, duration))
        self.slowest_entries.sort(key=lambda x: x[1], reverse=True)
        if len(self.slowest_entries) > 5:
            self.slowest_entries.pop()
    
    def finalize(self) -> None:
        """Finalize statistics after all entries processed."""
        # Sort message frequencies
        self.message_frequencies = dict(
            Counter(self.message_frequencies).most_common(10)
        )
        
        # Sort entries per hour by hour
        self.entries_per_hour = dict(sorted(self.entries_per_hour.items()))


def compute_stats(entries: Iterator[Optional[LogEntryLike]]) -> StatsResult:
    """Compute statistics from a stream of log entries."""
    stats = StatsResult()
    
    for entry in entries:
        if entry is None:
            continue
        stats.update(entry)
    
    stats.finalize()
    return stats
```

### File: src/loglens/formatters.py
```python
"""Output formatting for different formats."""

import csv
import json
import sys
from typing import Any, TextIO

from rich.console import Console
from rich.table import Table

from .aggregator import StatsResult
from .types import LogEntryLike


class BaseFormatter:
    """Base class for output formatters."""
    def __init__(self, output: TextIO = sys.stdout):
        self.output = output
    
    def write_entry(self, entry: LogEntryLike) -> None:
        """Write a single log entry."""
        raise NotImplementedError
    
    def write_stats(self, stats: StatsResult) -> None:
        """Write statistics."""
        raise NotImplementedError


class JSONFormatter(BaseFormatter):
    """Output as JSON (NDJSON for entries, object for stats)."""
    def write_entry(self, entry: LogEntryLike) -> None:
        if hasattr(entry, 'to_dict'):
            data = entry.to_dict
        else:
            data = vars(entry) if hasattr(entry, '__dict__') else dict(entry)
        json.dump(data, self.output)
        self.output.write("\n")
    
    def write_stats(self, stats: StatsResult) -> None:
        result = {
            "total_entries": stats.total_entries,
            "count_by_level": dict(stats.count_by_level),
            "earliest_timestamp": (
                stats.earliest_timestamp.isoformat() 
                if stats.earliest_timestamp else None
            ),
            "latest_timestamp": (
                stats.latest_timestamp.isoformat()
                if stats.latest_timestamp else None
            ),
            "top_messages": stats.message_frequencies,
            "slowest_entries": [
                {
                    "entry": (
                        entry.to_dict if hasattr(entry, 'to_dict') 
                        else vars(entry) if hasattr(entry, '__dict__') 
                        else dict(entry)
                    ),
                    "duration_ms": duration
                }
                for entry, duration in stats.slowest_entries
            ],
            "entries_per_hour": dict(stats.entries_per_hour),
        }
        json.dump(result, self.output, indent=2)
        self.output.write("\n")


class CSVFormatter(BaseFormatter):
    """Output as CSV (entries only)."""
    def __init__(self, output: TextIO = sys.stdout):
        super().__init__(output)
        self.writer: Optional[csv.DictWriter] = None
        self.fieldnames: Optional[set[str]] = None
    
    def write_entry(self, entry: LogEntryLike) -> None:
        if hasattr(entry, 'to_dict'):
            data = entry.to_dict
        else:
            data = vars(entry) if hasattr(entry, '__dict__') else dict(entry)
        
        if self.writer is None:
            self.fieldnames = set(data.keys())
            self.writer = csv.DictWriter(self.output, fieldnames=sorted(self.fieldnames))
            self.writer.writeheader()
        
        # Ensure all fields are present
        row = {field: data.get(field, "") for field in self.fieldnames}
        self.writer.writerow(row)
    
    def write_stats(self, stats: StatsResult) -> None:
        raise NotImplementedError("CSV output not supported for statistics")


class TableFormatter(BaseFormatter):
    """Output as formatted tables using Rich."""
    def __init__(self, output: TextIO = sys.stdout):
        super().__init__(output)
        self.console = Console(file=output)
    
    def write_entry(self, entry: LogEntryLike) -> None:
        if hasattr(entry, 'to_dict'):
            data = entry.to_dict
        else:
            data = vars(entry) if hasattr(entry, '__dict__') else dict(entry)
        
        table = Table(title="Log Entry", show_header=True, header_style="bold magenta")
        table.add_column("Field", style="dim")
        table.add_column("Value")
        
        for key, value in sorted(data.items()):
            table.add_row(key, str(value))
        
        self.console.print(table)
    
    def write_stats(self, stats: StatsResult) -> None:
        # Overall summary
        summary_table = Table(title="Summary", show_header=True, header_style="bold")
        summary_table.add_column("Metric")
        summary_table.add_column("Value")
        
        summary_table.add_row("Total entries", str(stats.total_entries))
        summary_table.add_row(
            "Earliest timestamp",
            stats.earliest_timestamp.isoformat() if stats.earliest_timestamp else "N/A"
        )
        summary_table.add_row(
            "Latest timestamp",
            stats.latest_timestamp.isoformat() if stats.latest_timestamp else "N/A"
        )
        
        self.console.print(summary_table)
        self.console.print()
        
        # Count by level
        level_table = Table(title="Count by Level", show_header=True, header_style="bold")
        level_table.add_column("Level")
        level_table.add_column("Count")
        
        for level, count in sorted(stats.count_by_level.items()):
            level_table.add_row(level, str(count))
        
        self.console.print(level_table)
        self.console.print()
        
        # Top messages
        message_table = Table(title="Top 10 Messages", show_header=True, header_style="bold")
        message_table.add_column("Message")
        message_table.add_column("Count")
        
        for message, count in stats.message_frequencies.items():
            message_table.add_row(message, str(count))
        
        self.console.print(message_table)
        self.console.print()
        
        # Slowest entries
        if stats.slowest_entries:
            slow_table = Table(title="Top 5 Slowest Entries", show_header=True, header_style="bold")
            slow_table.add_column("Timestamp")
            slow_table.add_column("Level")
            slow_table.add_column("Message")
            slow_table.add_column("Duration (ms)")
            
            for entry, duration in stats.slowest_entries:
                slow_table.add_row(
                    entry.timestamp,
                    entry.level,
                    entry.message,
                    f"{duration:.1f}"
                )
            
            self.console.print(slow_table)
            self.console.print()
        
        # Hourly histogram
        hist_table = Table(title="Entries per Hour", show_header=True, header_style="bold")
        hist_table.add_column("Hour")
        hist_table.add_column("Count")
        hist_table.add_column("Chart")
        
        max_count = max(stats.entries_per_hour.values()) if stats.entries_per_hour else 1
        
        for hour in range(24):
            count = stats.entries_per_hour.get(hour, 0)
            bar_length = int((count / max_count) * 40) if max_count > 0 else 0
            bar = "█" * bar_length
            hist_table.add_row(f"{hour:02d}:00", str(count), bar)
        
        self.console.print(hist_table)


def get_formatter(format_name: str, output: TextIO = sys.stdout) -> BaseFormatter:
    """Factory function to get the appropriate formatter."""
    match format_name:
        case "json":
            return JSONFormatter(output)
        case "csv":
            return CSVFormatter(output)
        case "table":
            return TableFormatter(output)
        case _:
            raise ValueError(f"Unknown format: {format_name}")
```

### File: src/loglens/watcher.py
```python
"""File watching and tailing functionality."""

import time
from typing import Iterator, Optional

from .parser import LogEntry, parse_line


def watch_file(file_path: str) -> Iterator[Optional[LogEntry]]:
    """Watch a file for new lines, yielding new entries as they appear."""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            # Seek to end of file
            f.seek(0, 2)
            
            while True:
                line = f.readline()
                if line:
                    yield parse_line(line.rstrip("\n"), 0)
                else:
                    time.sleep(0.1)  # Small delay to avoid busy waiting
    except FileNotFoundError:
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)
    except PermissionError:
        print(f"Error: Permission denied: {file_path}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        return
```

### File: src/loglens/cli.py
```python
"""Click CLI interface for LogLens."""

import sys
from datetime import datetime
from typing import Optional

import click

from .aggregator import StatsResult, compute_stats
from .filters import FilterConfig, apply_filters
from .formatters import get_formatter
from .parser import read_ndjson
from .watcher import watch_file


def common_filter_options(func):
    """Decorator to add common filter options to commands."""
    func = click.option(
        "--level",
        multiple=True,
        help="Filter by log level (repeatable)."
    )(func)
    func = click.option(
        "--since",
        type=click.DateTime(),
        help="Only entries at or after this timestamp (ISO 8601)."
    )(func)
    func = click.option(
        "--until",
        type=click.DateTime(),
        help="Only entries before this timestamp (ISO 8601)."
    )(func)
    func = click.option(
        "--field",
        "field_filters",
        multiple=True,
        help="Match entries where a field equals a value (repeatable, AND logic)."
    )(func)
    func = click.option(
        "--contains",
        help="Match entries whose message contains TEXT (case-insensitive)."
    )(func)
    return func


def parse_field_filters(field_filters: tuple[str, ...]) -> list[tuple[str, str]]:
    """Parse --field options into (field_name, value) tuples."""
    result = []
    for field_filter in field_filters:
        if "=" not in field_filter:
            raise click.BadParameter(
                f"Field filter must be in format FIELD=VALUE, got: {field_filter}"
            )
        field_name, value = field_filter.split("=", 1)
        result.append((field_name, value))
    return result


@click.group()
def cli():
    """LogLens: Analyze structured JSON log files."""
    pass


@cli.command()
@click.argument("file", required=False)
@common_filter_options
@click.option(
    "--output",
    type=click.Choice(["json", "csv", "table"]),
    default="json",
    help="Output format."
)
@click.option(
    "--limit",
    type=int,
    help="Stop after N matching entries."
)
def filter(
    file: Optional[str],
    level: tuple[str, ...],
    since: Optional[datetime],
    until: Optional[datetime],
    field_filters: tuple[str, ...],
    contains: Optional[str],
    output: str,
    limit: Optional[int]
):
    """Stream log entries matching the given criteria to stdout."""
    try:
        parsed_field_filters = parse_field_filters(field_filters)
    except click.BadParameter as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    
    filter_config = FilterConfig(
        levels=set(level),
        time_range=(since, until),
        field_filters=parsed_field_filters,
        contains=contains,
        limit=limit
    )
    
    formatter = get_formatter(output)
    entries = read_ndjson(file if file else "-")
    filtered_entries = apply_filters(entries, filter_config)
    
    try:
        for entry in filtered_entries:
            formatter.write_entry(entry)
    except BrokenPipeError:
        # Handle broken pipe (e.g., when piping to head)
        sys.stderr.close()
        sys.exit(0)


@cli.command()
@click.argument("file", required=False)
@common_filter_options
@click.option(
    "--output",
    type=click.Choice(["json", "table"]),
    default="json",
    help="Output format."
)
def stats(
    file: Optional[str],
    level: tuple[str, ...],
    since: Optional[datetime],
    until: Optional[datetime],
    field_filters: tuple[str, ...],
    contains: Optional[str],
    output: str
):
    """Compute aggregations over the (optionally filtered) log entries."""
    try:
        parsed_field_filters = parse_field_filters(field_filters)
    except click.BadParameter as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    
    filter_config = FilterConfig(
        levels=set(level),
        time_range=(since, until),
        field_filters=parsed_field_filters,
        contains=contains,
        limit=None
    )
    
    formatter = get_formatter(output)
    entries = read_ndjson(file if file else "-")
    filtered_entries = apply_filters(entries, filter_config)
    stats_result = compute_stats(filtered_entries)
    
    try:
        formatter.write_stats(stats_result)
    except BrokenPipeError:
        sys.stderr.close()
        sys.exit(0)


@cli.command()
@click.argument("file", required=True)
@common_filter_options
@click.option(
    "--output",
    type=click.Choice(["json", "table"]),
    default="json",
    help="Output format."
)
def watch(
    file: str,
    level: tuple[str, ...],
    since: Optional[datetime],
    until: Optional[datetime],
    field_filters: tuple[str, ...],
    contains: Optional[str],
    output: str
):
    """Tail a file and stream new matching entries as they are appended."""
    try:
        parsed_field_filters = parse_field_filters(field_filters)
    except click.BadParameter as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    
    filter_config = FilterConfig(
        levels=set(level),
        time_range=(since, until),
        field_filters=parsed_field_filters,
        contains=contains,
        limit=None
    )
    
    formatter = get_formatter(output)
    watched_entries = watch_file(file)
    filtered_entries = apply_filters(watched_entries, filter_config)
    
    try:
        for entry in filtered_entries:
            if entry is not None:
                formatter.write_entry(entry)
    except KeyboardInterrupt:
        print("\nStopping...", file=sys.stderr)
        sys.exit(0)
    except BrokenPipeError:
        sys.stderr.close()
        sys.exit(0)


if __name__ == "__main__":
    cli()
```

### File: sample.log
```json
{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "Connection refused", "service": "auth-api", "request_id": "abc-123", "duration_ms": 342}
{"timestamp": "2025-01-15T08:24:01.345Z", "level": "info", "message": "User logged in", "service": "auth-api", "request_id": "abc-124", "duration_ms": 120}
{"timestamp": "2025-01-15T08:25:15.678Z", "level": "warning", "message": "High memory usage", "service": "app-server", "request_id": "def-456", "duration_ms": 50}
{"timestamp": "2025-01-15T08:26:00.000Z", "level": "error", "message": "Database connection lost", "service": "db-proxy", "request_id": "ghi-789", "duration_ms": 5000}
{"timestamp": "2025-01-15T08:26:30.123Z", "level": "critical", "message": "Server crashed", "service": "app-server", "request_id": "jkl-012", "duration_ms": 100}
{"timestamp": "2025-01-15T08:27:45.456Z", "level": "info", "message": "Backup completed", "service": "backup-service", "request_id": "mno-345", "duration_ms": 3000}
{"timestamp": "2025-01-15T08:28:10.789Z", "level": "debug", "message": "Processing request", "service": "auth-api", "request_id": "pqr-678", "duration_ms": 45}
{"timestamp": "2025-01-15T08:29:00.000Z", "level": "info", "message": "Health check passed", "service": "health-check", "request_id": "stu-901", "duration_ms": 10}
{"timestamp": "2025-01-15T08:30:00.000Z", "level": "error", "message": "Connection refused", "service": "auth-api", "request_id": "vwx-234", "duration_ms": 350}
{"timestamp": "2025-01-15T08:31:00.000Z", "level": "info", "message": "Cache cleared", "service": "cache-service", "request_id": "yz-567", "duration_ms": 200}
{"timestamp": "2025-01-15T09:15:22.100Z", "level": "warning", "message": "Disk usage at 85%", "service": "monitoring", "request_id": "aaa-001", "duration_ms": 15}
{"timestamp": "2025-01-15T09:30:45.200Z", "level": "info", "message": "Scheduled task completed", "service": "scheduler", "request_id": "bbb-002", "duration_ms": 2500}
{"timestamp": "2025-01-15T09:45:10.300Z", "level": "error", "message": "External API timeout", "service": "api-gateway", "request_id": "ccc-003", "duration_ms": 30000}
{"timestamp": "2025-01-15T10:00:00.000Z", "level": "critical", "message": "Database replication lag", "service": "db-proxy", "request_id": "ddd-004", "duration_ms": 1500}
{"timestamp": "2025-01-15T10:15:33.400Z", "level": "debug", "message": "Cache hit ratio: 92%", "service": "cache-service", "request_id": "eee-005", "duration_ms": 5}
{"timestamp": "2025-01-15T10:30:20.500Z", "level": "info", "message": "Load balancer health check", "service": "lb", "request_id": "fff-006", "duration_ms": 80}
{"timestamp": "2025-01-15T10:45:55.600Z", "level": "warning", "message": "CPU spike detected", "service": "monitoring", "request_id": "ggg-007", "duration_ms": 25}
{"timestamp": "2025-01-15T11:00:10.700Z", "level": "error", "message": "Payment processing failed", "service": "payment-service", "request_id": "hhh-008", "duration_ms": 4200}
{"timestamp": "2025-01-15T11:15:40.800Z", "level": "info", "message": "User session created", "service": "auth-api", "request_id": "iii-009", "duration_ms": 95}
{"timestamp": "2025-01-15T11:30:05.900Z", "level": "debug", "message": "Query optimization stats", "service": "db-proxy", "request_id": "jjj-010", "duration_ms": 12}
```

### File: tests/conftest.py
```python
"""Shared pytest fixtures."""

import tempfile
from pathlib import Path

import pytest

from loglens.parser import LogEntry


@pytest.fixture
def sample_log_lines():
    """Return a list of sample log lines as strings."""
    return [
        '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "Connection refused", "service": "auth-api", "duration_ms": 342}',
        '{"timestamp": "2025-01-15T08:24:01.345Z", "level": "info", "message": "User logged in", "service": "auth-api", "duration_ms": 120}',
        '{"timestamp": "2025-01-15T08:25:15.678Z", "level": "warning", "message": "High memory usage", "service": "app-server", "duration_ms": 50}',
        '{"timestamp": "2025-01-15T08:26:00.000Z", "level": "error", "message": "Database connection lost", "service": "db-proxy", "duration_ms": 5000}',
        '{"timestamp": "2025-01-15T08:26:30.123Z", "level": "critical", "message": "Server crashed", "service": "app-server", "duration_ms": 100}',
    ]


@pytest.fixture
def temp_log_file(sample_log_lines):
    """Create a temporary log file with sample lines."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
        for line in sample_log_lines:
            f.write(line + "\n")
    yield Path(f.name)
    Path(f.name).unlink()


@pytest.fixture
def parsed_log_entries(sample_log_lines):
    """Parse sample log lines into LogEntry objects."""
    from loglens.parser import parse_line
    entries = []
    for i, line in enumerate(sample_log_lines, 1):
        entry = parse_line(line, i)
        if entry:
            entries.append(entry)
    return entries
```

### File: tests/test_parser.py
```python
"""Test the NDJSON parser."""

import json
from io import StringIO

import pytest

from loglens.parser import LogEntry, parse_line, read_ndjson


def test_parse_valid_line():
    """Test parsing a valid log line."""
    line = '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "Connection refused", "service": "auth-api"}'
    entry = parse_line(line, 1)
    
    assert entry is not None
    assert isinstance(entry, LogEntry)
    assert entry.timestamp == "2025-01-15T08:23:41.012Z"
    assert entry.level == "error"
    assert entry.message == "Connection refused"
    assert entry.data["service"] == "auth-api"


def test_parse_missing_required_field():
    """Test parsing a line missing required fields."""
    line = '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error"}'
    entry = parse_line(line, 1)
    assert entry is None


def test_parse_malformed_json():
    """Test parsing malformed JSON."""
    line = '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "test"'
    entry = parse_line(line, 1)
    assert entry is None


def test_parse_non_object_json():
    """Test parsing JSON that is not an object."""
    line = '["timestamp", "2025-01-15T08:23:41.012Z"]'
    entry = parse_line(line, 1)
    assert entry is None


def test_read_ndjson_from_file(temp_log_file):
    """Test reading NDJSON from a file."""
    entries = list(read_ndjson(str(temp_log_file)))
    assert len(entries) == 5
    assert all(isinstance(e, LogEntry) for e in entries)


def test_read_ndjson_from_stdin(monkeypatch):
    """Test reading NDJSON from stdin."""
    input_data = '{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "test"}\n'
    monkeypatch.setattr("sys.stdin", StringIO(input_data))
    
    entries = list(read_ndjson("-"))
    assert len(entries) == 1
    assert entries[0].message == "test"


def test_read_ndjson_with_invalid_lines():
    """Test reading NDJSON with invalid lines."""
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
        f.write('{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "valid"}\n')
        f.write('invalid json\n')
        f.write('{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error"}\n')  # missing message
        f.write('{"timestamp": "2025-01-15T08:23:41.012Z", "level": "error", "message": "also valid"}\n')
    
    try:
        entries = list(read_ndjson(f.name))
        assert len(entries) == 2  # Only the valid ones
        assert entries[0].message == "valid"
        assert entries[1].message == "also valid"
    finally:
        import os
        os.unlink(f.name)
```

### File: tests/test_filters.py
```python
"""Test filter predicates."""

from datetime import datetime

import pytest

from loglens.filters import FilterConfig, apply_filters
from loglens.parser import LogEntry


@pytest.fixture
def sample_entries():
    """Create sample log entries for testing."""
    return [
        LogEntry(
            timestamp="2025-01-15T08:23:41.012Z",
            level="error",
            message="Connection refused",
            data={"service": "auth-api", "duration_ms": 342}
        ),
        LogEntry(
            timestamp="2025-01-15T08:24:01.345Z",
            level="info",
            message="User logged in",
            data={"service": "auth-api", "duration_ms": 120}
        ),
        LogEntry(
            timestamp="2025-01-15T08:25:15.678Z",
            level="warning",
            message="High memory usage",
            data={"service": "app-server", "duration_ms": 50}
        ),
        LogEntry(
            timestamp="2025-01-15T08:26:00.000Z",
            level="error",
            message="Database connection lost",
            data={"service": "db-proxy", "duration_ms": 5000}
        ),
    ]


def test_level_filter(sample_entries):
    """Test filtering by log level."""
    config = FilterConfig(levels={"error", "warning"})
    filtered = list(apply_filters(iter(sample_entries), config))
    
    assert len(filtered) == 3
    assert all(e.level in {"error", "warning"} for e in filtered)


def test_time_range_filter(sample_entries):
    """Test filtering by time range."""
    since = datetime.fromisoformat("2025-01-15T08:24:00.000Z")
    until = datetime.fromisoformat("2025-01-15T08:26:00.000Z")
    config = FilterConfig(time_range=(since, until))
    
    filtered = list(apply_filters(iter(sample_entries), config))
    
    assert len(filtered) == 2
    assert filtered[0].timestamp == "2025-01-15T08:24:01.345Z"
    assert filtered[1].timestamp == "2025-01-15T08:25:15.678Z"


def test_field_filter(sample_entries):
    """Test filtering by field equality."""
    config = FilterConfig(field_filters=[("service", "auth-api")])
    filtered = list(apply_filters(iter(sample_entries), config))
    
    assert len(filtered) == 2
    assert all(e.data["service"] == "auth-api" for e in filtered)


def test_contains_filter(sample_entries):
    """Test filtering by message contains."""
    config = FilterConfig(contains="connection")
    filtered = list(apply_filters(iter(sample_entries), config))
    
    assert len(filtered) == 2
    assert all("connection" in e.message.lower() for e in filtered)


def test_combined_filters(sample_entries):
    """Test combining multiple filters."""
    since = datetime.fromisoformat("2025-01-15T08:24:00.000Z")
    config = FilterConfig(
        levels={"error"},
        time_range=(since, None),
        field_filters=[("service", "db-proxy")],
        contains="connection"
    )
    
    filtered = list(apply_filters(iter(sample_entries), config))
    
    assert len(filtered) == 1
    assert filtered[0].message == "Database connection lost"


def test_limit_filter(sample_entries):
    """Test limiting the number of results."""
    config = FilterConfig(limit=2)
    filtered = list(apply_filters(iter(sample_entries), config))
    
    assert len(filtered) == 2


def test_empty_filter(sample_entries):
    """Test with empty filter config (should return all entries)."""
    config = FilterConfig()
    filtered = list(apply_filters(iter(sample_entries), config))
    
    assert len(filtered) == len(sample_entries)
```

### File: tests/test_aggregator.py
```python
"""Test statistics computation."""

from datetime import datetime

import pytest

from loglens.aggregator import StatsResult, compute_stats
from loglens.parser import LogEntry


@pytest.fixture
def sample_entries():
    """Create sample log entries for testing stats."""
    return [
        LogEntry(
            timestamp="2025-01-15T08:23:41.012Z",
            level="error",
            message="Connection refused",
            data={"service": "auth-api", "duration_ms": 342}
        ),
        LogEntry(
            timestamp="2025-01-15T08:24:01.345Z",
            level="info",
            message="User logged in",
            data={"service": "auth-api", "duration_ms": 120}
        ),
        LogEntry(
            timestamp="2025-01-15T08:25:15.678Z",
            level="warning",
            message="High memory usage",
            data={"service": "app-server", "duration_ms": 50}
        ),
        LogEntry(
            timestamp="2025-01-15T08:26:00.000Z",
            level="error",
            message="Database connection lost",
            data={"service": "db-proxy", "duration_ms": 5000}
        ),
        LogEntry(
            timestamp="2025-01-15T09:26:30.123Z",
            level="critical",
            message="Server crashed",
            data={"service": "app-server", "duration_ms": 100}
        ),
    ]


def test_stats_result_update(sample_entries):
    """Test updating stats with entries."""
    stats = StatsResult()
    
    for entry in sample_entries:
        stats.update(entry)
    
    stats.finalize()
    
    assert stats.total_entries == 5
    assert stats.count_by_level["error"] == 2
    assert stats.count_by_level["info"] == 1
    assert stats.count_by_level["warning"] == 1
    assert stats.count_by_level["critical"] == 1
    
    assert stats.earliest_timestamp == datetime.fromisoformat("2025-01-15T08:23:41.012Z")
    assert stats.latest_timestamp == datetime.fromisoformat("2025-01-15T09:26:30.123Z")
    
    assert len(stats.message_frequencies) == 5  # All unique messages
    assert stats.message_frequencies["Connection refused"] == 1
    
    assert len(stats.slowest_entries) == 5
    assert stats.slowest_entries[0][1] == 5000.0  # Highest duration
    
    assert stats.entries_per_hour[8] == 4
    assert stats.entries_per_hour[9] == 1


def test_compute_stats(sample_entries):
    """Test compute_stats function."""
    stats = compute_stats(iter(sample_entries))
    
    assert stats.total_entries == 5
    assert isinstance(stats.earliest_timestamp, datetime)
    assert isinstance(stats.latest_timestamp, datetime)


def test_stats_no_duration_field():
    """Test stats with entries that don't have duration_ms."""
    entries = [
        LogEntry(
            timestamp="2025-01-15T08:23:41.012Z",
            level="error",
            message="Test",
            data={"service": "auth-api"}  # No duration_ms
        ),
    ]
    
    stats = compute_stats(iter(entries))
    assert stats.total_entries == 1
    assert stats.slowest_entries == []  # No duration field


def test_stats_empty_input():
    """Test stats with empty input."""
    stats = compute_stats(iter([]))
    
    assert stats.total_entries == 0
    assert stats.earliest_timestamp is None
    assert stats.latest_timestamp is None
    assert stats.count_by_level == {}
    assert stats.message_frequencies == {}
    assert stats.slowest_entries == []
    assert stats.entries_per_hour == {}
```

### File: tests/test_formatters.py
```python
"""Test output formatters."""

import json
from io import StringIO

import pytest

from loglens.aggregator import StatsResult
from loglens.formatters import CSVFormatter, JSONFormatter, TableFormatter, get_formatter
from loglens.parser import LogEntry


def test_json_formatter_entry():
    """Test JSON formatter for single entry."""
    entry = LogEntry(
        timestamp="2025-01-15T08:23:41.012Z",
        level="error",
        message="Connection refused",
        data={"service": "auth-api", "duration_ms": 342}
    )
    
    output = StringIO()
    formatter = JSONFormatter(output)
    formatter.write_entry(entry)
    
    result = json.loads(output.getvalue())
    assert result["timestamp"] == "2025-01-15T08:23:41.012Z"
    assert result["level"] == "error"
    assert result["message"] == "Connection refused"
    assert result["service"] == "auth-api"


def test_json_formatter_stats():
    """Test JSON formatter for statistics."""
    stats = StatsResult()
    stats.total_entries = 5
    stats.count_by_level = {"error": 2, "info": 3}
    stats.earliest_timestamp = datetime.fromisoformat("2025-01-15T08:23:41.012Z")
    stats.latest_timestamp = datetime.fromisoformat("2025-01-15T09:26:30.123Z")
    stats.message_frequencies = {"Test": 5}
    stats.entries_per_hour = {8: 3, 9: 2}
    
    output = StringIO()
    formatter = JSONFormatter(output)
    formatter.write_stats(stats)
    
    result = json.loads(output.getvalue())
    assert result["total_entries"] == 5
    assert result["count_by_level"] == {"error": 2, "info": 3}
    assert result["earliest_timestamp"] == "2025-01-15T08:23:41.012Z"
    assert result["latest_timestamp"] == "2025-01-15T09:26:30.123Z"
    assert result["top_messages"] == {"Test": 5}
    assert result["entries_per_hour"] == {8: 3, 9: 2}


def test_csv_formatter():
    """Test CSV formatter."""
    entries = [
        LogEntry(
            timestamp="2025-01-15T08:23:41.012Z",
            level="error",
            message="Connection refused",
            data={"service": "auth-api", "duration_ms": 342}
        ),
        LogEntry(
            timestamp="2025-01-15T08:24:01.345Z",
            level="info",
            message="User logged in",
            data={"service": "auth-api", "duration_ms": 120}
        ),
    ]
    
    output = StringIO()
    formatter = CSVFormatter(output)
    
    for entry in entries:
        formatter.write_entry(entry)
    
    lines = output.getvalue().strip().split("\n")
    assert len(lines) == 3  # Header + 2 rows
    assert "timestamp,level,message,service,duration_ms" in lines[0]
    assert "Connection refused" in lines[1]


def test_csv_formatter_stats_not_supported():
    """Test that CSV formatter doesn't support stats."""
    stats = StatsResult()
    output = StringIO()
    formatter = CSVFormatter(output)
    
    with pytest.raises(NotImplementedError):
        formatter.write_stats(stats)


def test_table_formatter_entry():
    """Test table formatter for single entry."""
    entry = LogEntry(
        timestamp="2025-01-15T08:23:41.012Z",
        level="error",
        message="Connection refused",
        data={"service": "auth-api", "duration_ms": 342}
    )
    
    output = StringIO()
    formatter = TableFormatter(output)
    formatter.write_entry(entry)
    
    result = output.getvalue()
    assert "Log Entry" in result
    assert "timestamp" in result
    assert "2025-01-15T08:23:41.012Z" in result


def test_get_formatter():
    """Test formatter factory function."""
    assert isinstance(get_formatter("json"), JSONFormatter)
    assert isinstance(get_formatter("csv"), CSVFormatter)
    assert isinstance(get_formatter("table"), TableFormatter)
    
    with pytest.raises(ValueError):
        get_formatter("invalid")
```